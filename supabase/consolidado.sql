-- Gerado a partir de supabase/migrations; não editar.
begin;

-- 20261002000100_foundation.sql
-- F1. Namespace próprio: não altera tabelas do protótipo, Prodio ou Supabase Auth.
create table if not exists public.fin_tenants (
  id uuid primary key default gen_random_uuid(), name text not null check (length(btrim(name)) between 1 and 120),
  slug text not null unique, created_at timestamptz not null default now()
);
create table if not exists public.fin_memberships (
  tenant_id uuid not null references public.fin_tenants(id), user_id uuid not null references auth.users(id),
  role text not null check (role in ('admin','membro')), active boolean not null default true,
  permissions jsonb not null default '{"empresas":"view","contas":"view","auditoria":"none"}'::jsonb,
  version integer not null default 1, created_at timestamptz not null default now(),
  primary key (tenant_id,user_id), check (jsonb_typeof(permissions) = 'object')
);
create table if not exists public.fin_companies (
  id uuid primary key, tenant_id uuid not null references public.fin_tenants(id),
  name text not null check(length(btrim(name)) between 1 and 120),
  document text check(document is null or document ~ '^[0-9]{14}$'),
  version integer not null default 1, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(tenant_id,id)
);
create unique index if not exists fin_company_document on public.fin_companies(tenant_id,document)
  where deleted_at is null and document is not null;
create table if not exists public.fin_bank_accounts (
  id uuid primary key, tenant_id uuid not null references public.fin_tenants(id),
  company_id uuid not null, name text not null check(length(btrim(name)) between 1 and 120),
  bank_name text not null check(length(btrim(bank_name)) between 1 and 120),
  bank_code text not null default '' check(length(bank_code) <= 8),
  branch text not null default '' check(length(branch) <= 30),
  account_number text not null check(length(btrim(account_number)) between 1 and 60),
  kind text not null check(kind in ('corrente','pagamento','poupanca')),
  currency text not null default 'BRL' check(currency = 'BRL'),
  reference_date date, reference_balance_cents bigint,
  version integer not null default 1, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(tenant_id,id),
  foreign key(tenant_id,company_id) references public.fin_companies(tenant_id,id),
  check((reference_date is null) = (reference_balance_cents is null)),
  check(abs(reference_balance_cents) <= 9000000000000)
);
create unique index if not exists fin_account_identity on public.fin_bank_accounts
  (tenant_id,company_id,lower(bank_name),branch,account_number) where deleted_at is null;
create table if not exists public.fin_audit_log (
  id bigint generated always as identity primary key, tenant_id uuid not null references public.fin_tenants(id),
  actor_id uuid, entity text not null, entity_id text not null, action text not null,
  before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);
create index if not exists fin_audit_tenant on public.fin_audit_log(tenant_id,id);
create table if not exists public.fin_backups (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.fin_tenants(id),
  run_key text not null, data jsonb not null, revision text not null,
  created_at timestamptz not null default now(), unique(tenant_id,run_key)
);
alter table public.fin_tenants enable row level security;
alter table public.fin_memberships enable row level security;
alter table public.fin_companies enable row level security;
alter table public.fin_bank_accounts enable row level security;
alter table public.fin_audit_log enable row level security;
alter table public.fin_backups enable row level security;
revoke all on public.fin_tenants, public.fin_memberships, public.fin_companies,
  public.fin_bank_accounts, public.fin_audit_log, public.fin_backups from public,anon,authenticated,service_role;
revoke all on sequence public.fin_audit_log_id_seq from public,anon,authenticated,service_role;
grant select on public.fin_tenants, public.fin_memberships, public.fin_companies,
  public.fin_bank_accounts, public.fin_audit_log to authenticated,service_role;
-- Backup só é gravado pela RPC service-only. Não há escrita direta no navegador.
grant select on public.fin_backups to service_role;

create or replace function public.fin_can(p_tenant_id uuid, p_area text, p_edit boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.fin_memberships m where m.tenant_id=p_tenant_id
   and m.user_id=auth.uid() and m.active and (m.role='admin' or
     (p_area in ('empresas','contas','auditoria') and
       case when p_edit then m.permissions->>p_area='edit'
            else m.permissions->>p_area in ('view','edit') end)))
$$;
create or replace function public.fin_require(p_tenant_id uuid,p_area text,p_edit boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.fin_can(p_tenant_id,p_area,p_edit) then
  raise exception 'Seu perfil não permite esta operação.' using errcode='42501';
 end if;
end $$;
revoke all on function public.fin_can(uuid,text,boolean),public.fin_require(uuid,text,boolean) from public,anon;
grant execute on function public.fin_can(uuid,text,boolean) to authenticated;
-- fin_require é chamada pelas RPCs proprietárias, não diretamente pelo usuário.
revoke all on function public.fin_require(uuid,text,boolean) from authenticated;

drop policy if exists fin_tenant_read on public.fin_tenants;
create policy fin_tenant_read on public.fin_tenants for select to authenticated
 using(exists(select 1 from public.fin_memberships m where m.tenant_id=id and m.user_id=auth.uid() and m.active));
drop policy if exists fin_members_read on public.fin_memberships;
create policy fin_members_read on public.fin_memberships for select to authenticated
 using((user_id=auth.uid() and active) or public.fin_can(tenant_id,'admin'));
drop policy if exists fin_company_read on public.fin_companies;
create policy fin_company_read on public.fin_companies for select to authenticated
 using(public.fin_can(tenant_id,'empresas') or public.fin_can(tenant_id,'contas'));
drop policy if exists fin_account_read on public.fin_bank_accounts;
create policy fin_account_read on public.fin_bank_accounts for select to authenticated
 using(public.fin_can(tenant_id,'contas'));
drop policy if exists fin_audit_read on public.fin_audit_log;
create policy fin_audit_read on public.fin_audit_log for select to authenticated
 using(public.fin_can(tenant_id,'auditoria'));

create or replace function public.fin_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_new jsonb; v_old jsonb; v_tenant uuid;
begin
 v_new:=case when tg_op='DELETE' then null else to_jsonb(new) end;
 v_old:=case when tg_op='INSERT' then null else to_jsonb(old) end;
 v_tenant:=coalesce((v_new->>'tenant_id')::uuid,(v_old->>'tenant_id')::uuid,
                   (v_new->>'id')::uuid,(v_old->>'id')::uuid);
 insert into public.fin_audit_log(tenant_id,actor_id,entity,entity_id,action,before_data,after_data)
 values(v_tenant,auth.uid(),tg_table_name,coalesce(v_new->>'id',v_old->>'id',
   v_new->>'user_id',v_old->>'user_id'),tg_op,v_old,v_new);
 return case when tg_op='DELETE' then old else new end;
end $$;
create or replace function public.fin_no_rewrite_audit() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'O histórico é imutável.' using errcode='42501'; end $$;
revoke all on function public.fin_audit(),public.fin_no_rewrite_audit() from public,anon,authenticated;
drop trigger if exists fin_audit_companies on public.fin_companies;
create trigger fin_audit_companies after insert or update or delete on public.fin_companies
 for each row execute function public.fin_audit();
drop trigger if exists fin_audit_accounts on public.fin_bank_accounts;
create trigger fin_audit_accounts after insert or update or delete on public.fin_bank_accounts
 for each row execute function public.fin_audit();
drop trigger if exists fin_audit_members on public.fin_memberships;
create trigger fin_audit_members after insert or update or delete on public.fin_memberships
 for each row execute function public.fin_audit();
drop trigger if exists fin_audit_tenants on public.fin_tenants;
create trigger fin_audit_tenants after insert or update on public.fin_tenants
 for each row execute function public.fin_audit();
drop trigger if exists fin_audit_immutable on public.fin_audit_log;
create trigger fin_audit_immutable before update or delete on public.fin_audit_log
 for each row execute function public.fin_no_rewrite_audit();

-- Bootstrap aditivo: reutiliza somente administradores ativos do próprio protótipo.
insert into public.fin_tenants(id,name,slug)
select 'edd1a500-0000-4000-8000-000000000001','Grupo Eddias','grupo-eddias'
where not exists(select 1 from public.fin_tenants where slug='grupo-eddias');
do $$
begin
 if to_regclass('public.eddias_financeiro_members') is not null then
  insert into public.fin_memberships(tenant_id,user_id,role)
  select t.id,m.user_id,'admin' from public.eddias_financeiro_members m
   cross join public.fin_tenants t where t.slug='grupo-eddias' and m.role='admin' and m.active
   and not exists(select 1 from public.fin_memberships f where f.tenant_id=t.id and f.user_id=m.user_id);
 end if;
end $$;

-- 20261002000200_accounts.sql
create or replace function public.fin_save_company(p_tenant_id uuid,p_id uuid,p_name text,
 p_document text default null,p_version integer default 0)
returns public.fin_companies language plpgsql security definer set search_path='' as $$
declare v public.fin_companies; v_doc text;
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 perform public.fin_require(p_tenant_id,'empresas',true);
 if p_version is null or p_version<0 then raise exception 'Versão inválida.' using errcode='22023'; end if;
 v_doc:=nullif(regexp_replace(coalesce(p_document,''),'[^0-9]','','g'),'');
 if length(btrim(p_name)) not between 1 and 120 or p_name is null then
  raise exception 'Informe o nome da empresa.' using errcode='22023'; end if;
 select * into v from public.fin_companies where tenant_id=p_tenant_id and id=p_id for update;
 if found then
  if p_version=0 and v.name=btrim(p_name) and v.document is not distinct from v_doc and v.deleted_at is null then return v; end if;
  if v.version<>p_version or v.deleted_at is not null then
   raise exception 'Cadastro alterado por outra pessoa. Atualize antes de salvar.' using errcode='40001'; end if;
  update public.fin_companies set name=btrim(p_name),document=v_doc,version=version+1,updated_at=now()
   where tenant_id=p_tenant_id and id=p_id returning * into v;
 else
  if p_version<>0 then raise exception 'Empresa não encontrada.' using errcode='22023'; end if;
  insert into public.fin_companies(id,tenant_id,name,document)
   values(p_id,p_tenant_id,btrim(p_name),v_doc) returning * into v;
 end if;
 return v;
end $$;

create or replace function public.fin_save_account(p_tenant_id uuid,p_id uuid,p_data jsonb,p_version integer default 0)
returns public.fin_bank_accounts language plpgsql security definer set search_path='' as $$
declare v public.fin_bank_accounts; v_company uuid; v_date date; v_cents bigint;
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 perform public.fin_require(p_tenant_id,'contas',true);
 if p_version is null or p_version<0 then raise exception 'Versão inválida.' using errcode='22023'; end if;
 if jsonb_typeof(p_data)<>'object' or p_data is null then raise exception 'Cadastro inválido.' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in
   ('company_id','name','bank_name','bank_code','branch','account_number','kind','currency','reference_date','reference_balance_cents')) then
  raise exception 'Campo de cadastro desconhecido.' using errcode='22023'; end if;
 v_company:=(p_data->>'company_id')::uuid;
 perform 1 from public.fin_companies where tenant_id=p_tenant_id and id=v_company and deleted_at is null for share;
 if not found then raise exception 'Selecione uma empresa ativa deste grupo.' using errcode='22023'; end if;
 if coalesce(p_data->>'reference_balance_cents','0') !~ '^-?[0-9]+$' then
  raise exception 'O saldo deve ser informado em centavos inteiros.' using errcode='22023'; end if;
 v_cents:=(p_data->>'reference_balance_cents')::bigint;
 v_date:=nullif(p_data->>'reference_date','')::date;
 if (v_cents is null)<>(v_date is null) then
  raise exception 'Informe juntos a data e o saldo de referência.' using errcode='22023'; end if;
 select * into v from public.fin_bank_accounts where tenant_id=p_tenant_id and id=p_id for update;
 if found then
  if p_version=0 and v.deleted_at is null and
     (to_jsonb(v)-array['id','tenant_id','version','deleted_at','created_at','updated_at'])=p_data then return v; end if;
  if v.version<>p_version or v.deleted_at is not null then
   raise exception 'Cadastro alterado por outra pessoa. Atualize antes de salvar.' using errcode='40001'; end if;
  update public.fin_bank_accounts set company_id=v_company,name=btrim(p_data->>'name'),
   bank_name=btrim(p_data->>'bank_name'),bank_code=btrim(coalesce(p_data->>'bank_code','')),
   branch=btrim(coalesce(p_data->>'branch','')),account_number=btrim(p_data->>'account_number'),
   kind=p_data->>'kind',currency=p_data->>'currency',
   reference_date=v_date,reference_balance_cents=v_cents,version=version+1,updated_at=now()
   where tenant_id=p_tenant_id and id=p_id returning * into v;
 else
  if p_version<>0 then raise exception 'Conta não encontrada.' using errcode='22023'; end if;
  insert into public.fin_bank_accounts(id,tenant_id,company_id,name,bank_name,bank_code,branch,
   account_number,kind,currency,reference_date,reference_balance_cents)
  values(p_id,p_tenant_id,v_company,btrim(p_data->>'name'),btrim(p_data->>'bank_name'),
   btrim(coalesce(p_data->>'bank_code','')),btrim(coalesce(p_data->>'branch','')),
   btrim(p_data->>'account_number'),p_data->>'kind',p_data->>'currency',v_date,v_cents) returning * into v;
 end if;
 return v;
end $$;

create or replace function public.fin_archive(p_tenant_id uuid,p_entity text,p_ids uuid[],p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_table text; v_count integer; v_total integer; v_blocked boolean;
begin
 perform public.fin_require(p_tenant_id,'admin',true);
 if p_entity not in ('companies','bank_accounts') or p_entity is null then raise exception 'Cadastro inválido.' using errcode='22023'; end if;
 if p_ids is null or cardinality(p_ids)=0 or cardinality(p_ids)>500 then raise exception 'Selecione os registros explicitamente.' using errcode='22023'; end if;
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 v_table:='fin_'||p_entity;
 execute format('select count(*) from public.%I where tenant_id=$1 and deleted_at is null',v_table) into v_total using p_tenant_id;
 execute format('select count(*) from public.%I where tenant_id=$1 and id=any($2) and deleted_at is null',v_table) into v_count using p_tenant_id,p_ids;
 if v_count=0 or v_count<>(select count(distinct x) from unnest(p_ids) x) then raise exception 'Registro ausente ou já arquivado.' using errcode='22023'; end if;
 v_blocked:=v_count::numeric / greatest(v_total,1) > 0.3;
 if p_entity='companies' and exists(select 1 from public.fin_bank_accounts where tenant_id=p_tenant_id and company_id=any(p_ids) and deleted_at is null) then
  raise exception 'Arquive as contas vinculadas antes da empresa.' using errcode='22023'; end if;
 if coalesce(p_dry_run,true) then return jsonb_build_object('affected',v_count,'total',v_total,'blocked',v_blocked,'dry_run',true); end if;
 if v_blocked then raise exception 'Operação bloqueada: mais de 30%% dos registros seriam arquivados.' using errcode='22023'; end if;
 execute format('update public.%I set deleted_at=now(),updated_at=now(),version=version+1 where tenant_id=$1 and id=any($2) and deleted_at is null',v_table)
 using p_tenant_id,p_ids;
 return jsonb_build_object('affected',v_count,'total',v_total,'blocked',false,'dry_run',false);
end $$;
revoke all on function public.fin_save_company(uuid,uuid,text,text,integer),
 public.fin_save_account(uuid,uuid,jsonb,integer),public.fin_archive(uuid,text,uuid[],boolean) from public,anon;
grant execute on function public.fin_save_company(uuid,uuid,text,text,integer),
 public.fin_save_account(uuid,uuid,jsonb,integer),public.fin_archive(uuid,text,uuid[],boolean) to authenticated;

-- 20261002000300_members_backups.sql
create or replace function public.fin_my_workspaces() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('workspace_name',t.name) order by t.name),'[]'::jsonb)
 from public.fin_memberships m join public.fin_tenants t on t.id=m.tenant_id
 where m.user_id=auth.uid() and m.active
$$;
create or replace function public.fin_members(p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.fin_require(p_tenant_id,'admin');
 return coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('email',u.email) order by u.email)
 from public.fin_memberships m join auth.users u on u.id=m.user_id where m.tenant_id=p_tenant_id),'[]'::jsonb);
end $$;
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
 if exists(select 1 from jsonb_each_text(p_permissions) e where e.key not in ('empresas','contas','auditoria') or e.value not in ('none','view','edit') or e.value is null) then
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
revoke all on function public.fin_my_workspaces(),public.fin_members(uuid),
 public.fin_save_member(uuid,text,text,boolean,jsonb,integer) from public,anon;
grant execute on function public.fin_my_workspaces(),public.fin_members(uuid),
 public.fin_save_member(uuid,text,text,boolean,jsonb,integer) to authenticated;

create or replace function public.fin_backup_revision(p_tenant_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select count(*)::text||':'||coalesce(max(id),0)::text from public.fin_audit_log where tenant_id=p_tenant_id
$$;
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
 if v_keys is distinct from array['fin_audit_log','fin_bank_accounts','fin_companies','fin_memberships','fin_tenants'] then
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

commit;
