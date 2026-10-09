create extension if not exists pg_trgm with schema extensions;
create index league_name_search on wbl_private.league using gin(name extensions.gin_trgm_ops);
create index receipts_game on wbl_private.receipts(game_id);
create index receipts_league on wbl_private.receipts(league_id);
create index creations_league on wbl_private.creations(league_id);
create or replace function public.wbl_directory(p_search text default '',p_after jsonb default null) returns jsonb language sql stable security definer set search_path='' as $$
 with page as(select id,name,created_at from wbl_private.league where name ilike ('%'||replace(replace(replace(left(coalesce(p_search,''),80),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%')
 and (p_after is null or (created_at,id)>((p_after->>'created_at')::timestamptz,p_after->>'id')) order by created_at,id limit 21)
 select jsonb_build_object('leagues',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'created_at',created_at) order by created_at,id) from (select * from page limit 20) p),'[]'::jsonb),'more',(select count(*)>20 from page))
$$;
revoke all on function public.wbl_directory(text,jsonb) from public;
grant execute on function public.wbl_directory(text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
