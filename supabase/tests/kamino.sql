\set ON_ERROR_STOP on
create or replace function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'TESTE: %',msg; end if; end $$;
-- Somente relógio/fixtures do teste local. Nenhuma função temporária vai para a migração.
create or replace function pg_temp.unlock_kamino() returns void language sql security definer as $$ update public.fin_kamino_sources set next_attempt_at=now()-interval '1 minute' $$;
create or replace function pg_temp.load_doc(p_amount integer,p_hash text) returns void language plpgsql security definer as $$
declare tenant uuid:='edd1a500-0000-4000-8000-000000000001'; s jsonb; payload jsonb;
begin
 perform pg_temp.unlock_kamino();s:=public.fin_kamino_claim(tenant,'principal','pagamentos',false);
 payload:=jsonb_build_array(jsonb_build_object('source_id','10','description','Título Kamino teste','due_date','2026-11-10','issue_date','2026-09-01','amount_cents',p_amount,'paid_cents',null,'status','1','unit_id','1','supplier','Fornecedor sintético','supplier_document',null,'invoice_number','100','invoice_key',null,'invoice_source_id','20','category_key','Fornecedor','fingerprint',repeat(p_hash,64)));
 perform public.fin_kamino_finish(tenant,'principal','pagamentos',(s->>'lease_id')::uuid,false,payload,'{"page":2}',false,null,60);
end $$;
begin;
set local role service_role;
do $$
declare tenant uuid:='edd1a500-0000-4000-8000-000000000001'; s jsonb;
begin
 s:=public.fin_kamino_claim(tenant,'principal','pagamentos',true);
 perform pg_temp.assert_true(s->>'lease_id' is not null,'lease concedido');
 perform pg_temp.assert_true(public.fin_kamino_claim(tenant,'home','notas',true) is null,'fontes compartilham intervalo/lease');
 perform public.fin_kamino_finish(tenant,'principal','pagamentos',(s->>'lease_id')::uuid,true,'[]','{}',false,null,60);
 perform pg_temp.load_doc(5000,'a');perform pg_temp.load_doc(5000,'a');
 perform pg_temp.assert_true((select count(*)=1 and max(version)=1 from public.fin_kamino_documents),'repetição não duplica nem altera versão');
 perform pg_temp.unlock_kamino();s:=public.fin_kamino_claim(tenant,'principal','pagamentos',false);
 begin perform public.fin_kamino_finish(tenant,'principal','pagamentos',gen_random_uuid(),false,'[]','{}',true,null,60);raise exception 'lease incorreto deveria falhar';exception when serialization_failure then null;end;
 perform public.fin_kamino_finish(tenant,'principal','pagamentos',(s->>'lease_id')::uuid,false,'[]','{"page":1}',true,null,60);
 perform pg_temp.assert_true((select count(*)=1 from public.fin_kamino_documents),'resposta vazia preserva documentos');
 begin update public.fin_kamino_documents set amount_cents=1;raise exception 'escrita direta deveria falhar';exception when insufficient_privilege then null;end;
end $$;
commit;
begin;
select auth.test_login('11111111-1111-4111-8111-111111111111');
do $$
declare tenant uuid:='edd1a500-0000-4000-8000-000000000001'; company uuid:='44444444-4444-4444-8444-000000000001'; d public.fin_kamino_documents; result jsonb; c uuid:=gen_random_uuid(); tx uuid; payload jsonb;
begin
 select * into d from public.fin_kamino_documents where source_id='10';
 payload:=jsonb_build_array(jsonb_build_object('id',d.id,'version',d.version));
 result:=public.fin_kamino_review(tenant,payload,company,'fornecedores',null,true);
 perform pg_temp.assert_true((result->>'total')::int=1,'prévia válida');
 perform pg_temp.assert_true((select commitment_id is null from public.fin_kamino_documents where id=d.id),'prévia não cria previsão');
 perform public.fin_save_commitment(tenant,c,jsonb_build_object('name','Previsão manual existente','company_id',company,'due_date','2026-11-10','amount_cents',5000,'direction','saida','category','fornecedores'),0);
 result:=public.fin_kamino_review(tenant,payload,company,'fornecedores',null,true);
 perform pg_temp.assert_true((result->>'possible_duplicates')::int=1,'sinaliza previsão existente');
 begin perform public.fin_kamino_review(tenant,payload,company,'fornecedores',null,false);raise exception 'duplicata deveria bloquear';exception when sqlstate '22023' then null;end;
 perform public.fin_kamino_review(tenant,payload,company,'fornecedores',c,false);
 perform pg_temp.assert_true((select commitment_id=c and reviewed_fingerprint=fingerprint from public.fin_kamino_documents where id=d.id),'vínculo aproveita previsão existente');
 perform public.fin_import_transactions(tenant,'55555555-5555-4555-8555-555555555555','[{"posted_date":"2026-11-10","amount_cents":-1000,"description":"Parcial do fornecedor","external_id":"kamino-test","source_key":"kamino-test","fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]',false);
 select id into tx from public.fin_transactions where source_key='kamino-test';perform public.fin_reconcile(tenant,gen_random_uuid(),tx,c,1000);
 perform pg_temp.load_doc(5001,'b');select * into d from public.fin_kamino_documents where source_id='10';
 perform pg_temp.assert_true(d.reviewed_fingerprint<>d.fingerprint,'alteração na fonte exige revisão');
 payload:=jsonb_build_array(jsonb_build_object('id',d.id,'version',d.version));
 begin perform public.fin_kamino_review(tenant,payload,company,'fornecedores',null,false);raise exception 'previsão conciliada não pode mudar silenciosamente';exception when sqlstate '22023' then null;end;
 perform pg_temp.assert_true((select amount_cents=5000 from public.fin_commitments where id=c),'previsão conciliada preservada');
 begin perform public.fin_kamino_claim(tenant,'principal','pagamentos',false);raise exception 'usuário não opera cursor privilegiado';exception when insufficient_privilege then null;end;
end $$;
commit;
begin;
set local role service_role;
do $$
declare tenant uuid:='edd1a500-0000-4000-8000-000000000001'; s jsonb;
begin
 perform pg_temp.unlock_kamino();s:=public.fin_kamino_claim(tenant,'principal','pagamentos',false);
 perform public.fin_kamino_finish(tenant,'principal','pagamentos',(s->>'lease_id')::uuid,false,'[]','{}',false,'Falha sintética',120);
 perform pg_temp.assert_true((select not enabled and validated_at is null and cursor='{"page":2}'::jsonb and next_attempt_at>=now()+interval '120 seconds' from public.fin_kamino_sources),'falha pausa, preserva cursor e respeita cooldown');
end $$;
commit;
begin;
select auth.test_login('22222222-2222-4222-8222-222222222222');
select pg_temp.assert_true((select count(*)=0 from public.fin_kamino_documents),'membro não lê painel administrativo');
do $$ begin begin perform public.fin_kamino_review('edd1a500-0000-4000-8000-000000000001','[]',null,'outros',null,false);raise exception 'membro não revisa';exception when insufficient_privilege then null;end;end $$;
commit;
begin;
select auth.test_login('33333333-3333-4333-8333-333333333333');
select pg_temp.assert_true((select count(*)=0 from public.fin_kamino_sources),'outro grupo não lê fontes');
select pg_temp.assert_true((select count(*)=0 from public.fin_kamino_documents),'outro grupo não lê documentos');
commit;
select 'Kamino: lease, intervalo, idempotência, lista vazia, revisão, duplicatas, vínculos preservados, erros e RLS aprovados.' as resultado;
