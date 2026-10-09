-- Private, code-based sessions. No browser may select these tables directly.
alter table wbl_private.league drop constraint if exists league_id_check;
alter table wbl_private.league add column name text not null default 'Wiffle Ball League';
alter table wbl_private.league add column settings jsonb not null default '{"weeks":6,"innings":3,"outs":2}';
alter table wbl_private.league add column created_at timestamptz not null default clock_timestamp();
create index league_directory_order on wbl_private.league(created_at,id);
create table wbl_private.credentials(league_id text primary key references wbl_private.league(id), code_hash text, setup_hash bytea);
insert into wbl_private.credentials(league_id) select id from wbl_private.league;
create table wbl_private.sessions(league_id text references wbl_private.league(id), token_hash bytea, expires_at timestamptz not null, primary key(league_id,token_hash));
create table wbl_private.limits(key text primary key, window_start timestamptz not null, attempts int not null);
create table wbl_private.creations(op_id uuid primary key, request_hash bytea not null, league_id text not null references wbl_private.league(id));
alter table wbl_private.receipts add column league_id text references wbl_private.league(id);
update wbl_private.receipts r set league_id=coalesce((select league_id from wbl_private.games g where g.id=r.game_id),(select id from wbl_private.league order by id limit 1));
alter table wbl_private.receipts alter column league_id set not null;
create unique index one_live_game_per_league on wbl_private.games(league_id) where status='live';
alter table wbl_private.credentials enable row level security;
alter table wbl_private.sessions enable row level security;
alter table wbl_private.limits enable row level security;
alter table wbl_private.creations enable row level security;

create function wbl_private.check_code(code text) returns void language plpgsql set search_path='' as $$
begin
 if code is null or octet_length(code) not between 8 and 64 or code=repeat(left(code,1),length(code)) or code !~ '[[:alpha:]]' or code !~ '[[:digit:][:punct:]]' then
  raise exception 'Use an access code with 8–64 bytes, including a letter and a number or symbol.';
 end if;
end $$;
create function wbl_private.check_settings(s jsonb) returns void language plpgsql set search_path='' as $$
begin
 if s is null or jsonb_typeof(s)<>'object' or jsonb_typeof(s->'weeks') is distinct from 'number' or jsonb_typeof(s->'innings') is distinct from 'number' or jsonb_typeof(s->'outs') is distinct from 'number'
 or (s->>'weeks')::numeric not between 1 and 52 or (s->>'weeks')::numeric<>trunc((s->>'weeks')::numeric)
 or (s->>'innings')::numeric not between 1 and 9 or (s->>'innings')::numeric<>trunc((s->>'innings')::numeric)
 or (s->>'outs')::numeric not between 1 and 6 or (s->>'outs')::numeric<>trunc((s->>'outs')::numeric)
 or s-'weeks'-'innings'-'outs'<>'{}'::jsonb then raise exception 'Settings require 1–52 weeks, 1–9 innings and 1–6 outs.'; end if;
end $$;
create function wbl_private.check_teams(t jsonb) returns void language plpgsql set search_path='' as $$
declare team jsonb; n int; names text[]:='{}';
begin
 if jsonb_typeof(t->'teams') is distinct from 'array' then raise exception 'Invalid teams'; end if;
 n:=jsonb_array_length(t->'teams');
 if n not between 2 and 8 then raise exception 'Leagues require 2–8 teams.'; end if;
 for team in select value from jsonb_array_elements(t->'teams') loop
  if coalesce(length(trim(team->>'name')),0) not between 1 and 60 or lower(trim(team->>'name'))=any(names)
   or jsonb_typeof(team->'players') is distinct from 'array' or jsonb_array_length(team->'players')>2 then raise exception 'Each team needs a unique name and at most two roster players.'; end if;
  names:=array_append(names,lower(trim(team->>'name')));
 end loop;
 perform wbl_private.validate_text_tree(t);
end $$;
create function wbl_private.check_session(lid text, tok text) returns void language plpgsql set search_path='' as $$
begin
 if tok is null or tok !~ '^[a-f0-9]{64}$' then raise exception 'ACCESS_REQUIRED: Enter this league’s code.'; end if;
 perform 1 from wbl_private.sessions where league_id=lid and token_hash=sha256(convert_to(tok,'UTF8')) and expires_at>clock_timestamp() for share;
 if not found then raise exception 'ACCESS_REQUIRED: Access expired or was revoked. Enter this league’s code again.'; end if;
end $$;
create function wbl_private.throttle(k text, cap int, period interval) returns boolean language plpgsql set search_path='' as $$
declare c int;
begin
 insert into wbl_private.limits values(k,clock_timestamp(),1) on conflict(key) do update set
  attempts=case when limits.window_start+period<=clock_timestamp() then 1 else least(limits.attempts+1,cap+1) end,
  window_start=case when limits.window_start+period<=clock_timestamp() then clock_timestamp() else limits.window_start end returning attempts into c;
 return c<=cap;
end $$;
create function wbl_private.caller_key() returns text language sql set search_path='' as $$
 select encode(sha256(convert_to(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-forwarded-for','unknown'),'UTF8')),'hex')
$$;
create function public.wbl_directory(p_search text default '', p_after jsonb default null) returns jsonb language sql stable security definer set search_path='' as $$
 with page as(select id,name,created_at from wbl_private.league where strpos(lower(name),lower(left(coalesce(p_search,''),80)))>0
 and (p_after is null or (created_at,id)>((p_after->>'created_at')::timestamptz,p_after->>'id')) order by created_at,id limit 21)
 select jsonb_build_object('leagues',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'created_at',created_at) order by created_at,id) from (select * from page limit 20) p),'[]'::jsonb),
 'more',(select count(*)>20 from page))
$$;
create function public.wbl_join(p_league_id text,p_code text,p_session_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c wbl_private.credentials; expires timestamptz:=clock_timestamp()+interval '7 days';
begin
 if not wbl_private.throttle('join-ip:'||wbl_private.caller_key(),60,interval '15 minutes') or not wbl_private.throttle('join-league:'||coalesce(p_league_id,''),30,interval '15 minutes') then return jsonb_build_object('error','Too many code attempts. Try again in 15 minutes.'); end if;
 if p_session_token is null or p_session_token !~ '^[a-f0-9]{64}$' or p_code is null or octet_length(p_code)>64 then return jsonb_build_object('error','Invalid access request.'); end if;
 perform 1 from wbl_private.league where id=p_league_id for update;
 select * into c from wbl_private.credentials where league_id=p_league_id;
 if c.code_hash is null or extensions.crypt(p_code,c.code_hash) is distinct from c.code_hash then return jsonb_build_object('error','Incorrect code or league unavailable.'); end if;
 insert into wbl_private.sessions values(p_league_id,sha256(convert_to(p_session_token,'UTF8')),expires) on conflict(league_id,token_hash) do update set expires_at=excluded.expires_at;
 return jsonb_build_object('ok',true,'expires_at',expires);
end $$;
create function public.wbl_create(p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare lid text; h bytea; cr wbl_private.creations; expires timestamptz:=clock_timestamp()+interval '7 days'; nm text:=trim(p_request->>'name'); tok text:=p_request->>'session_token'; oid uuid:=(p_request->>'op_id')::uuid;
begin
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
end $$;
create function public.wbl_leave_access(p_league_id text,p_access_token text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform 1 from wbl_private.league where id=p_league_id for update;
 delete from wbl_private.sessions where league_id=p_league_id and token_hash=sha256(convert_to(p_access_token,'UTF8'));
 return '{"ok":true}'::jsonb;
end $$;
create function public.wbl_change_code(p_league_id text,p_access_token text,p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform 1 from wbl_private.league where id=p_league_id for update;
 perform wbl_private.check_session(p_league_id,p_access_token); perform wbl_private.check_code(p_code);
 update wbl_private.credentials set code_hash=extensions.crypt(p_code,extensions.gen_salt('bf',12)) where league_id=p_league_id;
 delete from wbl_private.sessions where league_id=p_league_id;
 update wbl_private.games set owner_hash=null,lease_until=null,epoch=epoch+1 where league_id=p_league_id and status='live';
 return '{"ok":true}'::jsonb;
end $$;
-- One-time setup is only possible with a separate, privately provisioned random token.
create function public.wbl_setup(p_league_id text,p_setup_token text,p_code text,p_session_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c wbl_private.credentials; expires timestamptz:=clock_timestamp()+interval '7 days';
begin
 if not wbl_private.throttle('setup-ip:'||wbl_private.caller_key(),10,interval '15 minutes') then return jsonb_build_object('error','Too many setup attempts. Try again in 15 minutes.'); end if;
 perform wbl_private.check_code(p_code);
 if p_session_token is null or p_session_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid session token'; end if;
 perform 1 from wbl_private.league where id=p_league_id for update;
 select * into c from wbl_private.credentials where league_id=p_league_id for update;
 if c.code_hash is not null or c.setup_hash is null or c.setup_hash is distinct from sha256(convert_to(p_setup_token,'UTF8')) then return jsonb_build_object('error','Setup token is invalid or already used.'); end if;
 update wbl_private.credentials set code_hash=extensions.crypt(p_code,extensions.gen_salt('bf',12)),setup_hash=null where league_id=p_league_id;
 insert into wbl_private.sessions values(p_league_id,sha256(convert_to(p_session_token,'UTF8')),expires);
 return jsonb_build_object('ok',true,'expires_at',expires);
end $$;
-- Remove all old unauthenticated read paths before enabling the new client.
revoke all on function public.wbl_read(uuid,text) from public,anon,authenticated;
create function public.wbl_read(p_league_id text,p_access_token text,p_game_id uuid default null,p_token text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare l wbl_private.league; result jsonb;
begin
 select * into l from wbl_private.league where id=p_league_id for share;
 perform wbl_private.check_session(p_league_id,p_access_token);
 if l.id is null then raise exception 'League unavailable'; end if;
 select jsonb_build_object('api_version',4,'league',to_jsonb(l),'server_time',clock_timestamp(),
 'games',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'entry_id',g.entry_id,'status',g.status,'revision',g.revision,'epoch',g.epoch,'lease_until',g.lease_until,'team1',g.state#>>'{game,team1,name}','team2',g.state#>>'{game,team2,name}') order by g.created_at) from wbl_private.games g where g.league_id=l.id and g.status='live'),'[]'::jsonb),
 'game',(select wbl_private.game_view(g,p_token) from wbl_private.games g where g.id=p_game_id and g.league_id=l.id)) into result;
 return result;
end $$;

CREATE OR REPLACE FUNCTION wbl_private.validate_state(s jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare h jsonb;
begin
  if s is null or jsonb_typeof(s)<>'object' or octet_length(s::text)>4194304
    or jsonb_typeof(s->'game') is distinct from 'object'
    or jsonb_typeof(s->'gameHistory') is distinct from 'array'
    or jsonb_typeof(s#>'{game,gameStats}') is distinct from 'object'
    or jsonb_typeof(s#>'{game,bases}') is distinct from 'object'
    or coalesce(s#>>'{game,halfInning}','') not in ('top','bottom')
    or coalesce((s#>>'{game,inning}')::integer,0)<1
    or coalesce(s#>>'{game,team1,name}','')=''
    or coalesce(s#>>'{game,team2,name}','')=''
    or s#>>'{game,team1,name}'=s#>>'{game,team2,name}'
    or coalesce(s#>>'{game,_gameInstanceId}','')='' then
    raise exception 'INVALID_STATE: Complete game state is required (maximum 4 MiB).';
  end if;
  if coalesce((s#>>'{game,outs}')::int,-1)<0 or coalesce((s#>>'{game,outs}')::int,-1)>coalesce((s#>>'{game,rules,outs}')::int,2) then raise exception 'INVALID_OUTS'; end if;
  if s#>'{game,rules}' is not null then perform wbl_private.check_settings(s#>'{game,rules}'); end if;
  perform wbl_private.validate_text_tree(s-'gameHistory');
  for h in select value from jsonb_array_elements(s->'gameHistory') loop
    perform wbl_private.validate_text_tree((h#>>'{}')::jsonb);
  end loop;
end $function$

;

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
  if oid is null or op is null or op not in ('league','start','claim','renew','save','leave','finish')
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

-- Defense in depth: the API role can execute only this version's gated RPCs.
do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','wbl_private') and p.prokind='f' and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 end loop;
 for r in select c.oid::regclass as relation,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','wbl_private') and c.relkind in ('r','p','v','m') and not exists(select 1 from pg_depend d where d.objid=c.oid and d.deptype='e') loop
  execute format('revoke all on %s from public,anon,authenticated',r.relation);
  if r.relkind in ('r','p') then execute format('alter table %s enable row level security',r.relation); end if;
 end loop;
 for r in select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname in ('public','wbl_private') loop
  execute format('alter publication supabase_realtime drop table %I.%I',r.schemaname,r.tablename);
 end loop;
end $$;
revoke all on schema wbl_private from public,anon,authenticated;
revoke all on all sequences in schema public,wbl_private from public,anon,authenticated;
grant execute on function public.wbl_directory(text,jsonb),public.wbl_join(text,text,text),public.wbl_create(jsonb),public.wbl_leave_access(text,text),public.wbl_change_code(text,text,text),public.wbl_setup(text,text,text,text),public.wbl_read(text,text,uuid,text),public.wbl_mutate(jsonb) to anon,authenticated;
notify pgrst,'reload schema';
