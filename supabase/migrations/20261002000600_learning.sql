-- Regras exatas de classificação, aprendidas apenas de confirmações manuais.
-- Vínculos de pagamento continuam explícitos; regra nunca altera valor/data bancária.
create table if not exists public.fin_rules (
 id uuid primary key, tenant_id uuid not null references public.fin_tenants(id), account_id uuid not null,
 description_key text not null check(length(description_key) between 1 and 500), direction integer not null check(direction in (-1,1)),
 classification text not null check(classification in ('operacional','repasse')),
 category text check(category in ('fornecedores','fixos','impostos','outros')), channel text check(length(btrim(channel)) between 1 and 120),
 example_ids uuid[] not null check(cardinality(example_ids) between 3 and 100), active boolean not null default true,
 version integer not null default 1, deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tenant_id,id), foreign key(tenant_id,account_id) references public.fin_bank_accounts(tenant_id,id),
 check(classification<>'repasse' or (direction=1 and channel is not null))
);
create unique index if not exists fin_rule_active_match on public.fin_rules(tenant_id,account_id,description_key,direction) where active and deleted_at is null;
alter table public.fin_transactions add column if not exists rule_id uuid references public.fin_rules(id);
alter table public.fin_rules enable row level security;
revoke all on public.fin_rules from public,anon,authenticated,service_role;
grant select on public.fin_rules to authenticated,service_role;
drop policy if exists fin_rule_read on public.fin_rules;
create policy fin_rule_read on public.fin_rules for select to authenticated using(public.fin_can(tenant_id,'extratos'));
drop trigger if exists fin_audit_rules on public.fin_rules;
create trigger fin_audit_rules after insert or update or delete on public.fin_rules for each row execute function public.fin_audit();
create or replace function public.fin_description_key(p_text text) returns text
language sql immutable set search_path='' as $$ select lower(regexp_replace(btrim(p_text),'\s+',' ','g')) $$;

create or replace function public.fin_approve_rule(p_tenant_id uuid,p_id uuid,p_examples uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare t public.fin_transactions; v_count integer; v_days integer;
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 perform public.fin_require(p_tenant_id,'admin',true);
 if p_examples is null or cardinality(p_examples) not between 3 and 100 then raise exception 'Selecione de 3 a 100 confirmações manuais.' using errcode='22023'; end if;
 select * into t from public.fin_transactions where tenant_id=p_tenant_id and id=p_examples[1] and deleted_at is null;
 if t.id is null or t.classification not in ('operacional','repasse') or t.rule_id is not null then raise exception 'Exemplo não elegível.' using errcode='22023'; end if;
 select count(*),count(distinct posted_date) into v_count,v_days from public.fin_transactions
 where tenant_id=p_tenant_id and id=any(p_examples) and deleted_at is null and rule_id is null and account_id=t.account_id
 and sign(amount_cents)=sign(t.amount_cents) and public.fin_description_key(description)=public.fin_description_key(t.description)
 and classification=t.classification and category is not distinct from t.category and channel is not distinct from t.channel;
 if v_count<>cardinality(p_examples) or v_days<2 then raise exception 'Exemplos devem ser distintos, consistentes e de ao menos duas datas.' using errcode='22023'; end if;
 -- Não ocultar conflitos manuais fora dos exemplos escolhidos pela interface.
 if exists(select 1 from public.fin_transactions x where x.tenant_id=p_tenant_id and x.account_id=t.account_id and x.deleted_at is null and x.rule_id is null
   and x.classification<>'pendente' and sign(x.amount_cents)=sign(t.amount_cents)
   and public.fin_description_key(x.description)=public.fin_description_key(t.description)
   and (x.classification<>t.classification or x.category is distinct from t.category or x.channel is distinct from t.channel)) then
  raise exception 'Há confirmações manuais conflitantes para esta descrição.' using errcode='22023'; end if;
 insert into public.fin_rules(id,tenant_id,account_id,description_key,direction,classification,category,channel,example_ids)
 values(p_id,p_tenant_id,t.account_id,public.fin_description_key(t.description),sign(t.amount_cents),t.classification,t.category,t.channel,p_examples);
end $$;

create or replace function public.fin_toggle_rule(p_tenant_id uuid,p_id uuid,p_active boolean,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 perform public.fin_require(p_tenant_id,'admin',true);
 if p_active is null then raise exception 'Estado inválido.' using errcode='22023'; end if;
 update public.fin_rules set active=p_active,version=version+1,updated_at=now() where tenant_id=p_tenant_id and id=p_id and version=p_version and deleted_at is null;
 if not found then raise exception 'Regra alterada. Recarregue.' using errcode='40001'; end if;
end $$;

create or replace function public.fin_classify_new_transaction() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.fin_rules;
begin
 if new.classification<>'pendente' then return new; end if;
 select * into r from public.fin_rules where tenant_id=new.tenant_id and account_id=new.account_id and active and deleted_at is null
 and description_key=public.fin_description_key(new.description) and direction=sign(new.amount_cents);
 if found then new.classification:=r.classification; new.category:=r.category; new.channel:=r.channel; new.rule_id:=r.id; end if;
 return new;
end $$;
drop trigger if exists fin_classify_import on public.fin_transactions;
create trigger fin_classify_import before insert on public.fin_transactions for each row execute function public.fin_classify_new_transaction();

create or replace function public.fin_apply_rules(p_tenant_id uuid,p_ids uuid[],p_dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.fin_transactions; r public.fin_rules; v_count integer:=0;
begin
 perform 1 from public.fin_tenants where id=p_tenant_id for update;
 perform public.fin_require(p_tenant_id,'admin',true);
 if p_ids is null or cardinality(p_ids) not between 1 and 2000 then raise exception 'Selecione de 1 a 2000 movimentos.' using errcode='22023'; end if;
 if exists(select 1 from unnest(p_ids) x where x is null or not exists(select 1 from public.fin_transactions where tenant_id=p_tenant_id and id=x and deleted_at is null)) then raise exception 'Movimento inválido.' using errcode='22023'; end if;
 for t in select * from public.fin_transactions where tenant_id=p_tenant_id and id=any(p_ids) and classification='pendente' and deleted_at is null loop
  select * into r from public.fin_rules where tenant_id=p_tenant_id and account_id=t.account_id and active and deleted_at is null and description_key=public.fin_description_key(t.description) and direction=sign(t.amount_cents);
  if found then
   v_count:=v_count+1;
   if not coalesce(p_dry_run,true) then update public.fin_transactions set classification=r.classification,category=r.category,channel=r.channel,rule_id=r.id,version=version+1,updated_at=now() where tenant_id=p_tenant_id and id=t.id; end if;
  end if;
 end loop;
 return jsonb_build_object('affected',v_count,'dry_run',coalesce(p_dry_run,true));
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
 -- Uma correção manual conflitante pausa a automação dessa descrição.
 update public.fin_rules set active=false,version=version+1,updated_at=now() where tenant_id=p_tenant_id and account_id=v.account_id and active and deleted_at is null
 and direction=sign(v.amount_cents) and description_key=public.fin_description_key(v.description)
 and (classification is distinct from p_classification or category is distinct from p_category or channel is distinct from nullif(btrim(p_channel),''));
 update public.fin_transactions set classification=p_classification,category=p_category,channel=nullif(btrim(p_channel),''),rule_id=null,version=version+1,updated_at=now() where tenant_id=p_tenant_id and id=p_id;
end $$;
revoke all on function public.fin_classify_new_transaction(),public.fin_approve_rule(uuid,uuid,uuid[]),public.fin_toggle_rule(uuid,uuid,boolean,integer),public.fin_apply_rules(uuid,uuid[],boolean) from public,anon,service_role;
grant execute on function public.fin_approve_rule(uuid,uuid,uuid[]),public.fin_toggle_rule(uuid,uuid,boolean,integer),public.fin_apply_rules(uuid,uuid[],boolean) to authenticated;

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
 if v_keys is distinct from array['fin_allocations','fin_audit_log','fin_bank_accounts','fin_commitments','fin_companies','fin_import_profiles','fin_memberships','fin_plans','fin_rules','fin_tenants','fin_transactions'] then
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
