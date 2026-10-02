\set ON_ERROR_STOP on
create or replace function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'TESTE: %',msg; end if; end $$;
begin;
select auth.test_login('11111111-1111-4111-8111-111111111111');
do $$
declare tenant uuid:='edd1a500-0000-4000-8000-000000000001'; account uuid:='55555555-5555-4555-8555-555555555555'; examples uuid[]:='{}'; tx uuid; rule uuid:=gen_random_uuid(); payload jsonb; result jsonb;
begin
 for i in 1..4 loop
  payload:=jsonb_build_array(jsonb_build_object('posted_date','2026-09-0'||i,'amount_cents',1000,'description','Repasse teste aprendizado','external_id','learn-'||i,'source_key','learn-'||i,'fingerprint',repeat(i::text,64)));
  perform public.fin_import_transactions(tenant,account,payload,false);
  select id into tx from public.fin_transactions where tenant_id=tenant and source_key='learn-'||i;
  if i<4 then
   perform public.fin_classify_transaction(tenant,tx,'repasse',null,'Canal teste',1);
   examples:=array_append(examples,tx);
  end if;
 end loop;
 begin perform public.fin_approve_rule(tenant,rule,examples[1:2]); raise exception 'dois exemplos deveriam falhar'; exception when sqlstate '22023' then null; end;
 perform public.fin_approve_rule(tenant,rule,examples);
 result:=public.fin_apply_rules(tenant,array[tx],true);
 perform pg_temp.assert_true((result->>'affected')::int=1,'simulação de um pendente');
 perform pg_temp.assert_true((select classification='pendente' from public.fin_transactions where id=tx),'simulação não altera');
 perform public.fin_apply_rules(tenant,array[tx],false);
 result:=public.fin_apply_rules(tenant,array[tx],false);
 perform pg_temp.assert_true((result->>'affected')::int=0,'aplicação é idempotente');
 perform pg_temp.assert_true((select rule_id=rule from public.fin_transactions where id=tx),'origem automática registrada');
 payload:=jsonb_set(jsonb_set(payload,'{0,source_key}','"learn-5"'),'{0,external_id}','"learn-5"');
 perform public.fin_import_transactions(tenant,account,payload,false);
 select id into tx from public.fin_transactions where tenant_id=tenant and source_key='learn-5';
 perform pg_temp.assert_true((select classification='repasse' and rule_id=rule from public.fin_transactions where id=tx),'nova importação aplica regra aprovada');
 perform pg_temp.assert_true((select count(*)=0 from public.fin_allocations where transaction_id=tx),'automação não inventa vínculo financeiro');
 begin perform public.fin_approve_rule(tenant,gen_random_uuid(),array_append(examples[1:2],tx)); raise exception 'automação não deveria se reforçar'; exception when sqlstate '22023' then null; end;
 perform public.fin_classify_transaction(tenant,tx,'aporte',null,null,1);
 perform pg_temp.assert_true((select not active from public.fin_rules where id=rule),'correção pausa regra');
 perform pg_temp.assert_true((select rule_id is null from public.fin_transactions where id=tx),'correção tem origem manual');
 begin perform public.fin_approve_rule(tenant,gen_random_uuid(),examples); raise exception 'conflito fora dos exemplos deveria bloquear aprovação'; exception when sqlstate '22023' then null; end;
 payload:=jsonb_set(jsonb_set(payload,'{0,source_key}','"learn-6"'),'{0,external_id}','"learn-6"');
 perform public.fin_import_transactions(tenant,account,payload,false);
 perform pg_temp.assert_true((select classification='pendente' from public.fin_transactions where source_key='learn-6'),'regra pausada não atua');
 begin update public.fin_rules set active=true; raise exception 'escrita direta deveria falhar'; exception when insufficient_privilege then null; end;
end $$;
commit;
begin;
select auth.test_login('22222222-2222-4222-8222-222222222222');
select pg_temp.assert_true((select count(*)=1 from public.fin_rules),'leitor do extrato vê regras');
do $$ begin
 begin perform public.fin_approve_rule('edd1a500-0000-4000-8000-000000000001',gen_random_uuid(),array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()]); raise exception 'leitor não aprova'; exception when insufficient_privilege then null; end;
 begin perform public.fin_apply_rules('edd1a500-0000-4000-8000-000000000001',array[gen_random_uuid()],false); raise exception 'leitor não aplica'; exception when insufficient_privilege then null; end;
end $$;
commit;
begin;
select auth.test_login('33333333-3333-4333-8333-333333333333');
select pg_temp.assert_true((select count(*)=0 from public.fin_rules),'outro grupo não vê regras');
commit;
select 'Aprendizagem: exemplos manuais, aprovação, simulação, idempotência, aplicação, pausa, auditoria e RLS aprovados.' as resultado;
