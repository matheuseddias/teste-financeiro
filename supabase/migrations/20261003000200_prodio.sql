-- Cópia mínima de leitura do Prodio. Nunca modifica documentos na origem nem cria caixa realizado.
create table if not exists public.fin_prodio_sources (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.fin_tenants(id),
 kind text not null check(kind in ('pedidos','compras','notas')),enabled boolean not null default false,
 company_external_id uuid,company_name text,timezone text,validated_at timestamptz,cursor jsonb not null default '{}'::jsonb,
 last_attempt_at timestamptz,last_success_at timestamptz,last_full_sync_at timestamptz,last_error text,next_attempt_at timestamptz,
 lease_id uuid,lease_until timestamptz,failure_count integer not null default 0,version integer not null default 1,
 deleted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(tenant_id,kind)
);
create table if not exists public.fin_prodio_documents (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.fin_tenants(id),kind text not null,
 source_id uuid not null,source_updated_at timestamptz not null,business_date date,amount_cents bigint not null check(amount_cents between 0 and 9000000000000),
 status text,description text not null check(length(description) between 1 and 120),channel_key text,channel_name text,
 invoice_key text check(invoice_key ~ '^[0-9]{44}$'),supplier_id uuid,purchase_ids uuid[] not null default '{}',payment_terms integer[] not null default '{}',expected_date date,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),version integer not null default 1,deleted_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(tenant_id,kind,source_id),
 foreign key(tenant_id,kind) references public.fin_prodio_sources(tenant_id,kind)
);
alter table public.fin_prodio_sources enable row level security;
alter table public.fin_prodio_documents enable row level security;
revoke all on public.fin_prodio_sources,public.fin_prodio_documents from public,anon,authenticated,service_role;
grant select on public.fin_prodio_sources,public.fin_prodio_documents to authenticated,service_role;
drop policy if exists fin_prodio_sources_read on public.fin_prodio_sources;
create policy fin_prodio_sources_read on public.fin_prodio_sources for select to authenticated using(public.fin_can(tenant_id,'admin',true));
drop policy if exists fin_prodio_documents_read on public.fin_prodio_documents;
create policy fin_prodio_documents_read on public.fin_prodio_documents for select to authenticated using(public.fin_can(tenant_id,'admin',true));
drop trigger if exists fin_audit_prodio_sources on public.fin_prodio_sources;
create trigger fin_audit_prodio_sources after insert or update or delete on public.fin_prodio_sources for each row execute function public.fin_audit();
drop trigger if exists fin_audit_prodio_documents on public.fin_prodio_documents;
create trigger fin_audit_prodio_documents after insert or update or delete on public.fin_prodio_documents for each row execute function public.fin_audit();

create or replace function public.fin_prodio_claim(p_tenant_id uuid,p_kind text,p_probe boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.fin_prodio_sources;
begin
 if p_tenant_id<>'edd1a500-0000-4000-8000-000000000001' then raise exception 'Grupo não liberado.' using errcode='42501'; end if;
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 if exists(select 1 from public.fin_prodio_sources where tenant_id=p_tenant_id and (lease_until>now() or next_attempt_at>now())) then return null; end if;
 insert into public.fin_prodio_sources(tenant_id,kind) values(p_tenant_id,p_kind) on conflict(tenant_id,kind) do nothing;
 select * into s from public.fin_prodio_sources where tenant_id=p_tenant_id and kind=p_kind for update;
 if s.deleted_at is not null or (not coalesce(p_probe,false) and s.validated_at is null) then return null; end if;
 update public.fin_prodio_sources set lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds',next_attempt_at=now()+interval '60 seconds',last_attempt_at=now(),version=version+1,updated_at=now()
 where id=s.id returning * into s;return to_jsonb(s);
end $$;

create or replace function public.fin_prodio_finish(p_tenant_id uuid,p_kind text,p_lease uuid,p_probe boolean,p_documents jsonb,p_cursor jsonb,p_done boolean,
 p_company_id uuid,p_company_name text,p_timezone text,p_error text,p_temporary boolean default false,p_retry_seconds integer default 60) returns void
language plpgsql security definer set search_path='' as $$
declare s public.fin_prodio_sources;d jsonb;
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 select * into s from public.fin_prodio_sources where tenant_id=p_tenant_id and kind=p_kind for update;
 if s.id is null or p_lease is null or s.lease_id is null or s.lease_until is null or s.lease_id is distinct from p_lease or s.lease_until<now() then raise exception 'Consulta vencida ou substituída.' using errcode='40001'; end if;
 if p_error is not null then
  update public.fin_prodio_sources set last_error=left(p_error,300),failure_count=failure_count+1,
   enabled=case when coalesce(p_temporary,false) and failure_count<4 then enabled else false end,
   validated_at=case when coalesce(p_temporary,false) and failure_count<4 then validated_at else null end,
   next_attempt_at=now()+make_interval(secs=>greatest(60,least(coalesce(p_retry_seconds,60),31536000))),lease_id=null,lease_until=null,version=version+1,updated_at=now() where id=s.id;return;
 end if;
 if p_company_id is null or nullif(trim(p_company_name),'') is null or nullif(trim(p_timezone),'') is null or
  exists(select 1 from public.fin_prodio_sources where tenant_id=p_tenant_id and company_external_id is not null and company_external_id<>p_company_id) then raise exception 'Empresa do token diverge da conexão.' using errcode='42501'; end if;
 if p_documents is null or jsonb_typeof(p_documents)<>'array' or jsonb_array_length(p_documents)>200 or octet_length(p_documents::text)>1000000 or p_cursor is null or jsonb_typeof(p_cursor)<>'object' then raise exception 'Lote inválido.' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_documents) x group by x->>'source_id' having count(*)>1) then raise exception 'Identificador repetido.' using errcode='22023'; end if;
 if not coalesce(p_probe,false) then
  for d in select value from jsonb_array_elements(p_documents) loop
   if jsonb_typeof(d)<>'object' or coalesce(d->>'amount_cents','') !~ '^[0-9]+$' or jsonb_typeof(d->'amount_cents')<>'number' or jsonb_typeof(d->'purchase_ids')<>'array' or jsonb_typeof(d->'payment_terms')<>'array' then raise exception 'Documento inválido.' using errcode='22023'; end if;
   insert into public.fin_prodio_documents(tenant_id,kind,source_id,source_updated_at,business_date,amount_cents,status,description,channel_key,channel_name,invoice_key,supplier_id,purchase_ids,payment_terms,expected_date,fingerprint)
   values(p_tenant_id,p_kind,(d->>'source_id')::uuid,(d->>'source_updated_at')::timestamptz,(d->>'business_date')::date,(d->>'amount_cents')::bigint,d->>'status',d->>'description',d->>'channel_key',d->>'channel_name',d->>'invoice_key',(d->>'supplier_id')::uuid,
    array(select value::uuid from jsonb_array_elements_text(d->'purchase_ids')),array(select value::integer from jsonb_array_elements_text(d->'payment_terms')),(d->>'expected_date')::date,d->>'fingerprint')
   on conflict(tenant_id,kind,source_id) do update set source_updated_at=excluded.source_updated_at,business_date=excluded.business_date,amount_cents=excluded.amount_cents,status=excluded.status,description=excluded.description,
    channel_key=excluded.channel_key,channel_name=excluded.channel_name,invoice_key=excluded.invoice_key,supplier_id=excluded.supplier_id,purchase_ids=excluded.purchase_ids,payment_terms=excluded.payment_terms,expected_date=excluded.expected_date,
    fingerprint=excluded.fingerprint,version=public.fin_prodio_documents.version+1,updated_at=now()
   where excluded.source_updated_at>=public.fin_prodio_documents.source_updated_at and public.fin_prodio_documents.fingerprint is distinct from excluded.fingerprint;
  end loop;
 end if;
 update public.fin_prodio_sources set company_external_id=p_company_id,company_name=left(p_company_name,120),timezone=left(p_timezone,120),validated_at=coalesce(validated_at,now()),last_error=null,failure_count=0,
  last_success_at=case when p_probe then last_success_at else now() end,last_full_sync_at=case when p_done and not p_probe then now() else last_full_sync_at end,cursor=case when p_probe then cursor else p_cursor end,
  lease_id=null,lease_until=null,version=version+1,updated_at=now() where id=s.id;
end $$;

create or replace function public.fin_prodio_enable(p_tenant_id uuid,p_id uuid,p_enabled boolean,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;perform public.fin_require(p_tenant_id,'admin',true);
 update public.fin_prodio_sources set enabled=p_enabled,version=version+1,updated_at=now() where tenant_id=p_tenant_id and id=p_id and version=p_version and deleted_at is null and (not p_enabled or validated_at is not null);
 if not found then raise exception 'Teste a conexão ou atualize os dados.' using errcode='40001'; end if;
end $$;
create or replace function public.fin_prodio_bootstrap_enable(p_tenant_id uuid,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_tenant_id<>'edd1a500-0000-4000-8000-000000000001' then raise exception 'Grupo não liberado.' using errcode='42501'; end if;
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 update public.fin_prodio_sources set enabled=true,version=version+1,updated_at=now() where tenant_id=p_tenant_id and kind=p_kind and validated_at is not null and last_success_at is not null and last_error is null and deleted_at is null;
 if not found then raise exception 'Fonte ainda não validada.' using errcode='22023'; end if;
end $$;
revoke all on function public.fin_prodio_claim(uuid,text,boolean),public.fin_prodio_finish(uuid,text,uuid,boolean,jsonb,jsonb,boolean,uuid,text,text,text,boolean,integer),public.fin_prodio_bootstrap_enable(uuid,text) from public,anon,authenticated;
grant execute on function public.fin_prodio_claim(uuid,text,boolean),public.fin_prodio_finish(uuid,text,uuid,boolean,jsonb,jsonb,boolean,uuid,text,text,text,boolean,integer),public.fin_prodio_bootstrap_enable(uuid,text) to service_role;
revoke all on function public.fin_prodio_enable(uuid,uuid,boolean,integer) from public,anon,service_role;
grant execute on function public.fin_prodio_enable(uuid,uuid,boolean,integer) to authenticated;

create or replace function public.fin_store_backup(p_tenant_id uuid,p_run_key text,p_revision text,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_keys text[];
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 select id into v_id from public.fin_backups where tenant_id=p_tenant_id and run_key=p_run_key;
 if v_id is not null then return v_id; end if;
 if p_revision is distinct from public.fin_backup_revision(p_tenant_id) then
  raise exception 'Dados alterados durante o backup. Snapshot não gravado.' using errcode='40001'; end if;
 select array_agg(k order by k) into v_keys from jsonb_object_keys(p_data) k;
 if v_keys is distinct from array['fin_allocations','fin_audit_log','fin_bank_accounts','fin_commitments','fin_companies','fin_import_profiles','fin_kamino_documents','fin_kamino_sources','fin_memberships','fin_plans','fin_prodio_documents','fin_prodio_sources','fin_rules','fin_tenants','fin_transactions'] then
  raise exception 'Snapshot incompleto.' using errcode='22023'; end if;
 if exists(select 1 from jsonb_each(p_data) x where jsonb_typeof(x.value)<>'array') or
   jsonb_array_length(p_data->'fin_tenants')<>1 or jsonb_array_length(p_data->'fin_memberships')=0 then
  raise exception 'Snapshot inválido ou vazio.' using errcode='22023'; end if;
 insert into public.fin_backups(tenant_id,run_key,revision,data,created_at) values(p_tenant_id,p_run_key,p_revision,p_data,clock_timestamp()) returning id into v_id;
 -- Retenção é a única remoção física: nunca afeta tabelas de operação.
 delete from public.fin_backups where tenant_id=p_tenant_id and id in
  (select id from public.fin_backups where tenant_id=p_tenant_id order by created_at desc,id desc offset 20);
 return v_id;
end $$;
revoke all on function public.fin_backup_revision(uuid),public.fin_store_backup(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.fin_backup_revision(uuid),public.fin_store_backup(uuid,text,text,jsonb) to service_role;
