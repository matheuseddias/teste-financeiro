-- Extratos imutáveis e conciliação por alocação, sem reescrever valores bancários.
create table if not exists public.fin_transactions (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.fin_tenants(id), account_id uuid not null,
 posted_date date not null check(posted_date between date '2000-01-01' and date '2099-12-31'),
 amount_cents bigint not null check(amount_cents<>0 and abs(amount_cents)<=9000000000000),
 description text not null check(length(btrim(description)) between 1 and 500), external_id text check(length(external_id)<=150),
 source_key text not null check(length(source_key) between 1 and 200), fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 classification text not null default 'pendente' check(classification in ('pendente','operacional','repasse','transferencia','aporte','emprestimo')),
 category text check(category in ('fornecedores','fixos','impostos','outros')), channel text check(length(btrim(channel)) between 1 and 120),
 version integer not null default 1, deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tenant_id,id), unique(tenant_id,account_id,source_key),
 foreign key(tenant_id,account_id) references public.fin_bank_accounts(tenant_id,id),
 check(classification<>'repasse' or (amount_cents>0 and channel is not null))
);
create index if not exists fin_transactions_date on public.fin_transactions(tenant_id,posted_date);
create index if not exists fin_transactions_fingerprint on public.fin_transactions(tenant_id,account_id,fingerprint);
create table if not exists public.fin_allocations (
 id uuid primary key, tenant_id uuid not null references public.fin_tenants(id), transaction_id uuid not null, commitment_id uuid not null,
 amount_cents bigint not null check(amount_cents between 1 and 9000000000000),
 version integer not null default 1, deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(tenant_id,transaction_id) references public.fin_transactions(tenant_id,id),
 foreign key(tenant_id,commitment_id) references public.fin_commitments(tenant_id,id)
);
create unique index if not exists fin_allocation_pair on public.fin_allocations(tenant_id,transaction_id,commitment_id) where deleted_at is null;
create table if not exists public.fin_import_profiles (
 id uuid primary key, tenant_id uuid not null references public.fin_tenants(id), account_id uuid not null,
 name text not null check(length(btrim(name)) between 1 and 120), config jsonb not null check(jsonb_typeof(config)='object' and octet_length(config::text)<4000),
 version integer not null default 1, deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(tenant_id,account_id) references public.fin_bank_accounts(tenant_id,id)
);
alter table public.fin_transactions enable row level security;
alter table public.fin_allocations enable row level security;
alter table public.fin_import_profiles enable row level security;
revoke all on public.fin_transactions,public.fin_allocations,public.fin_import_profiles from public,anon,authenticated,service_role;
grant select on public.fin_transactions,public.fin_allocations,public.fin_import_profiles to authenticated,service_role;
create or replace function public.fin_can(p_tenant_id uuid,p_area text,p_edit boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.fin_memberships m where m.tenant_id=p_tenant_id and m.user_id=auth.uid() and m.active and
 (m.role='admin' or (p_area in ('empresas','contas','auditoria','planejamento','extratos') and
 case when p_edit then m.permissions->>p_area='edit' else m.permissions->>p_area in ('view','edit') end)))
$$;
drop policy if exists fin_transaction_read on public.fin_transactions;
create policy fin_transaction_read on public.fin_transactions for select to authenticated using(public.fin_can(tenant_id,'extratos') or public.fin_can(tenant_id,'planejamento'));
drop policy if exists fin_allocation_read on public.fin_allocations;
create policy fin_allocation_read on public.fin_allocations for select to authenticated using(public.fin_can(tenant_id,'extratos') or public.fin_can(tenant_id,'planejamento'));
drop policy if exists fin_profile_read on public.fin_import_profiles;
create policy fin_profile_read on public.fin_import_profiles for select to authenticated using(public.fin_can(tenant_id,'extratos'));
drop policy if exists fin_commitment_read on public.fin_commitments;
create policy fin_commitment_read on public.fin_commitments for select to authenticated using(public.fin_can(tenant_id,'planejamento') or public.fin_can(tenant_id,'extratos'));
drop policy if exists fin_company_read on public.fin_companies;
create policy fin_company_read on public.fin_companies for select to authenticated using(public.fin_can(tenant_id,'empresas') or public.fin_can(tenant_id,'contas') or public.fin_can(tenant_id,'planejamento') or public.fin_can(tenant_id,'extratos'));
drop policy if exists fin_account_read on public.fin_bank_accounts;
create policy fin_account_read on public.fin_bank_accounts for select to authenticated using(public.fin_can(tenant_id,'contas') or public.fin_can(tenant_id,'extratos'));
drop trigger if exists fin_audit_transactions on public.fin_transactions;
create trigger fin_audit_transactions after insert or update or delete on public.fin_transactions for each row execute function public.fin_audit();
drop trigger if exists fin_audit_allocations on public.fin_allocations;
create trigger fin_audit_allocations after insert or update or delete on public.fin_allocations for each row execute function public.fin_audit();
drop trigger if exists fin_audit_profiles on public.fin_import_profiles;
create trigger fin_audit_profiles after insert or update or delete on public.fin_import_profiles for each row execute function public.fin_audit();

create or replace function public.fin_import_transactions(p_tenant_id uuid,p_account_id uuid,p_rows jsonb,p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; v public.fin_transactions; total integer:=0; duplicates integer:=0; possible integer:=0; n integer:=0;
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 perform public.fin_require(p_tenant_id,'extratos',true);
 if not exists(select 1 from public.fin_bank_accounts where tenant_id=p_tenant_id and id=p_account_id and deleted_at is null) then raise exception 'Conta não encontrada.' using errcode='22023'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or octet_length(p_rows::text)>2000000 then raise exception 'Arquivo inválido ou muito grande.' using errcode='22023'; end if;
 if jsonb_array_length(p_rows) not between 1 and 2000 then raise exception 'Importe de 1 a 2000 movimentos por vez.' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x group by x->>'source_key' having count(*)>1) then raise exception 'O arquivo contém identificadores bancários repetidos. Revise a prévia.' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r)<>'object' or not(r ?& array['posted_date','amount_cents','description','external_id','source_key','fingerprint']) or
   exists(select 1 from jsonb_object_keys(r) k where k not in ('posted_date','amount_cents','description','external_id','source_key','fingerprint')) then raise exception 'Campos do extrato inválidos.' using errcode='22023'; end if;
  if coalesce(r->>'posted_date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or
   jsonb_typeof(r->'amount_cents')<>'number' or coalesce(r->>'amount_cents','') !~ '^-?[0-9]+$' or
   (r->>'amount_cents')::numeric=0 or abs((r->>'amount_cents')::numeric)>9000000000000 or
   coalesce(length(btrim(r->>'description')),0) not between 1 and 500 or coalesce(length(r->>'source_key'),0) not between 1 and 200 or
   coalesce(r->>'fingerprint','') !~ '^[a-f0-9]{64}$' or length(r->>'external_id')>150 then raise exception 'Movimento inválido.' using errcode='22023'; end if;
  perform (r->>'posted_date')::date;
  select * into v from public.fin_transactions where tenant_id=p_tenant_id and account_id=p_account_id and source_key=r->>'source_key';
  if found then
   if v.posted_date<>(r->>'posted_date')::date or v.amount_cents<>(r->>'amount_cents')::bigint or v.description<>r->>'description' then raise exception 'Identificador já existe com outros dados. Nenhum movimento foi alterado.' using errcode='22023'; end if;
   duplicates:=duplicates+1;
  else
   if exists(select 1 from public.fin_transactions where tenant_id=p_tenant_id and account_id=p_account_id and fingerprint=r->>'fingerprint') then possible:=possible+1; end if;
   n:=n+1;
   if not coalesce(p_dry_run,true) then
    insert into public.fin_transactions(tenant_id,account_id,posted_date,amount_cents,description,external_id,source_key,fingerprint)
     values(p_tenant_id,p_account_id,(r->>'posted_date')::date,(r->>'amount_cents')::bigint,r->>'description',r->>'external_id',r->>'source_key',r->>'fingerprint');
   end if;
  end if;
  total:=total+1;
 end loop;
 return jsonb_build_object('total',total,'new',n,'duplicates',duplicates,'possible_duplicates',possible,'dry_run',coalesce(p_dry_run,true));
end $$;

create or replace function public.fin_classify_transaction(p_tenant_id uuid,p_id uuid,p_classification text,p_category text,p_channel text,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare v public.fin_transactions;
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 perform public.fin_require(p_tenant_id,'extratos',true);
 select * into v from public.fin_transactions where tenant_id=p_tenant_id and id=p_id and deleted_at is null for update;
 if not found or v.version is distinct from p_version then raise exception 'Movimento alterado. Recarregue.' using errcode='40001'; end if;
 if p_classification='transferencia' and exists(select 1 from public.fin_allocations where tenant_id=p_tenant_id and transaction_id=p_id and deleted_at is null) then raise exception 'Desfaça as alocações antes de classificar como transferência.' using errcode='22023'; end if;
 update public.fin_transactions set classification=p_classification,category=p_category,channel=nullif(btrim(p_channel),''),version=version+1,updated_at=now() where tenant_id=p_tenant_id and id=p_id;
end $$;
create or replace function public.fin_reconcile(p_tenant_id uuid,p_id uuid,p_transaction_id uuid,p_commitment_id uuid,p_amount_cents bigint)
returns void language plpgsql security definer set search_path='' as $$
declare t public.fin_transactions; c public.fin_commitments; a public.fin_allocations; used_t bigint; used_c bigint; company uuid;
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 perform public.fin_require(p_tenant_id,'extratos',true);
 select * into a from public.fin_allocations where tenant_id=p_tenant_id and id=p_id;
 if found then
  if a.deleted_at is null and a.transaction_id=p_transaction_id and a.commitment_id=p_commitment_id and a.amount_cents=p_amount_cents then return; end if;
  raise exception 'Identificação de conciliação já utilizada.' using errcode='22023';
 end if;
 select * into t from public.fin_transactions where tenant_id=p_tenant_id and id=p_transaction_id and deleted_at is null for update;
 select * into c from public.fin_commitments where tenant_id=p_tenant_id and id=p_commitment_id and deleted_at is null for update;
 if t.id is null or c.id is null or t.classification='transferencia' or (t.amount_cents>0)<>(c.direction='entrada') then raise exception 'Movimento e previsão incompatíveis.' using errcode='22023'; end if;
 select company_id into company from public.fin_bank_accounts where tenant_id=p_tenant_id and id=t.account_id;
 if c.company_id is not null and c.company_id<>company then raise exception 'A previsão pertence a outra empresa.' using errcode='22023'; end if;
 select coalesce(sum(amount_cents),0) into used_t from public.fin_allocations where tenant_id=p_tenant_id and transaction_id=t.id and deleted_at is null;
 select coalesce(sum(amount_cents),0) into used_c from public.fin_allocations where tenant_id=p_tenant_id and commitment_id=c.id and deleted_at is null;
 if p_amount_cents is null or p_amount_cents<=0 or p_amount_cents>abs(t.amount_cents)-used_t or p_amount_cents>c.amount_cents-used_c then raise exception 'Valor excede o saldo disponível para conciliar.' using errcode='22023'; end if;
 insert into public.fin_allocations(id,tenant_id,transaction_id,commitment_id,amount_cents) values(p_id,p_tenant_id,t.id,c.id,p_amount_cents);
 update public.fin_transactions set classification=case when classification='pendente' then 'operacional' else classification end,
 category=coalesce(category,c.category),version=version+1,updated_at=now() where tenant_id=p_tenant_id and id=t.id;
end $$;
create or replace function public.fin_save_import_profile(p_tenant_id uuid,p_id uuid,p_account_id uuid,p_name text,p_config jsonb,p_version integer default 0)
returns void language plpgsql security definer set search_path='' as $$
declare v public.fin_import_profiles;
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 perform public.fin_require(p_tenant_id,'extratos',true);
 if not exists(select 1 from public.fin_bank_accounts where tenant_id=p_tenant_id and id=p_account_id and deleted_at is null) then raise exception 'Conta inválida.' using errcode='22023'; end if;
 if p_version is null or p_version<0 then raise exception 'Versão inválida.' using errcode='22023'; end if;
 select * into v from public.fin_import_profiles where tenant_id=p_tenant_id and id=p_id for update;
 if found then
  if v.version<>p_version or v.deleted_at is not null then raise exception 'Perfil alterado. Recarregue.' using errcode='40001'; end if;
  if v.account_id<>p_account_id then raise exception 'O perfil pertence a outra conta.' using errcode='22023'; end if;
  update public.fin_import_profiles set name=btrim(p_name),config=p_config,version=version+1,updated_at=now() where tenant_id=p_tenant_id and id=p_id and account_id=p_account_id;
 else
  if p_version<>0 then raise exception 'Perfil não encontrado.' using errcode='22023'; end if;
  insert into public.fin_import_profiles(id,tenant_id,account_id,name,config) values(p_id,p_tenant_id,p_account_id,btrim(p_name),p_config);
 end if;
end $$;
revoke all on function public.fin_import_transactions(uuid,uuid,jsonb,boolean), public.fin_classify_transaction(uuid,uuid,text,text,text,integer),public.fin_reconcile(uuid,uuid,uuid,uuid,bigint), public.fin_save_import_profile(uuid,uuid,uuid,text,jsonb,integer) from public,anon,service_role;
grant execute on function public.fin_import_transactions(uuid,uuid,jsonb,boolean), public.fin_classify_transaction(uuid,uuid,text,text,text,integer),public.fin_reconcile(uuid,uuid,uuid,uuid,bigint), public.fin_save_import_profile(uuid,uuid,uuid,text,jsonb,integer) to authenticated;

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
 if exists(select 1 from jsonb_each_text(p_permissions) e where e.key not in ('empresas','contas','auditoria','planejamento','extratos') or e.value not in ('none','view','edit') or e.value is null) then
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
 if p_entity not in ('companies','bank_accounts','plans','commitments','transactions','allocations','import_profiles') or p_entity is null then raise exception 'Cadastro inválido.' using errcode='22023'; end if;
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
 if p_entity='bank_accounts' and exists(select 1 from public.fin_transactions where tenant_id=p_tenant_id and account_id=any(p_ids) and deleted_at is null) then raise exception 'A conta possui movimentos ativos.' using errcode='22023'; end if;
 if p_entity='transactions' and exists(select 1 from public.fin_allocations where tenant_id=p_tenant_id and transaction_id=any(p_ids) and deleted_at is null) then raise exception 'Desfaça as conciliações antes de arquivar o movimento.' using errcode='22023'; end if;
 if p_entity='commitments' and exists(select 1 from public.fin_allocations where tenant_id=p_tenant_id and commitment_id=any(p_ids) and deleted_at is null) then raise exception 'A previsão possui conciliações ativas.' using errcode='22023'; end if;
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
 if v_keys is distinct from array['fin_allocations','fin_audit_log','fin_bank_accounts','fin_commitments','fin_companies','fin_import_profiles','fin_memberships','fin_plans','fin_tenants','fin_transactions'] then
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
  if exists(select 1 from public.fin_allocations where tenant_id=p_tenant_id and commitment_id=p_id and deleted_at is null) and
   (a<(select sum(amount_cents) from public.fin_allocations where tenant_id=p_tenant_id and commitment_id=p_id and deleted_at is null) or
    v.direction is distinct from p_data->>'direction' or v.company_id is distinct from cid) then
   raise exception 'Previsão conciliada: preserve empresa, tipo e valor já vinculado.' using errcode='22023'; end if;
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
  if v.company_id<>v_company and exists(select 1 from public.fin_transactions where tenant_id=p_tenant_id and account_id=p_id) then raise exception 'Conta com movimentos: não altere a empresa titular.' using errcode='22023'; end if;
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

