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
