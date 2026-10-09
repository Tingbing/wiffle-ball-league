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
