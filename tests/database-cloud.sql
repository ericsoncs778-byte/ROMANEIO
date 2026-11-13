-- Run with a trusted SQL administrator. All test rows and role changes roll back.
begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where lower(email)='ericson.silva@hiperideal.com.br'), true);
insert into public.romaneio_workspaces (slug,nome) values ('__romaneio_isolation_test__','Transactional isolation test');
insert into public.romaneio_lojas (workspace_id,nome,endereco)
  select id,'Amazonas','Test' from public.romaneio_workspaces where slug='__romaneio_isolation_test__';
insert into public.romaneios (workspace_id,id,payload,created_by,updated_by)
  select w.id,'ROM-OTHER-TEST','{"id":"ROM-OTHER-TEST","loja":"Amazonas","tipo":"CARGA SECA","paletes":[{"notas":["TEST"]}],"conferidos":[]}'::jsonb,auth.uid(),auth.uid()
  from public.romaneio_workspaces w where slug='__romaneio_isolation_test__';
set local role authenticated;
do $$
declare
  p jsonb := '{"id":"ROM-CLOUD-TEST","loja":"Amazonas","tipo":"CARGA SECA","paletes":[{"notas":["TEST"]}],"conferidos":[]}'::jsonb;
  result jsonb;
begin
  if exists(select 1 from public.romaneios where id='ROM-OTHER-TEST') then raise exception 'Cross-workspace data leak'; end if;
  if has_table_privilege('anon','public.romaneios','SELECT') then raise exception 'Anonymous SELECT allowed'; end if;
  if has_table_privilege('authenticated','public.romaneio_members','INSERT') then raise exception 'Self-enrollment allowed'; end if;
  if has_table_privilege('authenticated','public.romaneios','DELETE') then raise exception 'Physical delete allowed'; end if;
  if has_function_privilege('anon','public.save_romaneios(jsonb)','EXECUTE') then raise exception 'Anonymous RPC allowed'; end if;
  result := public.save_romaneios(jsonb_build_array(jsonb_build_object('id','ROM-CLOUD-TEST','payload',p,'expectedVersion',0)));
  if (result->0->>'version')::int <> 1 then raise exception 'Insert version incorrect'; end if;
  result := public.save_romaneios(jsonb_build_array(jsonb_build_object('id','ROM-CLOUD-TEST','payload',p||'{"status":"Em trânsito"}'::jsonb,'expectedVersion',1)));
  if (result->0->>'version')::int <> 2 then raise exception 'Update version incorrect'; end if;
  begin
    perform public.save_romaneios(jsonb_build_array(
      jsonb_build_object('id','ROM-BATCH-TEST','payload',p||'{"id":"ROM-BATCH-TEST"}'::jsonb,'expectedVersion',0),
      jsonb_build_object('id','ROM-CLOUD-TEST','payload',p,'expectedVersion',1)));
    raise exception 'Stale version accepted';
  exception when serialization_failure then null;
  end;
  if exists(select 1 from public.romaneios where id='ROM-BATCH-TEST') then raise exception 'Failed batch partially saved'; end if;
  if (select version from public.romaneios where id='ROM-CLOUD-TEST') <> 2 then raise exception 'Conflict overwrote record'; end if;
end;
$$;
reset role;
update public.romaneio_members set access_role='viewer' where user_id=auth.uid();
set local role authenticated;
do $$
begin
  if not exists(select 1 from public.romaneios where id='ROM-CLOUD-TEST') then raise exception 'Viewer cannot read'; end if;
  begin
    perform public.save_romaneios('[{"id":"ROM-DENIED","expectedVersion":0,"payload":{}}]'::jsonb);
    raise exception 'Viewer wrote data';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
do $$
begin
  if exists(select 1 from public.romaneios) then raise exception 'Unprovisioned user can read'; end if;
  begin
    perform public.save_romaneios('[{"id":"ROM-DENIED","expectedVersion":0,"payload":{}}]'::jsonb);
    raise exception 'Unprovisioned user wrote data';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
select jsonb_build_object(
  'rls_tables',(select count(*) from pg_tables where schemaname='public' and tablename in ('romaneio_workspaces','romaneio_members','romaneio_lojas','romaneios') and rowsecurity),
  'lojas',(select count(*) from public.romaneio_lojas),
  'initial_admin',(select count(*) from public.romaneio_members m join auth.users u on u.id=m.user_id where lower(u.email)='ericson.silva@hiperideal.com.br' and m.access_role='admin' and m.active),
  'test_rows_remaining',(select count(*) from public.romaneios where id in ('ROM-OTHER-TEST','ROM-CLOUD-TEST','ROM-BATCH-TEST')),
  'test_workspaces_remaining',(select count(*) from public.romaneio_workspaces where slug='__romaneio_isolation_test__')
) as cloud_verification;
