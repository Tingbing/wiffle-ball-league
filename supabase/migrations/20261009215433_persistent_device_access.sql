-- Remember device access until explicit leave or shared-code rotation.
-- NULL is a permanent grant; keep expires_at for API compatibility.
-- Existing non-revoked grants are preserved, including previously expired rows.
alter table wbl_private.sessions alter column expires_at drop not null;
update wbl_private.sessions set expires_at=null where expires_at is not null;

CREATE OR REPLACE FUNCTION public.wbl_create(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare lid text; h bytea; cr wbl_private.creations; expires timestamptz:=null; nm text:=trim(p_request->>'name'); tok text:=p_request->>'session_token'; oid uuid:=(p_request->>'op_id')::uuid;
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
end $function$;

CREATE OR REPLACE FUNCTION public.wbl_join(p_league_id text, p_code text, p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c wbl_private.credentials; expires timestamptz:=null;
begin
 if not wbl_private.throttle('join-ip:'||wbl_private.caller_key(),60,interval '15 minutes') or not wbl_private.throttle('join-league:'||coalesce(p_league_id,''),30,interval '15 minutes') then return jsonb_build_object('error','Too many code attempts. Try again in 15 minutes.'); end if;
 if p_session_token is null or p_session_token !~ '^[a-f0-9]{64}$' or p_code is null or octet_length(p_code)>64 then return jsonb_build_object('error','Invalid access request.'); end if;
 perform 1 from wbl_private.league where id=p_league_id for update;
 select * into c from wbl_private.credentials where league_id=p_league_id;
 if c.code_hash is null or extensions.crypt(p_code,c.code_hash) is distinct from c.code_hash then return jsonb_build_object('error','Incorrect code or league unavailable.'); end if;
 insert into wbl_private.sessions values(p_league_id,sha256(convert_to(p_session_token,'UTF8')),expires) on conflict(league_id,token_hash) do update set expires_at=excluded.expires_at;
 return jsonb_build_object('ok',true,'expires_at',expires);
end $function$;

CREATE OR REPLACE FUNCTION public.wbl_setup(p_league_id text, p_setup_token text, p_code text, p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c wbl_private.credentials; expires timestamptz:=null;
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
end $function$;

CREATE OR REPLACE FUNCTION wbl_private.check_session(lid text, tok text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if tok is null or tok !~ '^[a-f0-9]{64}$' then raise exception 'ACCESS_REQUIRED: Enter this league’s code.'; end if;
 perform 1 from wbl_private.sessions where league_id=lid and token_hash=sha256(convert_to(tok,'UTF8')) and (expires_at is null or expires_at>clock_timestamp()) for share;
 if not found then raise exception 'ACCESS_REQUIRED: Access was revoked. Enter this league’s code again.'; end if;
end $function$;
