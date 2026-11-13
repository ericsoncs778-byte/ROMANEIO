-- ROMANEIO: additive cloud storage, scoped to an explicitly provisioned workspace.
create table public.romaneio_workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  nome text not null,
  created_at timestamptz not null default now()
);
create table public.romaneio_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.romaneio_workspaces(id),
  access_role text not null default 'operator' check (access_role in ('admin','operator','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index romaneio_members_workspace_idx on public.romaneio_members(workspace_id);
create table public.romaneio_lojas (
  workspace_id uuid not null references public.romaneio_workspaces(id),
  nome text not null,
  endereco text not null,
  active boolean not null default true,
  primary key (workspace_id, nome)
);

-- A JSON payload retains every v45 field, including pallets, invoices and returnables.
-- A version per shipment detects concurrent edits rather than overwriting them.
create table public.romaneios (
  workspace_id uuid not null references public.romaneio_workspaces(id),
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  payload jsonb not null,
  loja text generated always as (payload->>'loja') stored not null,
  version bigint not null default 1 check (version > 0),
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, loja) references public.romaneio_lojas(workspace_id, nome),
  constraint romaneio_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint romaneio_payload_id check (jsonb_typeof(payload->'id') = 'string' and payload->>'id' is not null and payload->>'id' = id),
  constraint romaneio_payload_size check (octet_length(payload::text) <= 262144),
  constraint romaneio_payload_paletes check (coalesce(jsonb_typeof(payload->'paletes'),'') = 'array' and jsonb_array_length(payload->'paletes') between 1 and 200),
  constraint romaneio_payload_conferidos check (coalesce(jsonb_typeof(payload->'conferidos'),'') = 'array'),
  constraint romaneio_payload_tipo check (coalesce(payload->>'tipo','') in ('CARGA SECA','HORTI','FRIOS','CONGELADOS')),
  constraint romaneio_payload_grupo check (payload->>'grupoConjugado' is null or payload->>'grupoConjugado' ~ '^[A-Za-z0-9_-]{1,100}$')
);
create index romaneios_loja_idx on public.romaneios(workspace_id, loja);
create index romaneios_updated_idx on public.romaneios(workspace_id, updated_at);
create index romaneios_created_by_idx on public.romaneios(created_by);
create index romaneios_updated_by_idx on public.romaneios(updated_by);

alter table public.romaneio_workspaces enable row level security;
alter table public.romaneio_members enable row level security;
alter table public.romaneio_lojas enable row level security;
alter table public.romaneios enable row level security;

-- New signups cannot grant themselves membership or join another workspace.
create policy romaneio_members_read_self on public.romaneio_members for select to authenticated
  using (user_id = (select auth.uid()) and active);
create policy romaneio_workspaces_read_member on public.romaneio_workspaces for select to authenticated
  using (id in (select workspace_id from public.romaneio_members where user_id = (select auth.uid()) and active));
create policy romaneio_lojas_read_member on public.romaneio_lojas for select to authenticated
  using (workspace_id in (select workspace_id from public.romaneio_members where user_id = (select auth.uid()) and active));
create policy romaneios_read_member on public.romaneios for select to authenticated
  using (workspace_id in (select workspace_id from public.romaneio_members where user_id = (select auth.uid()) and active));
create policy romaneios_insert_writer on public.romaneios for insert to authenticated
  with check (created_by = (select auth.uid()) and updated_by = (select auth.uid()) and
    workspace_id in (select workspace_id from public.romaneio_members where user_id = (select auth.uid()) and active and access_role in ('admin','operator')));
create policy romaneios_update_writer on public.romaneios for update to authenticated
  using (workspace_id in (select workspace_id from public.romaneio_members where user_id = (select auth.uid()) and active and access_role in ('admin','operator')))
  with check (workspace_id in (select workspace_id from public.romaneio_members where user_id = (select auth.uid()) and active and access_role in ('admin','operator')));

revoke all on public.romaneio_workspaces, public.romaneio_members, public.romaneio_lojas, public.romaneios from public, anon, authenticated;
grant select on public.romaneio_workspaces, public.romaneio_members, public.romaneio_lojas, public.romaneios to authenticated;
grant insert (workspace_id, id, payload) on public.romaneios to authenticated;
grant update (payload) on public.romaneios to authenticated;

create function public.romaneio_stamp_update() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke execute on function public.romaneio_stamp_update() from public, anon, authenticated;
create trigger romaneios_stamp_update before update on public.romaneios
  for each row execute function public.romaneio_stamp_update();

-- SECURITY INVOKER: the caller's grants and RLS apply to every operation.
-- The entire batch succeeds or rolls back, including multi-store truck loads.
create function public.save_romaneios(p_changes jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_workspace uuid;
  v_change jsonb;
  v_version bigint;
  v_result jsonb := '[]'::jsonb;
  v_row public.romaneios;
  v_seen text[] := array[]::text[];
begin
  select workspace_id into v_workspace from public.romaneio_members
    where user_id = auth.uid() and active and access_role in ('admin','operator');
  if v_workspace is null then raise insufficient_privilege using message = 'ROMANEIO_ACCESS_DENIED'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 200 then
    raise check_violation using message = 'ROMANEIO_INVALID_BATCH';
  end if;
  -- Deterministic lock order reduces deadlocks between simultaneous batch saves.
  for v_change in select value from jsonb_array_elements(p_changes) order by value->>'id' loop
    if jsonb_typeof(v_change) is distinct from 'object' or v_change->>'id' is null or
       v_change->>'id' = any(v_seen) or jsonb_typeof(v_change->'expectedVersion') is distinct from 'number' or
       (v_change->>'expectedVersion') !~ '^[0-9]{1,15}$' then
      raise check_violation using message = 'ROMANEIO_INVALID_CHANGE';
    end if;
    v_seen := array_append(v_seen, v_change->>'id');
    v_version := (v_change->>'expectedVersion')::bigint;
    if v_version = 0 then
      begin
        insert into public.romaneios (workspace_id, id, payload)
          values (v_workspace, v_change->>'id', v_change->'payload') returning * into v_row;
      exception when unique_violation then
        raise serialization_failure using message = 'ROMANEIO_CONFLICT';
      end;
    else
      update public.romaneios set payload = v_change->'payload'
        where workspace_id = v_workspace and id = v_change->>'id' and version = v_version returning * into v_row;
      if not found then raise serialization_failure using message = 'ROMANEIO_CONFLICT'; end if;
    end if;
    v_result := v_result || jsonb_build_array(jsonb_build_object('id',v_row.id,'payload',v_row.payload,'version',v_row.version,'updated_at',v_row.updated_at));
  end loop;
  return v_result;
end;
$$;
revoke execute on function public.save_romaneios(jsonb) from public, anon, authenticated;
grant execute on function public.save_romaneios(jsonb) to authenticated;

insert into public.romaneio_workspaces (slug, nome) values ('romaneio-hiperideal','ROMANEIO Hiperideal');
-- Only the existing, explicitly requested application account gets initial access.
insert into public.romaneio_members (user_id, workspace_id, access_role)
  select u.id, w.id, 'admin' from auth.users u cross join public.romaneio_workspaces w
  where lower(u.email) = 'ericson.silva@hiperideal.com.br' and u.email_confirmed_at is not null and w.slug = 'romaneio-hiperideal';

insert into public.romaneio_lojas (workspace_id,nome,endereco,active)
 select w.id,l.nome,l.endereco,position('temporariamente fechada' in l.nome)=0
 from public.romaneio_workspaces w cross join jsonb_to_recordset('[{"nome": "Amazonas", "endereco": "Rua Amazonas, 1541 - Pituba - Salvador - BA - CEP 41830-380"}, {"nome": "Apipema", "endereco": "Rua Professor Sabino Silva, 607 - Apipema - Salvador - BA - CEP 40155-250"}, {"nome": "Armação", "endereco": "Avenida Simon Bolívar, s/n - Armação - Salvador - BA - CEP 41750-230"}, {"nome": "Barra", "endereco": "Rua Marquês de Caravelas, 171 - Barra - Salvador - BA - CEP 40140-241"}, {"nome": "Canela", "endereco": "Avenida Reitor Miguel Calmon, 1977 - Canela - Salvador - BA - CEP 40110-100"}, {"nome": "Graça", "endereco": "Avenida Euclydes da Cunha, 8 - Graça - Salvador - BA - CEP 40150-120"}, {"nome": "Horto", "endereco": "Avenida Vasco da Gama, 864 - Brotas - Salvador - BA - CEP 40290-350"}, {"nome": "Lapa", "endereco": "Avenida Vale do Tororó, Estação da Lapa, s/n - Tororó - Salvador - BA - CEP 40050-290"}, {"nome": "Manoel Dias", "endereco": "Avenida Manoel Dias da Silva, 1175 - Pituba - Salvador - BA - CEP 40830-000"}, {"nome": "Shopping Paralela", "endereco": "Avenida Luís Viana, 8544 - Patamares - Salvador - BA - CEP 41730-101"}, {"nome": "Vila Laura", "endereco": "Rua Raul Leite, 46 - Vila Laura - Salvador - BA - CEP 40270-010"}, {"nome": "Vitória", "endereco": "Avenida Sete de Setembro, 304 - Campo Grande - Salvador - BA - CEP 40080-001"}, {"nome": "Alphaville", "endereco": "Avenida Alphaville, s/n - Alphaville I - Salvador - BA - CEP 41701-015"}, {"nome": "Aquarius", "endereco": "Rua Desembargador Álvaro Clemente de Oliveira, 1681 - Aquarius - Salvador - BA - CEP 41771-020"}, {"nome": "Caminho das Árvores", "endereco": "Alameda dos Sombreiros, 270 - Caminho das Árvores - Salvador - BA - CEP 41820-420"}, {"nome": "Cidade Jardim", "endereco": "Avenida Juracy Magalhães Júnior, 1034 - Cidade Jardim - Salvador - BA - CEP 40295-140"}, {"nome": "Eco Stella", "endereco": "Rua Capitão Melo, 171 - Stella Maris - Salvador - BA - CEP 41600-610"}, {"nome": "Feira de Santana", "endereco": "Avenida Noide Ferreira de Cerqueira, 7450 - Feira de Santana - BA - CEP 44082-225"}, {"nome": "Guarajuba", "endereco": "Rodovia BA-099 Estrada do Coco, km 42 - Guarajuba - Camaçari - BA - CEP 42840-310"}, {"nome": "Itaigara", "endereco": "Rua Anísio Teixeira, s/n - Itaigara - Salvador - BA - CEP 41815-060"}, {"nome": "Litoral Norte", "endereco": "Estrada do Coco, 8222 - Portão - Lauro de Freitas - BA - CEP 42700-000"}, {"nome": "Orla", "endereco": "Avenida Octávio Mangabeira, 4435 - Armação - Salvador - BA - CEP 41750-240"}, {"nome": "Orlando Gomes", "endereco": "Rua da Gratidão, s/n - Piatã - Salvador - BA - CEP 41650-195"}, {"nome": "Parque Shopping Bahia", "endereco": "Avenida Santos Dumont, 4360, lojas 1057/1058 - Centro - Lauro de Freitas - BA - CEP 42702-400"}, {"nome": "Patamares", "endereco": "Avenida Ibaripitanga, 374 - Patamares - Salvador - BA - CEP 41680-360"}, {"nome": "Piatã (temporariamente fechada)", "endereco": "Avenida Otávio Mangabeira, 1024 - Piatã - Salvador - BA - CEP 41650-000"}, {"nome": "Pituba", "endereco": "Rua Ceará, 339 - Pituba - Salvador - BA - CEP 40301-155"}, {"nome": "Praia do Forte", "endereco": "Rodovia BA-099, km 54, lote 04 - Praia do Forte - Mata de São João - BA - CEP 48280-000"}, {"nome": "Stella Maris", "endereco": "Rua Missionário Otto Nelson, 100 - Stella Maris - Salvador - BA - CEP 41600-650"}, {"nome": "Hiperideal em Casa - Costa España", "endereco": "Avenida Oceânica, 1454 - Barra - Salvador - BA - CEP 40170-010 (acesso exclusivo a moradores)"}, {"nome": "Hiperideal em Casa - Hemisphere", "endereco": "Rua Sítio do Pombal, 300 - Pituaçu - Salvador - BA - CEP 41740-380 (acesso exclusivo a moradores)"}, {"nome": "Hiperideal em Casa - Iberostate", "endereco": "BA-099, km 57 - Açu da Torre - Mata de São João - BA - CEP 48280-000 (acesso exclusivo a moradores)"}, {"nome": "Hiperideal em Casa - Panamby", "endereco": "Avenida Santa Luzia, 610 - Horto Florestal - Salvador - BA - CEP 40286-000 (acesso exclusivo a moradores)"}, {"nome": "Hiperideal em Casa - Sauípe", "endereco": "Rodovia BA-099, km 76 - Mata de São João - BA - CEP 48280-000 (acesso exclusivo a moradores)"}, {"nome": "Padoca Ideal - Le Parc", "endereco": "Rua Le Champ, loja 131 - Patamares - Salvador - BA - CEP 41680-090"}, {"nome": "Fábrica de Pães Hiperideal", "endereco": "Avenida Octávio Mangabeira, 4435 - Armação - Salvador - BA - CEP 41750-240"}]'::jsonb) as l(nome text,endereco text)
 where w.slug='romaneio-hiperideal';
