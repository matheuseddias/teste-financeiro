\set ON_ERROR_STOP on
create or replace function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'TESTE: %',msg; end if; end $$;
begin;
select auth.test_login('11111111-1111-4111-8111-111111111111');
do $$
declare t uuid:='edd1a500-0000-4000-8000-000000000001'; id uuid:='99999999-9999-4999-8999-999999999999'; p jsonb;
begin
 p:='{"start_month":"2026-09-01","months":3,"opening_cents":null,"supplier_bps":3000,"tax_bps":0,"notes":"Teste","channels":[{"id":"c1","name":"Canal","net_bps":8000,"lag_days":30,"gmv_cents":[10000,20000,30000]}],"costs":[]}';
 perform public.fin_save_plan(t,id,'Base',p);
 perform public.fin_save_plan(t,id,'Base',p);
 perform pg_temp.assert_true((select count(*)=1 from public.fin_plans),'criação idempotente');
 begin perform public.fin_save_plan(t,id,'Conflito',p,9); raise exception 'deveria rejeitar versão'; exception when serialization_failure then null; end;
 begin perform public.fin_save_plan(t,gen_random_uuid(),'Inválido',jsonb_set(p,'{channels,0,net_bps}','10001')); raise exception 'deveria rejeitar percentual'; exception when sqlstate '22023' then null; end;
 begin perform public.fin_save_plan(t,gen_random_uuid(),'Inválido',jsonb_set(p,'{channels,0,gmv_cents}','[1.1,0,0]')); raise exception 'deveria rejeitar fração'; exception when sqlstate '22023' then null; end;
 begin perform public.fin_save_plan(t,gen_random_uuid(),'Inválido',p-'months'); raise exception 'deveria rejeitar ausente'; exception when sqlstate '22023' then null; end;
 begin perform public.fin_save_plan(t,gen_random_uuid(),'Inválido',jsonb_set(p,'{channels,0,id}','null')); raise exception 'deveria rejeitar nulo'; exception when sqlstate '22023' then null; end;
 begin perform public.fin_save_plan(t,gen_random_uuid(),'Inválido',jsonb_set(p,'{costs}','[{"id":"x","name":"x","category":"fixos","amounts":[null,0,0]}]')); raise exception 'deveria rejeitar valor nulo'; exception when sqlstate '22023' then null; end;
 begin update public.fin_plans set name='Direto'; raise exception 'deveria rejeitar escrita direta'; exception when insufficient_privilege then null; end;
 perform public.fin_save_commitment(t,'88888888-8888-4888-8888-888888888888','{"name":"Fornecedor","company_id":null,"due_date":"2026-09-20","amount_cents":1000,"direction":"saida","category":"fornecedores"}');
 begin perform public.fin_save_commitment(t,gen_random_uuid(),'{"name":"Inválido","company_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","due_date":"2026-09-20","amount_cents":1000,"direction":"saida","category":"fornecedores"}'); raise exception 'deveria rejeitar outra empresa'; exception when sqlstate '22023' then null; end;
 perform public.fin_save_member(t,'leitura@example.test','membro',true,'{"planejamento":"view","contas":"view"}',1);
 perform pg_temp.assert_true((public.fin_archive(t,'plans',array[id],true)->>'blocked')::boolean,'arquivamento acima de 30% bloqueado');
 perform pg_temp.assert_true((select count(*)>0 from public.fin_audit_log where entity='fin_plans'),'cenários auditados');
end $$;
commit;
begin;
select auth.test_login('22222222-2222-4222-8222-222222222222');
select pg_temp.assert_true((select count(*)=1 from public.fin_plans),'leitor autorizado vê cenário');
do $$ begin
 begin perform public.fin_save_commitment('edd1a500-0000-4000-8000-000000000001',gen_random_uuid(),'{}'); raise exception 'leitor não grava'; exception when insufficient_privilege then null; end;
end $$;
commit;
begin;
select auth.test_login('33333333-3333-4333-8333-333333333333');
select pg_temp.assert_true((select count(*)=0 from public.fin_plans),'outro grupo não vê cenários');
select pg_temp.assert_true((select count(*)=0 from public.fin_commitments),'outro grupo não vê lançamentos');
do $$ begin
 begin perform public.fin_save_plan('edd1a500-0000-4000-8000-000000000001',gen_random_uuid(),'Invasão','{}'); raise exception 'outro grupo não grava'; exception when insufficient_privilege then null; end;
end $$;
commit;
select 'Planejamento: validação, RLS, versões, escrita restrita e auditoria aprovados.' as resultado;
