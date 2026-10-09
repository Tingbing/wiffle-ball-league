-- Test fixture only: reconstruct existing handoff schema, without production data.
create schema if not exists wbl_private;
revoke all on schema wbl_private from public, anon, authenticated;
create table wbl_private.league(id text primary key check(id='6767'),revision bigint not null default 1,season_json jsonb not null,schedule_json jsonb not null,teams_json jsonb not null,updated_at timestamptz not null default clock_timestamp());
create table wbl_private.games(id uuid primary key,league_id text not null references wbl_private.league(id),entry_id text not null,status text not null default 'live' check(status in ('live','complete')),state jsonb not null,revision bigint not null default 0,epoch bigint not null default 1,owner_hash bytea,lease_until timestamptz,updated_at timestamptz not null default clock_timestamp(),created_at timestamptz not null default clock_timestamp());
create table wbl_private.receipts(op_id uuid primary key,request_hash bytea not null,game_id uuid references wbl_private.games(id),receipt jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table wbl_private.league enable row level security;
alter table wbl_private.games enable row level security;
alter table wbl_private.receipts enable row level security;
CREATE OR REPLACE FUNCTION wbl_private.game_view(g wbl_private.games, token text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object('id',g.id,'entry_id',g.entry_id,'status',g.status,
    'state',g.state,'revision',g.revision,'epoch',g.epoch,
    'lease_until',g.lease_until,'updated_at',g.updated_at,
    'mine',coalesce(g.owner_hash=sha256(convert_to(token,'UTF8')),false),
    'available',g.status='live' and (g.owner_hash is null or g.lease_until<=clock_timestamp()),
    'server_time',clock_timestamp());
$function$
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
  request_hash bytea:=sha256(convert_to(p_request::text,'UTF8'));
  s jsonb:=p_request->'state'; sr jsonb; slot jsonb; series jsonb;
  ent text; expected_id text; stamp timestamptz; rc jsonb; payload jsonb;
begin
  if oid is null or op is null or op not in ('league','start','claim','renew','save','leave','finish')
    or octet_length(p_request::text)>12582912 then
    raise exception 'INVALID_REQUEST';
  end if;
  -- One lock order for every mutation, including game start and league edits.
  select * into strict l from wbl_private.league where id='6767' for update;
  select * into receipt_row from wbl_private.receipts where op_id=oid;
  if found then
    if receipt_row.request_hash <> request_hash then raise exception 'OP_ID_REUSED'; end if;
    return jsonb_build_object('ok',true,'receipt',receipt_row.receipt,
      'data',public.wbl_read(receipt_row.game_id,token));
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
      or jsonb_array_length(p_request#>'{teams,teams}')>5 then raise exception 'INVALID_LEAGUE'; end if;
    perform wbl_private.validate_text_tree(p_request->'season');
    perform wbl_private.validate_text_tree(p_request->'schedule');
    perform wbl_private.validate_text_tree(p_request->'teams');
    update wbl_private.league set season_json=p_request->'season',schedule_json=p_request->'schedule',
      teams_json=p_request->'teams',revision=revision+1,updated_at=stamp where id=l.id returning * into l;
  else
    if token is null or token !~ '^[a-f0-9]{64}$' or gid is null then raise exception 'INVALID_RECORDER'; end if;
    select * into g from wbl_private.games where id=gid and league_id=l.id for update;
    if op='start' then
      if found then raise exception 'GAME_ID_EXISTS'; end if;
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
  insert into wbl_private.receipts(op_id,request_hash,game_id,receipt) values(oid,request_hash,g.id,rc);
  return jsonb_build_object('ok',true,'receipt',rc,'data',public.wbl_read(g.id,token));
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
      if k ~ '[<>"]' then raise exception 'INVALID_TEXT'; end if;
      perform wbl_private.validate_text_tree(item,depth+1);
    end loop;
  elsif jsonb_typeof(v)='array' then
    for item in select value from jsonb_array_elements(v) loop
      perform wbl_private.validate_text_tree(item,depth+1);
    end loop;
  end if;
end $function$
;
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
  perform wbl_private.validate_text_tree(s-'gameHistory');
  for h in select value from jsonb_array_elements(s->'gameHistory') loop
    perform wbl_private.validate_text_tree((h#>>'{}')::jsonb);
  end loop;
end $function$
;
CREATE OR REPLACE FUNCTION public.wbl_read(p_game_id uuid DEFAULT NULL::uuid, p_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('api_version',3,'league',to_jsonb(l),
    'games',coalesce((select jsonb_agg(jsonb_build_object(
      'id',g.id,'entry_id',g.entry_id,'revision',g.revision,'epoch',g.epoch,
      'team1',g.state#>>'{game,team1,name}','team2',g.state#>>'{game,team2,name}',
      'score1',g.state#>'{game,team1Score}','score2',g.state#>'{game,team2Score}',
      'lease_until',g.lease_until,
      'available',g.owner_hash is null or g.lease_until<=clock_timestamp()
    ) order by g.created_at) from wbl_private.games g where g.league_id=l.id and g.status='live'),'[]'::jsonb),
    'game',(select wbl_private.game_view(g,p_token) from wbl_private.games g where g.id=p_game_id and g.league_id=l.id),
    'server_time',clock_timestamp())
  from wbl_private.league l where l.id='6767';
$function$
;


-- Never expose a restored test fixture through the legacy RPCs.
revoke all on function public.wbl_read(uuid,text),public.wbl_mutate(jsonb) from public,anon,authenticated;
