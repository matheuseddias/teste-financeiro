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
