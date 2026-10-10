-- Additive: existing leagues, codes and grants remain unchanged. Old clients remain compatible.
create or replace function wbl_private.check_teams(t jsonb) returns void language plpgsql set search_path='' as $$
declare team jsonb; player jsonb; names text[]:='{}'; players text[]:='{}'; nm text;
begin
 if jsonb_typeof(t) is distinct from 'object' or t-'teams'<>'{}'::jsonb or jsonb_typeof(t->'teams') is distinct from 'array' or jsonb_array_length(t->'teams')>8 then raise exception 'Leagues support up to 8 teams.'; end if;
 for team in select value from jsonb_array_elements(t->'teams') loop
  if jsonb_typeof(team) is distinct from 'object' or team-'name'-'players'<>'{}'::jsonb or jsonb_typeof(team->'name') is distinct from 'string'
   or coalesce(length(trim(team->>'name')),0) not between 1 and 60 or lower(trim(team->>'name'))=any(names)
   or jsonb_typeof(team->'players') is distinct from 'array' or jsonb_array_length(team->'players')>2 then raise exception 'Each team needs a unique name and at most two roster players.'; end if;
  names:=array_append(names,lower(trim(team->>'name')));
  for player in select value from jsonb_array_elements(team->'players') loop
   nm:=trim(player#>>'{}');
   if jsonb_typeof(player) is distinct from 'string' or length(nm) not between 1 and 60 or lower(nm)=any(players) then raise exception 'Players need unique names of 1–60 characters.'; end if;
   players:=array_append(players,lower(nm));
  end loop;
 end loop;
 perform wbl_private.validate_text_tree(t);
end $$;
CREATE OR REPLACE FUNCTION public.wbl_create(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare lid text; h bytea; cr wbl_private.creations; expires timestamptz:=null; nm text:=trim(p_request->>'name'); tok text:=p_request->>'session_token'; oid uuid:=(p_request->>'op_id')::uuid;
begin
 if jsonb_typeof(p_request) is distinct from 'object' or p_request-'op_id'-'session_token'-'name'-'code'-'settings'-'teams'<>'{}'::jsonb or jsonb_typeof(p_request->'name') is distinct from 'string' or jsonb_typeof(p_request->'code') is distinct from 'string' then raise exception 'Invalid creation request'; end if;
 perform wbl_private.check_code(p_request->>'code'); perform wbl_private.check_settings(p_request->'settings'); perform wbl_private.check_teams(p_request->'teams');
 if oid is null or tok is null or tok !~ '^[a-f0-9]{64}$' or coalesce(length(nm),0) not between 1 and 80 or octet_length(p_request::text)>16384 then raise exception 'Invalid creation request'; end if;
 perform wbl_private.validate_text_tree(jsonb_build_object('name',nm));
 h:=sha256(convert_to(p_request::text,'UTF8'));
 perform pg_advisory_xact_lock(hashtextextended(oid::text,0));
 select * into cr from wbl_private.creations where op_id=oid;
 if found then
  if cr.request_hash is distinct from h then raise exception 'OP_ID_REUSED'; end if;
  -- A retry never recreates revoked access. The original grant must still exist.
  perform wbl_private.check_session(cr.league_id,tok);
  return jsonb_build_object('ok',true,'league_id',cr.league_id,'expires_at',(select expires_at from wbl_private.sessions where league_id=cr.league_id and token_hash=sha256(convert_to(tok,'UTF8'))));
 end if;
 if not wbl_private.throttle('create-ip:'||wbl_private.caller_key(),3,interval '1 hour') or not wbl_private.throttle('create-global',60,interval '1 hour') then return jsonb_build_object('error','League creation limit reached. Try again in one hour.'); end if;
 lid:=gen_random_uuid()::text;
 insert into wbl_private.league(id,name,settings,season_json,schedule_json,teams_json) values(lid,nm,p_request->'settings',jsonb_build_object('playerStats','{}'::jsonb,'teamRecords','{}'::jsonb,'seasonSubs','[]'::jsonb,'subStats','{}'::jsonb,'games','[]'::jsonb,'rules',p_request->'settings'),'{"days":[],"teamNames":[]}',p_request->'teams');
 insert into wbl_private.credentials(league_id,code_hash) values(lid,extensions.crypt(p_request->>'code',extensions.gen_salt('bf',12)));
 insert into wbl_private.sessions values(lid,sha256(convert_to(tok,'UTF8')),expires);
 insert into wbl_private.creations values(oid,h,lid);
 return jsonb_build_object('ok',true,'league_id',lid,'expires_at',expires);
end $function$
;
CREATE OR REPLACE FUNCTION public.wbl_join(p_league_id text, p_code text, p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c wbl_private.credentials; expires timestamptz:=null;
begin
 if not wbl_private.throttle('join-ip:'||wbl_private.caller_key(),60,interval '15 minutes') or not wbl_private.throttle('join-league-ip:'||wbl_private.caller_key()||':'||coalesce(p_league_id,''),30,interval '15 minutes') then return jsonb_build_object('error','Too many code attempts. Try again in 15 minutes.'); end if;
 if p_session_token is null or p_session_token !~ '^[a-f0-9]{64}$' or p_code is null or octet_length(p_code)>64 then return jsonb_build_object('error','Invalid access request.'); end if;
 perform 1 from wbl_private.league where id=p_league_id for update;
 select * into c from wbl_private.credentials where league_id=p_league_id;
 if c.code_hash is null or extensions.crypt(p_code,c.code_hash) is distinct from c.code_hash then return jsonb_build_object('error','Incorrect code or league unavailable.'); end if;
 insert into wbl_private.sessions values(p_league_id,sha256(convert_to(p_session_token,'UTF8')),expires) on conflict(league_id,token_hash) do update set expires_at=excluded.expires_at;
 return jsonb_build_object('ok',true,'expires_at',expires);
end $function$
;

-- Recover only an existing committed creation using its original random device token.
create or replace function public.wbl_recover_creation(p_op_id uuid,p_session_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare lid text;
begin
 if p_session_token is null or p_session_token !~ '^[a-f0-9]{64}$' then raise exception 'ACCESS_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_op_id::text,0));
 select league_id into lid from wbl_private.creations where op_id=p_op_id;
 if lid is null then return '{"ok":true}'::jsonb; end if;
 perform wbl_private.check_session(lid,p_session_token);
 return jsonb_build_object('ok',true,'league_id',lid,'expires_at',null);
end $$;
revoke all on function public.wbl_recover_creation(uuid,text) from public;
grant execute on function public.wbl_recover_creation(uuid,text) to anon,authenticated;

-- Protected, bounded management audit. Device references are one-way, not reusable credentials.
create table wbl_private.audit_events (
 id bigint generated always as identity primary key, league_id text not null,
 event_type text not null, occurred_at timestamptz not null default clock_timestamp(), device_ref text
);
alter table wbl_private.audit_events enable row level security;
revoke all on wbl_private.audit_events from public,anon,authenticated;
create index audit_events_league_time on wbl_private.audit_events(league_id,occurred_at);
create function wbl_private.audit_management() returns trigger language plpgsql set search_path='' as $$
declare lid text; event text; ref text; request jsonb;
begin
 if tg_table_name='league' then
  lid:=new.id;
  if tg_op='INSERT' then event:='league_created';
  elsif new.settings is distinct from old.settings then event:='settings_changed';
  elsif new.teams_json is distinct from old.teams_json then event:='teams_changed';
  elsif jsonb_array_length(coalesce(old.season_json->'games','[]'))>0 and jsonb_array_length(coalesce(new.season_json->'games','[]'))=0 then event:='season_reset';
  elsif new.name is distinct from old.name then event:='league_renamed'; end if;
 elsif tg_table_name='credentials' then
  lid:=new.league_id;
  if new.code_hash is distinct from old.code_hash then event:='code_rotated'; end if;
 elsif tg_table_name='sessions' then lid:=old.league_id;event:='device_revoked';ref:=encode(sha256(old.token_hash),'hex'); end if;
 if event is not null then
  if ref is null then
   begin
    request:=nullif(current_setting('request.body',true),'')::jsonb;
    ref:=encode(sha256(convert_to(coalesce(request#>>'{p_request,access_token}',request#>>'{p_request,session_token}',request->>'p_access_token','internal'),'UTF8')),'hex');
   exception when others then ref:=null; end;
  end if;
  insert into wbl_private.audit_events(league_id,event_type,device_ref) values(lid,event,ref);
  delete from wbl_private.audit_events where league_id=lid and (occurred_at<clock_timestamp()-interval '30 days' or id not in (select id from wbl_private.audit_events where league_id=lid order by id desc limit 200));
 end if;
 return null;
end $$;
create trigger audit_league after insert or update on wbl_private.league for each row execute function wbl_private.audit_management();
create trigger audit_code after update on wbl_private.credentials for each row execute function wbl_private.audit_management();
create trigger audit_revoke after delete on wbl_private.sessions for each row execute function wbl_private.audit_management();
revoke all on function wbl_private.audit_management() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.wbl_mutate(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  l wbl_private.league; g wbl_private.games; receipt_row wbl_private.receipts;
  op text:=p_request->>'op'; oid uuid:=(p_request->>'op_id')::uuid;
  gid uuid:=(p_request->>'game_id')::uuid; token text:=p_request->>'token';
  request_hash bytea:=sha256(convert_to((p_request-'access_token')::text,'UTF8'));
  lid text:=p_request->>'league_id'; access_token text:=p_request->>'access_token';
  s jsonb:=p_request->'state'; sr jsonb; slot jsonb; series jsonb;
  ent text; expected_id text; stamp timestamptz; rc jsonb; payload jsonb;
begin
  if jsonb_typeof(p_request) is distinct from 'object' or p_request-'league_id'-'access_token'-'op'-'op_id'-'game_id'-'token'-'league_revision'-'revision'-'epoch'-'name'-'settings'-'teams'-'season'-'schedule'-'state'<>'{}'::jsonb or oid is null or op is null or op not in ('league','start','claim','renew','save','leave','finish')
    or octet_length(p_request::text)>12582912 then
    raise exception 'INVALID_REQUEST';
  end if;
  -- One lock order for every mutation, including game start and league edits.
  select * into strict l from wbl_private.league where id=lid for update;
  perform wbl_private.check_session(lid,access_token);
  select * into receipt_row from wbl_private.receipts where op_id=oid and league_id=lid;
  if found then
    if receipt_row.request_hash <> request_hash then raise exception 'OP_ID_REUSED'; end if;
    return jsonb_build_object('ok',true,'receipt',receipt_row.receipt,
      'data',public.wbl_read(lid,access_token,receipt_row.game_id,token));
  end if;
  stamp:=clock_timestamp(); -- Check expiry AFTER waiting for locks.
  if op='league' then
    if l.revision is distinct from (p_request->>'league_revision')::bigint then raise exception 'LEAGUE_CHANGED: Refresh before editing again.'; end if;
    if exists(select 1 from wbl_private.games where league_id=l.id and status='live') then
      raise exception 'LIVE_GAME: Finish in-progress games before changing the season or rosters.';
    end if;
    if jsonb_typeof(p_request->'season') is distinct from 'object'
      or jsonb_typeof(p_request->'schedule') is distinct from 'object'
      or jsonb_typeof(p_request#>'{teams,teams}') is distinct from 'array'
      or jsonb_array_length(p_request#>'{teams,teams}')>8 then raise exception 'INVALID_LEAGUE'; end if;
    perform wbl_private.validate_text_tree(p_request->'season');
    perform wbl_private.validate_text_tree(p_request->'schedule');
    perform wbl_private.check_teams(p_request->'teams');
    perform wbl_private.check_settings(p_request->'settings');
    if exists(select 1 from jsonb_array_elements(coalesce(l.season_json->'games','[]')) e)
       and p_request#>'{teams,teams}' is distinct from l.teams_json->'teams' then raise exception 'SCORED_SEASON: Reset the season before changing rosters.'; end if;
    if p_request->'settings' is distinct from l.settings and (
      jsonb_array_length(coalesce(l.season_json->'games','[]'))>0 or jsonb_array_length(coalesce(p_request#>'{season,games}','[]'))>0
    ) then raise exception 'SCORED_SEASON: Reset the season before changing rules.'; end if;
    if coalesce(p_request#>'{season,rules}',l.settings) is distinct from p_request->'settings' then raise exception 'SEASON_RULES_CHANGED'; end if;
    if coalesce(length(trim(p_request->>'name')),0) not between 1 and 80 then raise exception 'Invalid league name'; end if;
    perform wbl_private.validate_text_tree(jsonb_build_object('name',p_request->>'name'));
    update wbl_private.league set season_json=p_request->'season',schedule_json=p_request->'schedule',
      teams_json=p_request->'teams',settings=p_request->'settings',name=trim(p_request->>'name'),revision=revision+1,updated_at=stamp where id=l.id returning * into l;
  else
    if token is null or token !~ '^[a-f0-9]{64}$' or gid is null then raise exception 'INVALID_RECORDER'; end if;
    select * into g from wbl_private.games where id=gid and league_id=l.id for update;
    if op='start' then
      if found then raise exception 'GAME_ID_EXISTS'; end if;
      if exists(select 1 from wbl_private.games where league_id=l.id and status='live') then raise exception 'GAME_EXISTS: Resume the current game before starting another.'; end if;
      if l.revision is distinct from (p_request->>'league_revision')::bigint then raise exception 'LEAGUE_CHANGED: Refresh the schedule before starting.'; end if;
      perform wbl_private.validate_state(s);
      if not exists(select 1 from jsonb_array_elements(l.teams_json->'teams') t where t->>'name'=s#>>'{game,team1,name}' and jsonb_array_length(t->'players')>0)
        or not exists(select 1 from jsonb_array_elements(l.teams_json->'teams') t where t->>'name'=s#>>'{game,team2,name}' and jsonb_array_length(t->'players')>0) then raise exception 'Add at least two teams with players before starting a game.'; end if;
      ent:=s#>>'{game,_gameInstanceId}';
      if exists(select 1 from jsonb_array_elements(coalesce(l.season_json->'games','[]')) e where e->>'id'=ent) then raise exception 'ALREADY_COMPLETE'; end if;
      if exists(select 1 from wbl_private.games where league_id=l.id and entry_id=ent and status='live') then raise exception 'GAME_EXISTS: Open the in-progress game from the main menu.'; end if;
      sr:=s#>'{game,_scheduleRef}';
      if sr is not null and sr<>'null'::jsonb then
        series:=l.schedule_json#>array['days',sr->>'dayIndex','games',sr->>'seriesIndex'];
        slot:=series#>array['gamesInSeries',sr->>'seriesGameIndex'];
        expected_id:='scheduled-'||(sr->>'dayIndex')||'-'||(sr->>'seriesIndex')||'-'||(sr->>'seriesGameIndex');
        if slot is null or ent is distinct from expected_id
          or series->>'away' is distinct from s#>>'{game,team1,name}'
          or series->>'home' is distinct from s#>>'{game,team2,name}'
          or coalesce(slot->'result','null')<>'null'::jsonb or coalesce(slot->'skipped','null')<>'null'::jsonb then raise exception 'SLOT_CHANGED'; end if;
      elsif coalesce(s#>'{game,_postseasonRef}','null')<>'null'::jsonb then
        sr:=s#>'{game,_postseasonRef}';
        slot:=l.season_json#>array['postseason','games',sr->>'slotId'];
        expected_id:='postseason-'||(sr->>'bracketId')||'-'||(sr->>'slotId')||'-g'||(sr->>'seriesGameNumber');
        if slot is null or slot->>'status'='final' or ent is distinct from expected_id
          or sr->>'bracketId' is distinct from l.season_json#>>'{postseason,createdAt}'
          or (sr->>'seriesGameNumber')::int is distinct from (coalesce((slot->>'seriesWins1')::int,0)+coalesce((slot->>'seriesWins2')::int,0)+1)
          or slot->>'team1Name' is distinct from s#>>'{game,team1,name}'
          or slot->>'team2Name' is distinct from s#>>'{game,team2,name}' then raise exception 'POSTSEASON_CHANGED'; end if;
      elsif ent is distinct from 'manual-'||gid::text then raise exception 'INVALID_GAME_ID';
      end if;
      insert into wbl_private.games(id,league_id,entry_id,state,owner_hash,lease_until)
        values(gid,l.id,ent,s,sha256(convert_to(token,'UTF8')),stamp+interval '60 seconds') returning * into g;
    else
      if g.id is null then raise exception 'GAME_NOT_FOUND'; end if;
      if g.status<>'live' then raise exception 'ALREADY_COMPLETE'; end if;
      if op='claim' then
        if g.epoch is distinct from (p_request->>'epoch')::bigint or g.revision is distinct from (p_request->>'revision')::bigint then raise exception 'GAME_CHANGED: Load the latest game before taking over.'; end if;
        if g.owner_hash is not null and g.lease_until>stamp then raise exception 'RECORDER_BUSY'; end if;
        update wbl_private.games set owner_hash=sha256(convert_to(token,'UTF8')),epoch=epoch+1,
          lease_until=stamp+interval '60 seconds',updated_at=stamp where id=gid returning * into g;
      else
        if g.owner_hash is distinct from sha256(convert_to(token,'UTF8'))
          or g.epoch is distinct from (p_request->>'epoch')::bigint
          or g.lease_until is null or g.lease_until<=stamp then raise exception 'OWNERSHIP_LOST: Recording paused. Load the server game.'; end if;
        if op='renew' then
          update wbl_private.games set lease_until=stamp+interval '60 seconds' where id=gid returning * into g;
        else
          if g.revision is distinct from (p_request->>'revision')::bigint then raise exception 'GAME_CHANGED: Stale game write rejected.'; end if;
          if op in ('save','finish') then
            perform wbl_private.validate_state(s);
            if s#>>'{game,_gameInstanceId}' is distinct from g.entry_id
              or coalesce(s#>'{game,rules}','{"weeks":6,"innings":3,"outs":2}'::jsonb) is distinct from coalesce(g.state#>'{game,rules}','{"weeks":6,"innings":3,"outs":2}'::jsonb)
              or s#>'{game,team1}' is distinct from g.state#>'{game,team1}'
              or s#>'{game,team2}' is distinct from g.state#>'{game,team2}'
              or s#>'{game,_scheduleRef}' is distinct from g.state#>'{game,_scheduleRef}'
              or s#>'{game,_postseasonRef}' is distinct from g.state#>'{game,_postseasonRef}' then raise exception 'GAME_IDENTITY_CHANGED'; end if;
            update wbl_private.games set state=s,revision=revision+1,updated_at=stamp,
              lease_until=stamp+interval '60 seconds' where id=gid returning * into g;
          end if;
          if op='finish' then
            perform wbl_private.validate_text_tree(p_request->'season');
            perform wbl_private.validate_text_tree(p_request->'schedule');
            if l.revision is distinct from (p_request->>'league_revision')::bigint then raise exception 'LEAGUE_CHANGED: Rebuild the final result from the latest season.'; end if;
            -- Exactly one new log, matching this game's saved score and stats.
            if jsonb_typeof(p_request#>'{season,games}') is distinct from 'array'
              or jsonb_typeof(p_request->'schedule') is distinct from 'object' then raise exception 'INVALID_FINAL_RESULT'; end if;
            select e into payload from jsonb_array_elements(p_request#>'{season,games}') e where e->>'id'=g.entry_id;
            if payload is null
              or coalesce(payload->'rules','{"weeks":6,"innings":3,"outs":2}'::jsonb) is distinct from coalesce(s#>'{game,rules}','{"weeks":6,"innings":3,"outs":2}'::jsonb)
              or coalesce(p_request#>'{season,rules}',l.settings) is distinct from l.settings
              or payload->>'team1Name' is distinct from s#>>'{game,team1,name}'
              or payload->>'team2Name' is distinct from s#>>'{game,team2,name}'
              or payload->'team1Score' is distinct from s#>'{game,team1Score}'
              or payload->'team2Score' is distinct from s#>'{game,team2Score}'
              or payload->'scheduleRef' is distinct from s#>'{game,_scheduleRef}'
              or payload->'postseasonRef' is distinct from s#>'{game,_postseasonRef}'
              or (select jsonb_agg(v order by v::text) from jsonb_array_elements(payload->'playerStats') v)
                 is distinct from (select jsonb_agg(v order by v::text) from jsonb_each(s#>'{game,gameStats}') as x(k,v))
              or (select count(*) from jsonb_array_elements(p_request#>'{season,games}') e where e->>'id'=g.entry_id)<>1
              or exists(select 1 from jsonb_array_elements(coalesce(l.season_json->'games','[]')) e where e->>'id'=g.entry_id)
              or (select coalesce(jsonb_agg(e order by e::text),'[]') from jsonb_array_elements(p_request#>'{season,games}') e where e->>'id'<>g.entry_id)
                 is distinct from (select coalesce(jsonb_agg(e order by e::text),'[]') from jsonb_array_elements(coalesce(l.season_json->'games','[]')) e)
            then raise exception 'INVALID_FINAL_RESULT: Existing game history must be preserved.'; end if;
            update wbl_private.league set season_json=p_request->'season',schedule_json=p_request->'schedule',
              revision=revision+1,updated_at=stamp where id=l.id returning * into l;
            update wbl_private.games set status='complete',owner_hash=null,lease_until=null,epoch=epoch+1
              where id=gid returning * into g;
          elsif op='leave' then
            update wbl_private.games set owner_hash=null,lease_until=null,epoch=epoch+1,updated_at=stamp where id=gid returning * into g;
          end if;
        end if;
      end if;
    end if;
  end if;
  rc:=jsonb_build_object('op_id',oid,'op',op,'game_id',g.id,'revision',g.revision,'epoch',g.epoch,'league_revision',l.revision);
  insert into wbl_private.receipts(op_id,request_hash,game_id,receipt,league_id) values(oid,request_hash,g.id,rc,lid);
  return jsonb_build_object('ok',true,'receipt',rc,'data',public.wbl_read(lid,access_token,g.id,token));
end $function$
;

-- Bound transient throttle storage; inactive windows have no effect after two days.
create index if not exists limits_window_start on wbl_private.limits(window_start);
CREATE OR REPLACE FUNCTION wbl_private.throttle(k text, cap integer, period interval)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c int;
begin
 delete from wbl_private.limits where window_start<clock_timestamp()-interval '2 days';
 insert into wbl_private.limits values(k,clock_timestamp(),1) on conflict(key) do update set
  attempts=case when limits.window_start+period<=clock_timestamp() then 1 else least(limits.attempts+1,cap+1) end,
  window_start=case when limits.window_start+period<=clock_timestamp() then clock_timestamp() else limits.window_start end returning attempts into c;
 return c<=cap;
end $function$
;
CREATE OR REPLACE FUNCTION wbl_private.validate_text_tree(v jsonb, depth integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare item jsonb; k text;
begin
  if depth>40 then raise exception 'INVALID_TEXT: Data nesting is too deep.'; end if;
  if jsonb_typeof(v)='string' and (v#>>'{}') ~ '[<>"\x00-\x08]' then
    raise exception 'INVALID_TEXT: Text must not contain HTML markup, double quotes, or control characters.';
  elsif jsonb_typeof(v)='object' then
    for k,item in select key,value from jsonb_each(v) loop
      if k ~ '[<>"]' or k in ('__proto__','constructor','prototype') then raise exception 'INVALID_TEXT'; end if;
      perform wbl_private.validate_text_tree(item,depth+1);
    end loop;
  elsif jsonb_typeof(v)='array' then
    for item in select value from jsonb_array_elements(v) loop
      perform wbl_private.validate_text_tree(item,depth+1);
    end loop;
  end if;
end $function$
;
