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
