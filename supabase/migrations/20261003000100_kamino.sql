-- Integração de leitura: documentos da fonte não são movimentos de banco.
create table if not exists public.fin_kamino_sources (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.fin_tenants(id),
 slot text not null check(slot in ('principal','home')), kind text not null check(kind in ('pagamentos','notas')),
 enabled boolean not null default false, validated_at timestamptz, cursor jsonb not null default '{}'::jsonb,
 last_attempt_at timestamptz, last_success_at timestamptz, last_full_sync_at timestamptz, last_error text,
 next_attempt_at timestamptz, lease_id uuid, lease_until timestamptz, version integer not null default 1,
 deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tenant_id,slot,kind)
);
create table if not exists public.fin_kamino_documents (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.fin_tenants(id),
 slot text not null check(slot in ('principal','home')), kind text not null check(kind in ('pagamentos','notas')),
 source_id text not null check(source_id ~ '^[1-9][0-9]{0,79}$'), description text not null check(length(description) between 1 and 120),
 due_date date, issue_date date, amount_cents bigint not null check(amount_cents between 0 and 9000000000000), paid_cents bigint check(paid_cents between 0 and 9000000000000),
 status text not null, unit_id text, unit_name text, supplier text, supplier_document text, invoice_number text, invoice_key text check(invoice_key ~ '^[0-9]{44}$'), invoice_source_id text, category_key text,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'), reviewed_fingerprint text,
 commitment_id uuid, company_id uuid, category text check(category in ('fornecedores','fixos','impostos','outros')),
 version integer not null default 1, deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tenant_id,slot,kind,source_id), unique(tenant_id,commitment_id),
 foreign key(tenant_id,slot,kind) references public.fin_kamino_sources(tenant_id,slot,kind),
 foreign key(tenant_id,commitment_id) references public.fin_commitments(tenant_id,id),
 foreign key(tenant_id,company_id) references public.fin_companies(tenant_id,id)
);
alter table public.fin_kamino_sources enable row level security;
alter table public.fin_kamino_documents enable row level security;
revoke all on public.fin_kamino_sources,public.fin_kamino_documents from public,anon,authenticated,service_role;
grant select on public.fin_kamino_sources,public.fin_kamino_documents to authenticated,service_role;
drop policy if exists fin_kamino_source_read on public.fin_kamino_sources;
create policy fin_kamino_source_read on public.fin_kamino_sources for select to authenticated using(public.fin_can(tenant_id,'admin',true));
drop policy if exists fin_kamino_document_read on public.fin_kamino_documents;
create policy fin_kamino_document_read on public.fin_kamino_documents for select to authenticated using(public.fin_can(tenant_id,'admin',true));
drop trigger if exists fin_audit_kamino_sources on public.fin_kamino_sources;
create trigger fin_audit_kamino_sources after insert or update or delete on public.fin_kamino_sources for each row execute function public.fin_audit();
drop trigger if exists fin_audit_kamino_documents on public.fin_kamino_documents;
create trigger fin_audit_kamino_documents after insert or update or delete on public.fin_kamino_documents for each row execute function public.fin_audit();

-- Lease e intervalo globais por grupo: principal/Home e notas/pagamentos compartilham o orçamento.
create or replace function public.fin_kamino_claim(p_tenant_id uuid,p_slot text,p_kind text,p_probe boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.fin_kamino_sources;
begin
 if p_tenant_id<>'edd1a500-0000-4000-8000-000000000001' then raise exception 'Grupo não liberado.' using errcode='42501'; end if;
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 if exists(select 1 from public.fin_kamino_sources where tenant_id=p_tenant_id and (lease_until>now() or next_attempt_at>now())) then return null; end if;
 insert into public.fin_kamino_sources(tenant_id,slot,kind) values(p_tenant_id,p_slot,p_kind) on conflict(tenant_id,slot,kind) do nothing;
 select * into s from public.fin_kamino_sources where tenant_id=p_tenant_id and slot=p_slot and kind=p_kind for update;
 if s.deleted_at is not null or (not coalesce(p_probe,false) and s.validated_at is null) then return null; end if;
 update public.fin_kamino_sources set lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds',next_attempt_at=now()+interval '60 seconds',last_attempt_at=now(),version=version+1,updated_at=now()
 where id=s.id returning * into s;
 return to_jsonb(s);
end $$;

create or replace function public.fin_kamino_finish(p_tenant_id uuid,p_slot text,p_kind text,p_lease uuid,p_probe boolean,p_documents jsonb,p_cursor jsonb,p_done boolean,p_error text,p_retry_seconds integer default 60)
returns void language plpgsql security definer set search_path='' as $$
declare s public.fin_kamino_sources; d jsonb;
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 select * into s from public.fin_kamino_sources where tenant_id=p_tenant_id and slot=p_slot and kind=p_kind for update;
 if s.id is null or s.lease_id is distinct from p_lease or s.lease_until<now() then raise exception 'Consulta vencida ou substituída.' using errcode='40001'; end if;
 if p_error is not null then
  update public.fin_kamino_sources set last_error=left(p_error,300),enabled=false,validated_at=null,lease_id=null,lease_until=null,
   next_attempt_at=now()+make_interval(secs=>greatest(60,least(coalesce(p_retry_seconds,60),31536000))),version=version+1,updated_at=now() where id=s.id;
  return;
 end if;
 if p_documents is null or jsonb_typeof(p_documents)<>'array' or jsonb_array_length(p_documents)>100 or octet_length(p_documents::text)>1000000 or p_cursor is null or jsonb_typeof(p_cursor)<>'object' then raise exception 'Lote inválido.' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_documents) x group by x->>'source_id' having count(*)>1) then raise exception 'Identificador repetido no lote.' using errcode='22023'; end if;
 if not coalesce(p_probe,false) then
  for d in select value from jsonb_array_elements(p_documents) loop
   if jsonb_typeof(d)<>'object' or coalesce(d->>'amount_cents','') !~ '^[0-9]+$' or jsonb_typeof(d->'amount_cents')<>'number' or
    (p_kind='pagamentos' and (d->>'status' not in ('1','2','3') or d->>'due_date' is null)) or (p_kind='notas' and (d->>'invoice_key' is null or d->>'issue_date' is null)) then raise exception 'Documento inválido.' using errcode='22023'; end if;
   insert into public.fin_kamino_documents(tenant_id,slot,kind,source_id,description,due_date,issue_date,amount_cents,paid_cents,status,unit_id,unit_name,supplier,supplier_document,invoice_number,invoice_key,invoice_source_id,category_key,fingerprint)
   values(p_tenant_id,p_slot,p_kind,d->>'source_id',d->>'description',(d->>'due_date')::date,(d->>'issue_date')::date,(d->>'amount_cents')::bigint,(d->>'paid_cents')::bigint,d->>'status',d->>'unit_id',d->>'unit_name',d->>'supplier',d->>'supplier_document',d->>'invoice_number',d->>'invoice_key',d->>'invoice_source_id',d->>'category_key',d->>'fingerprint')
   on conflict(tenant_id,slot,kind,source_id) do update set description=excluded.description,due_date=excluded.due_date,issue_date=excluded.issue_date,amount_cents=excluded.amount_cents,paid_cents=excluded.paid_cents,
    status=excluded.status,unit_id=excluded.unit_id,unit_name=excluded.unit_name,supplier=excluded.supplier,supplier_document=excluded.supplier_document,invoice_number=excluded.invoice_number,invoice_key=excluded.invoice_key,invoice_source_id=excluded.invoice_source_id,category_key=excluded.category_key,fingerprint=excluded.fingerprint,version=public.fin_kamino_documents.version+1,updated_at=now()
   where public.fin_kamino_documents.fingerprint is distinct from excluded.fingerprint;
  end loop;
 end if;
 update public.fin_kamino_sources set validated_at=coalesce(validated_at,now()),last_error=null,
  last_success_at=case when p_probe then last_success_at else now() end,last_full_sync_at=case when p_done and not p_probe then now() else last_full_sync_at end,
  cursor=case when p_probe then cursor else p_cursor end,lease_id=null,lease_until=null,version=version+1,updated_at=now() where id=s.id;
end $$;

create or replace function public.fin_kamino_enable(p_tenant_id uuid,p_id uuid,p_enabled boolean,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 perform public.fin_require(p_tenant_id,'admin',true);
 update public.fin_kamino_sources set enabled=p_enabled,version=version+1,updated_at=now() where tenant_id=p_tenant_id and id=p_id and version=p_version and deleted_at is null and (not p_enabled or validated_at is not null);
 if not found then raise exception 'Teste a conexão ou atualize os dados antes de continuar.' using errcode='40001'; end if;
end $$;

-- Revisão explícita: NF-e nunca cria saída por si só; título já pago não vira realizado bancário.
create or replace function public.fin_kamino_review(p_tenant_id uuid,p_items jsonb,p_company_id uuid,p_category text,p_existing_id uuid default null,p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; d public.fin_kamino_documents; c public.fin_commitments; cid uuid; duplicates integer:=0; total integer:=0; linked integer:=0; used bigint;
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 perform public.fin_require(p_tenant_id,'admin',true);
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 or p_category is null or p_category not in ('fornecedores','fixos','impostos','outros') then raise exception 'Seleção inválida.' using errcode='22023'; end if;
 if not exists(select 1 from public.fin_companies where tenant_id=p_tenant_id and id=p_company_id and deleted_at is null) then raise exception 'Selecione a empresa titular.' using errcode='22023'; end if;
 if p_existing_id is not null and jsonb_array_length(p_items)<>1 then raise exception 'Vincule um lançamento existente por vez.' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x group by x->>'id' having count(*)>1) then raise exception 'Seleção repetida.' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  select * into d from public.fin_kamino_documents where tenant_id=p_tenant_id and id=(item->>'id')::uuid and deleted_at is null for update;
  if d.id is null or d.version is distinct from (item->>'version')::integer then raise exception 'Documento alterado. Recarregue.' using errcode='40001'; end if;
  if d.kind<>'pagamentos' or d.status not in ('1','3') or d.amount_cents<=0 or coalesce(d.paid_cents,0)>0 then raise exception 'Somente títulos abertos, sem pagamento informado, podem gerar ou atualizar previsões.' using errcode='22023'; end if;
  cid:=coalesce(d.commitment_id,p_existing_id);
  if d.commitment_id is not null and p_existing_id is not null and d.commitment_id<>p_existing_id then raise exception 'Documento já vinculado a outro lançamento.' using errcode='22023'; end if;
  if cid is null and exists(select 1 from public.fin_commitments x where x.tenant_id=p_tenant_id and x.deleted_at is null and x.direction='saida' and (x.company_id=p_company_id or x.company_id is null) and x.due_date=d.due_date and x.amount_cents=d.amount_cents
    and not exists(select 1 from public.fin_kamino_documents k where k.tenant_id=p_tenant_id and k.commitment_id=x.id)) then duplicates:=duplicates+1; end if;
  if cid is not null then
   select * into c from public.fin_commitments where tenant_id=p_tenant_id and id=cid and deleted_at is null for update;
   if c.id is null or c.direction<>'saida' then raise exception 'Lançamento inválido.' using errcode='22023'; end if;
   if exists(select 1 from public.fin_kamino_documents where tenant_id=p_tenant_id and commitment_id=cid and id<>d.id) then raise exception 'O lançamento já representa outro título da fonte.' using errcode='22023'; end if;
   select coalesce(sum(amount_cents),0) into used from public.fin_allocations where tenant_id=p_tenant_id and commitment_id=cid and deleted_at is null;
   if used>0 and (c.amount_cents<>d.amount_cents or c.company_id is distinct from p_company_id or c.due_date<>d.due_date) then raise exception 'Lançamento conciliado com diferenças: revise os vínculos antes de atualizar.' using errcode='22023'; end if;
   linked:=linked+1;
  end if;
  total:=total+1;
  if not coalesce(p_dry_run,true) then
   if duplicates>0 then raise exception 'Possível lançamento já cadastrado. Revise e vincule o existente para evitar duplicidade.' using errcode='22023'; end if;
   if cid is null then
    cid:=gen_random_uuid();insert into public.fin_commitments(id,tenant_id,company_id,name,due_date,amount_cents,direction,category) values(cid,p_tenant_id,p_company_id,d.description,d.due_date,d.amount_cents,'saida',p_category);
   else
    update public.fin_commitments set company_id=p_company_id,name=d.description,due_date=d.due_date,amount_cents=d.amount_cents,category=p_category,version=version+1,updated_at=now() where tenant_id=p_tenant_id and id=cid;
   end if;
   update public.fin_kamino_documents set commitment_id=cid,reviewed_fingerprint=fingerprint,company_id=p_company_id,category=p_category,version=version+1,updated_at=now() where id=d.id;
  end if;
 end loop;
 return jsonb_build_object('total',total,'linked',linked,'possible_duplicates',duplicates,'dry_run',coalesce(p_dry_run,true));
end $$;
revoke all on function public.fin_kamino_claim(uuid,text,text,boolean),public.fin_kamino_finish(uuid,text,text,uuid,boolean,jsonb,jsonb,boolean,text,integer) from public,anon,authenticated;
grant execute on function public.fin_kamino_claim(uuid,text,text,boolean),public.fin_kamino_finish(uuid,text,text,uuid,boolean,jsonb,jsonb,boolean,text,integer) to service_role;
revoke all on function public.fin_kamino_enable(uuid,uuid,boolean,integer),public.fin_kamino_review(uuid,jsonb,uuid,text,uuid,boolean) from public,anon,service_role;
grant execute on function public.fin_kamino_enable(uuid,uuid,boolean,integer),public.fin_kamino_review(uuid,jsonb,uuid,text,uuid,boolean) to authenticated;

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
 if v_keys is distinct from array['fin_allocations','fin_audit_log','fin_bank_accounts','fin_commitments','fin_companies','fin_import_profiles','fin_kamino_documents','fin_kamino_sources','fin_memberships','fin_plans','fin_rules','fin_tenants','fin_transactions'] then
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

-- Inicialização do deploy só habilita fonte já testada e com primeiro lote persistido.
create or replace function public.fin_kamino_bootstrap_enable(p_tenant_id uuid,p_slot text,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_tenant_id<>'edd1a500-0000-4000-8000-000000000001' then raise exception 'Grupo não liberado.' using errcode='42501'; end if;
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 update public.fin_kamino_sources set enabled=true,version=version+1,updated_at=now()
 where tenant_id=p_tenant_id and slot=p_slot and kind=p_kind and validated_at is not null and last_success_at is not null and last_error is null and deleted_at is null;
 if not found then raise exception 'Fonte ainda não validada.' using errcode='22023'; end if;
end $$;
revoke all on function public.fin_kamino_bootstrap_enable(uuid,text,text) from public,anon,authenticated;
grant execute on function public.fin_kamino_bootstrap_enable(uuid,text,text) to service_role;
