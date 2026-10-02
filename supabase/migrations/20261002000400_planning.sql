-- Planejamento persistido. Não transforma premissas em movimentos realizados.
create table if not exists public.fin_plans (
 id uuid primary key, tenant_id uuid not null references public.fin_tenants(id),
 name text not null check(length(btrim(name)) between 1 and 120), config jsonb not null,
 version integer not null default 1, deleted_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tenant_id,id)
);
create table if not exists public.fin_commitments (
 id uuid primary key, tenant_id uuid not null references public.fin_tenants(id), company_id uuid,
 name text not null check(length(btrim(name)) between 1 and 120), due_date date not null,
 amount_cents bigint not null check(amount_cents between 1 and 9000000000000),
 direction text not null check(direction in ('entrada','saida')),
 category text not null check(category in ('fornecedores','fixos','impostos','outros')),
 version integer not null default 1, deleted_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(tenant_id,company_id) references public.fin_companies(tenant_id,id), unique(tenant_id,id),
 check(due_date between date '2000-01-01' and date '2099-12-31')
);
create index if not exists fin_commitments_due on public.fin_commitments(tenant_id,due_date) where deleted_at is null;
alter table public.fin_plans enable row level security;
alter table public.fin_commitments enable row level security;
revoke all on public.fin_plans,public.fin_commitments from public,anon,authenticated,service_role;
grant select on public.fin_plans,public.fin_commitments to authenticated,service_role;
create or replace function public.fin_can(p_tenant_id uuid,p_area text,p_edit boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.fin_memberships m where m.tenant_id=p_tenant_id and m.user_id=auth.uid()
 and m.active and (m.role='admin' or (p_area in ('empresas','contas','auditoria','planejamento') and
 case when p_edit then m.permissions->>p_area='edit' else m.permissions->>p_area in ('view','edit') end)))
$$;
drop policy if exists fin_plan_read on public.fin_plans;
create policy fin_plan_read on public.fin_plans for select to authenticated using(public.fin_can(tenant_id,'planejamento'));
drop policy if exists fin_commitment_read on public.fin_commitments;
create policy fin_commitment_read on public.fin_commitments for select to authenticated using(public.fin_can(tenant_id,'planejamento'));
drop policy if exists fin_company_read on public.fin_companies;
create policy fin_company_read on public.fin_companies for select to authenticated using(
 public.fin_can(tenant_id,'empresas') or public.fin_can(tenant_id,'contas') or public.fin_can(tenant_id,'planejamento'));
drop trigger if exists fin_audit_plans on public.fin_plans;
create trigger fin_audit_plans after insert or update or delete on public.fin_plans for each row execute function public.fin_audit();
drop trigger if exists fin_audit_commitments on public.fin_commitments;
create trigger fin_audit_commitments after insert or update or delete on public.fin_commitments for each row execute function public.fin_audit();

create or replace function public.fin_validate_plan(p jsonb) returns void
language plpgsql set search_path='' as $$
declare n integer; r jsonb; a jsonb; v jsonb; ids text[] := array[]::text[];
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>200000 then raise exception 'Premissas inválidas.' using errcode='22023'; end if;
 if not (p ?& array['start_month','months','opening_cents','channels','costs','supplier_bps','tax_bps','notes']) or
 exists(select 1 from jsonb_object_keys(p) k where k not in ('start_month','months','opening_cents','channels','costs','supplier_bps','tax_bps','notes')) then
  raise exception 'Campos de planejamento inválidos.' using errcode='22023'; end if;
 if coalesce(p->>'start_month','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$' or
    jsonb_typeof(p->'months')<>'number' or p->>'months' !~ '^[0-9]+$' then raise exception 'Período inválido.' using errcode='22023'; end if;
 n:=(p->>'months')::integer;
 if n not between 1 and 24 then raise exception 'Horizonte de 1 a 24 meses.' using errcode='22023'; end if;
 if p->'opening_cents'<>'null'::jsonb and (jsonb_typeof(p->'opening_cents')<>'number' or p->>'opening_cents' !~ '^-?[0-9]+$' or abs((p->>'opening_cents')::numeric)>9000000000000) then
  raise exception 'Saldo inicial inválido.' using errcode='22023'; end if;
 foreach a in array array[p->'supplier_bps',p->'tax_bps'] loop
  if jsonb_typeof(a)<>'number' or a::text !~ '^[0-9]+$' or a::text::numeric not between 0 and 10000 then raise exception 'Percentual inválido.' using errcode='22023'; end if;
 end loop;
 if jsonb_typeof(p->'channels')<>'array' or jsonb_typeof(p->'costs')<>'array' or
 jsonb_typeof(p->'notes')<>'string' or length(p->>'notes')>4000 then raise exception 'Premissas inválidas.' using errcode='22023'; end if;
 if jsonb_array_length(p->'channels')>50 or jsonb_array_length(p->'costs')>100 then raise exception 'Limite de premissas excedido.' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements((p->'channels')||(p->'costs')) loop
  if jsonb_typeof(r)<>'object' or jsonb_typeof(r->'id') is distinct from 'string' or length(r->>'id') not between 1 and 64 or (r->>'id')=any(ids) or
     jsonb_typeof(r->'name') is distinct from 'string' or length(btrim(r->>'name')) not between 1 and 120 then raise exception 'Nome ou identificação da premissa inválido.' using errcode='22023'; end if;
  ids:=array_append(ids,r->>'id');
 end loop;
 for r in select value from jsonb_array_elements(p->'channels') loop
  if not (r ?& array['id','name','net_bps','lag_days','gmv_cents']) or exists(select 1 from jsonb_object_keys(r) k where k not in ('id','name','net_bps','lag_days','gmv_cents')) then raise exception 'Canal inválido.' using errcode='22023'; end if;
  if jsonb_typeof(r->'net_bps')<>'number' or r->>'net_bps' !~ '^[0-9]+$' or (r->>'net_bps')::numeric not between 0 and 10000 or
     jsonb_typeof(r->'lag_days')<>'number' or r->>'lag_days' !~ '^[0-9]+$' or (r->>'lag_days')::numeric not between 0 and 180 then raise exception 'Repasse inválido.' using errcode='22023'; end if;
 end loop;
 for r in select value from jsonb_array_elements(p->'costs') loop
  if not (r ?& array['id','name','category','amounts']) or exists(select 1 from jsonb_object_keys(r) k where k not in ('id','name','category','amounts')) or
     coalesce(r->>'category','') not in ('fornecedores','fixos','impostos','outros') then raise exception 'Custo inválido.' using errcode='22023'; end if;
 end loop;
 for a in select value->'gmv_cents' from jsonb_array_elements(p->'channels') union all select value->'amounts' from jsonb_array_elements(p->'costs') loop
  if jsonb_typeof(a) is distinct from 'array' then raise exception 'Valores mensais inválidos.' using errcode='22023'; end if;
  if jsonb_array_length(a)<>n then raise exception 'Preencha todos os meses.' using errcode='22023'; end if;
  for v in select value from jsonb_array_elements(a) loop
   if jsonb_typeof(v)<>'number' or v::text !~ '^[0-9]+$' or v::text::numeric not between 0 and 9000000000000 then raise exception 'Valor em centavos inválido.' using errcode='22023'; end if;
  end loop;
 end loop;
end $$;
revoke all on function public.fin_validate_plan(jsonb) from public,anon,authenticated,service_role;

create or replace function public.fin_save_plan(p_tenant_id uuid,p_id uuid,p_name text,p_config jsonb,p_version integer default 0)
returns public.fin_plans language plpgsql security definer set search_path='' as $$
declare v public.fin_plans;
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 perform public.fin_require(p_tenant_id,'planejamento',true);
 if p_version is null or p_version<0 or p_name is null or length(btrim(p_name)) not between 1 and 120 then raise exception 'Nome ou versão inválida.' using errcode='22023'; end if;
 perform public.fin_validate_plan(p_config);
 select * into v from public.fin_plans where tenant_id=p_tenant_id and id=p_id for update;
 if found then
  if p_version=0 and v.deleted_at is null and v.config=p_config and v.name=btrim(p_name) then return v; end if;
  if v.version<>p_version or v.deleted_at is not null then raise exception 'Cenário alterado. Recarregue antes de salvar.' using errcode='40001'; end if;
  update public.fin_plans set name=btrim(p_name),config=p_config,version=version+1,updated_at=now() where tenant_id=p_tenant_id and id=p_id returning * into v;
 else
  if p_version<>0 then raise exception 'Cenário não encontrado.' using errcode='22023'; end if;
  insert into public.fin_plans(id,tenant_id,name,config) values(p_id,p_tenant_id,btrim(p_name),p_config) returning * into v;
 end if;
 return v;
end $$;
create or replace function public.fin_save_commitment(p_tenant_id uuid,p_id uuid,p_data jsonb,p_version integer default 0)
returns public.fin_commitments language plpgsql security definer set search_path='' as $$
declare v public.fin_commitments; cid uuid; d date; a bigint;
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 perform public.fin_require(p_tenant_id,'planejamento',true);
 if p_version is null or p_version<0 or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Lançamento inválido.' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('name','company_id','due_date','amount_cents','direction','category')) or
  not(p_data ?& array['name','company_id','due_date','amount_cents','direction','category']) then raise exception 'Campos inválidos.' using errcode='22023'; end if;
 cid:=(p_data->>'company_id')::uuid;
 if cid is not null and not exists(select 1 from public.fin_companies where id=cid and tenant_id=p_tenant_id and deleted_at is null) then raise exception 'Empresa inválida.' using errcode='22023'; end if;
 if coalesce(p_data->>'amount_cents','') !~ '^[0-9]+$' or jsonb_typeof(p_data->'amount_cents')<>'number' then raise exception 'Informe centavos inteiros.' using errcode='22023'; end if;
 a:=(p_data->>'amount_cents')::bigint; d:=(p_data->>'due_date')::date;
 select * into v from public.fin_commitments where tenant_id=p_tenant_id and id=p_id for update;
 if found then
  if p_version=0 and v.deleted_at is null and (to_jsonb(v)-array['id','tenant_id','version','deleted_at','created_at','updated_at'])=p_data then return v; end if;
  if v.version<>p_version or v.deleted_at is not null then raise exception 'Lançamento alterado. Recarregue antes de salvar.' using errcode='40001'; end if;
  update public.fin_commitments set name=btrim(p_data->>'name'),company_id=cid,due_date=d,amount_cents=a,
   direction=p_data->>'direction',category=p_data->>'category',version=version+1,updated_at=now() where id=p_id and tenant_id=p_tenant_id returning * into v;
 else
  if p_version<>0 then raise exception 'Lançamento não encontrado.' using errcode='22023'; end if;
  insert into public.fin_commitments(id,tenant_id,company_id,name,due_date,amount_cents,direction,category)
   values(p_id,p_tenant_id,cid,btrim(p_data->>'name'),d,a,p_data->>'direction',p_data->>'category') returning * into v;
 end if;
 return v;
end $$;
revoke all on function public.fin_save_plan(uuid,uuid,text,jsonb,integer), public.fin_save_commitment(uuid,uuid,jsonb,integer) from public,anon,service_role;
grant execute on function public.fin_save_plan(uuid,uuid,text,jsonb,integer), public.fin_save_commitment(uuid,uuid,jsonb,integer) to authenticated;

create or replace function public.fin_save_member(p_tenant_id uuid,p_email text,p_role text,p_active boolean,
 p_permissions jsonb,p_version integer default 0) returns void
language plpgsql security definer set search_path='' as $$
declare v_uid uuid; v_old public.fin_memberships;
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 perform public.fin_require(p_tenant_id,'admin',true);
 if p_version is null or p_version<0 then raise exception 'Versão inválida.' using errcode='22023'; end if;
 if p_role not in ('admin','membro') or p_role is null or p_active is null or
  p_permissions is null or jsonb_typeof(p_permissions)<>'object' then raise exception 'Perfil inválido.' using errcode='22023'; end if;
 if exists(select 1 from jsonb_each_text(p_permissions) e where e.key not in ('empresas','contas','auditoria','planejamento') or e.value not in ('none','view','edit') or e.value is null) then
  raise exception 'Permissão inválida.' using errcode='22023'; end if;
 select id into v_uid from auth.users where lower(email)=lower(btrim(p_email));
 if v_uid is null then raise exception 'Crie primeiro o usuário em Supabase Authentication.' using errcode='22023'; end if;
 select * into v_old from public.fin_memberships where tenant_id=p_tenant_id and user_id=v_uid for update;
 if found then
  if v_old.version<>p_version then raise exception 'Perfil alterado. Atualize antes de salvar.' using errcode='40001'; end if;
  if v_old.role='admin' and v_old.active and (p_role<>'admin' or not p_active) and
    not exists(select 1 from public.fin_memberships where tenant_id=p_tenant_id and user_id<>v_uid and role='admin' and active) then
   raise exception 'Mantenha ao menos um administrador ativo.' using errcode='22023'; end if;
  update public.fin_memberships set role=p_role,active=p_active,permissions=p_permissions,version=version+1
   where tenant_id=p_tenant_id and user_id=v_uid;
 else
  if p_version<>0 then raise exception 'Perfil não encontrado.' using errcode='22023'; end if;
  insert into public.fin_memberships(tenant_id,user_id,role,active,permissions) values(p_tenant_id,v_uid,p_role,p_active,p_permissions);
 end if;
end $$;

create or replace function public.fin_archive(p_tenant_id uuid,p_entity text,p_ids uuid[],p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_table text; v_count integer; v_total integer; v_blocked boolean;
begin
 perform public.fin_require(p_tenant_id,'admin',true);
 if p_entity not in ('companies','bank_accounts','plans','commitments') or p_entity is null then raise exception 'Cadastro inválido.' using errcode='22023'; end if;
 if p_ids is null or cardinality(p_ids)=0 or cardinality(p_ids)>500 then raise exception 'Selecione os registros explicitamente.' using errcode='22023'; end if;
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 v_table:='fin_'||p_entity;
 execute format('select count(*) from public.%I where tenant_id=$1 and deleted_at is null',v_table) into v_total using p_tenant_id;
 execute format('select count(*) from public.%I where tenant_id=$1 and id=any($2) and deleted_at is null',v_table) into v_count using p_tenant_id,p_ids;
 if v_count=0 or v_count<>(select count(distinct x) from unnest(p_ids) x) then raise exception 'Registro ausente ou já arquivado.' using errcode='22023'; end if;
 v_blocked:=v_count::numeric / greatest(v_total,1) > 0.3;
 if p_entity='companies' and exists(select 1 from public.fin_commitments where tenant_id=p_tenant_id and company_id=any(p_ids) and deleted_at is null) then
  raise exception 'A empresa possui lançamentos ativos.' using errcode='22023'; end if;
 if p_entity='companies' and exists(select 1 from public.fin_bank_accounts where tenant_id=p_tenant_id and company_id=any(p_ids) and deleted_at is null) then
  raise exception 'Arquive as contas vinculadas antes da empresa.' using errcode='22023'; end if;
 if coalesce(p_dry_run,true) then return jsonb_build_object('affected',v_count,'total',v_total,'blocked',v_blocked,'dry_run',true); end if;
 if v_blocked then raise exception 'Operação bloqueada: mais de 30%% dos registros seriam arquivados.' using errcode='22023'; end if;
 execute format('update public.%I set deleted_at=now(),updated_at=now(),version=version+1 where tenant_id=$1 and id=any($2) and deleted_at is null',v_table)
 using p_tenant_id,p_ids;
 return jsonb_build_object('affected',v_count,'total',v_total,'blocked',false,'dry_run',false);
end $$;

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
 if v_keys is distinct from array['fin_audit_log','fin_bank_accounts','fin_commitments','fin_companies','fin_memberships','fin_plans','fin_tenants'] then
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
