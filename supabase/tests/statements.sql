\set ON_ERROR_STOP on
create or replace function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'TESTE: %',msg; end if; end $$;
begin;
select auth.test_login('11111111-1111-4111-8111-111111111111');
do $$
declare tenant uuid:='edd1a500-0000-4000-8000-000000000001'; account uuid:='55555555-5555-4555-8555-555555555555'; payload jsonb; result jsonb; txn uuid; a uuid:=gen_random_uuid(); c uuid:='88888888-8888-4888-8888-888888888888';
begin
 payload:=jsonb_build_array(jsonb_build_object('posted_date','2026-09-20','amount_cents',-600,'description','Fornecedor teste','external_id','bank-001','source_key','id:bank-001','fingerprint',repeat('a',64)));
 result:=public.fin_import_transactions(tenant,account,payload,true);
 perform pg_temp.assert_true((result->>'new')::int=1,'prévia conta um novo');
 perform pg_temp.assert_true((select count(*)=0 from public.fin_transactions),'prévia não grava');
 result:=public.fin_import_transactions(tenant,account,payload,false);
 result:=public.fin_import_transactions(tenant,account,payload,false);
 perform pg_temp.assert_true((result->>'duplicates')::int=1,'reimportação deduplica');
 select id into txn from public.fin_transactions where tenant_id=tenant;
 begin perform public.fin_import_transactions(tenant,account,jsonb_set(payload,'{0,amount_cents}','-601'),false); raise exception 'identidade conflituosa deveria falhar'; exception when sqlstate '22023' then null; end;
 begin perform public.fin_import_transactions(tenant,account,'[]',false); raise exception 'lista vazia deveria falhar'; exception when sqlstate '22023' then null; end;
 perform public.fin_reconcile(tenant,a,txn,c,600);
 perform public.fin_reconcile(tenant,a,txn,c,600);
 perform pg_temp.assert_true((select sum(amount_cents)=600 from public.fin_allocations),'alocação idempotente');
 begin perform public.fin_reconcile(tenant,gen_random_uuid(),txn,c,1); raise exception 'excesso deveria falhar'; exception when sqlstate '22023' then null; end;
 begin perform public.fin_classify_transaction(tenant,txn,'transferencia',null,null,2); raise exception 'transferência conciliada deveria falhar'; exception when sqlstate '22023' then null; end;
 begin perform public.fin_save_commitment(tenant,c,'{"name":"Reduzir","company_id":null,"due_date":"2026-09-20","amount_cents":500,"direction":"saida","category":"fornecedores"}',1); raise exception 'redução abaixo do realizado deveria falhar'; exception when sqlstate '22023' then null; end;
 begin perform public.fin_archive(tenant,'commitments',array[c],true); raise exception 'previsão conciliada não deve arquivar'; exception when sqlstate '22023' then null; end;
 begin update public.fin_transactions set amount_cents=123; raise exception 'escrita direta deveria falhar'; exception when insufficient_privilege then null; end;
 perform public.fin_save_import_profile(tenant,gen_random_uuid(),account,'CSV','{"date":0,"description":1,"amount":2,"debit":-1,"credit":-1,"external":-1,"start":1,"fill_date":false,"invert":false,"format":"br"}');
 perform public.fin_save_member(tenant,'leitura@example.test','membro',true,'{"planejamento":"view","contas":"view","extratos":"view"}',2);
end $$;
commit;
begin;
select auth.test_login('22222222-2222-4222-8222-222222222222');
select pg_temp.assert_true((select count(*)=1 from public.fin_transactions),'leitor vê extrato do grupo');
do $$ begin
 begin perform public.fin_import_transactions('edd1a500-0000-4000-8000-000000000001','55555555-5555-4555-8555-555555555555','[]',false); raise exception 'leitor não importa'; exception when insufficient_privilege then null; end;
end $$;
commit;
begin;
select auth.test_login('33333333-3333-4333-8333-333333333333');
select pg_temp.assert_true((select count(*)=0 from public.fin_transactions),'outro grupo não vê extratos');
select pg_temp.assert_true((select count(*)=0 from public.fin_allocations),'outro grupo não vê conciliações');
do $$ begin
 begin perform public.fin_reconcile('edd1a500-0000-4000-8000-000000000001',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),100); raise exception 'outro grupo não concilia'; exception when insufficient_privilege then null; end;
end $$;
commit;
select 'Extratos: dry-run, deduplicação, conflitos, conciliação parcial, limite, RLS e idempotência aprovados.' as resultado;
