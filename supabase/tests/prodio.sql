\set ON_ERROR_STOP on
create or replace function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'TESTE: %',msg; end if; end $$;
create or replace function pg_temp.unlock_prodio() returns void language sql security definer as $$ update public.fin_prodio_sources set next_attempt_at=now()-interval '1 minute' $$;
create or replace function pg_temp.finish_prodio(s jsonb,docs jsonb,probe boolean default false,company uuid default '77777777-7777-4777-8777-777777777777') returns void language sql as $$
 select public.fin_prodio_finish('edd1a500-0000-4000-8000-000000000001','pedidos',(s->>'lease_id')::uuid,probe,docs,'{"next":null,"since":"2026-09-01T00:00:00Z"}',not probe,company,'Eddias','America/Sao_Paulo',null,false,60)
$$;
create or replace function pg_temp.prodio_payload(amount integer,hash text,updated text default '2026-09-10T12:00:00Z') returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('source_id','88888888-8888-4888-8888-888888888888','source_updated_at',updated,'business_date','2026-09-10','amount_cents',amount,'description','Pedido sintético','status','enviado','purchase_ids','[]'::jsonb,'payment_terms','[]'::jsonb,'fingerprint',repeat(hash,64)))
$$;
begin;
set local role service_role;
do $$
declare tenant uuid:='edd1a500-0000-4000-8000-000000000001';s jsonb;i integer;
begin
 s:=public.fin_prodio_claim(tenant,'pedidos',true);perform pg_temp.assert_true(s->>'lease_id' is not null,'lease inicial');
 perform pg_temp.assert_true(public.fin_prodio_claim(tenant,'compras',true) is null,'intervalo e exclusão global entre fontes');
 perform pg_temp.finish_prodio(s,'[]',true);
 begin perform public.fin_prodio_bootstrap_enable(tenant,'pedidos');raise exception 'fonte sem lote não pode ativar';exception when sqlstate '22023' then null;end;
 for i in 1..2 loop
  perform pg_temp.unlock_prodio();s:=public.fin_prodio_claim(tenant,'pedidos',false);perform pg_temp.finish_prodio(s,pg_temp.prodio_payload(8000,'a'));
 end loop;
 perform pg_temp.assert_true((select count(*)=1 and max(version)=1 from public.fin_prodio_documents),'repetição idempotente');
 perform public.fin_prodio_bootstrap_enable(tenant,'pedidos');
 perform pg_temp.unlock_prodio();s:=public.fin_prodio_claim(tenant,'pedidos',false);perform pg_temp.finish_prodio(s,pg_temp.prodio_payload(9000,'b','2026-09-11T12:00:00Z'));
 perform pg_temp.unlock_prodio();s:=public.fin_prodio_claim(tenant,'pedidos',false);perform pg_temp.finish_prodio(s,pg_temp.prodio_payload(8000,'a'));
 perform pg_temp.assert_true((select amount_cents=9000 and version=2 from public.fin_prodio_documents),'evento antigo não desfaz atualização');
 perform pg_temp.unlock_prodio();s:=public.fin_prodio_claim(tenant,'pedidos',false);
 begin perform pg_temp.finish_prodio(s,'[]',false,'99999999-9999-4999-8999-999999999999');raise exception 'outra empresa deveria falhar';exception when insufficient_privilege then null;end;
 begin perform pg_temp.finish_prodio(jsonb_build_object('lease_id',null),'[]');raise exception 'lease nulo deveria falhar';exception when serialization_failure then null;end;
 perform pg_temp.finish_prodio(s,'[]');
 perform pg_temp.assert_true((select count(*)=1 from public.fin_prodio_documents),'lista vazia não exclui');
 begin perform pg_temp.finish_prodio(s,'[]');raise exception 'lease consumido deveria falhar';exception when serialization_failure then null;end;
 begin update public.fin_prodio_documents set amount_cents=1;raise exception 'escrita direta deveria falhar';exception when insufficient_privilege then null;end;
 for i in 1..5 loop
  perform pg_temp.unlock_prodio();s:=public.fin_prodio_claim(tenant,'pedidos',false);
  perform public.fin_prodio_finish(tenant,'pedidos',(s->>'lease_id')::uuid,false,'[]','{}',false,null,null,null,'Limite sintético',true,120);
  if i<5 then perform pg_temp.assert_true((select enabled and validated_at is not null from public.fin_prodio_sources where kind='pedidos'),'falha temporária permite retomada automática');end if;
 end loop;
 perform pg_temp.assert_true((select not enabled and validated_at is null and failure_count=5 and cursor->>'since'='2026-09-01T00:00:00Z' and next_attempt_at>=now()+interval '120 seconds' from public.fin_prodio_sources where kind='pedidos'),'cinco falhas pausam preservando cursor');
end $$;
commit;
begin;
select auth.test_login('11111111-1111-4111-8111-111111111111');
select pg_temp.assert_true((select count(*)=1 from public.fin_prodio_documents),'administrador vê documentos');
do $$ begin
 begin perform public.fin_prodio_claim('edd1a500-0000-4000-8000-000000000001','pedidos',true);raise exception 'usuário não opera cursor';exception when insufficient_privilege then null;end;
 begin update public.fin_prodio_documents set amount_cents=1;raise exception 'usuário não escreve cópia';exception when insufficient_privilege then null;end;
end $$;
commit;
begin;
select auth.test_login('22222222-2222-4222-8222-222222222222');
select pg_temp.assert_true((select count(*)=0 from public.fin_prodio_documents),'membro não lê painel administrativo');
do $$ declare s uuid;begin
 begin perform public.fin_prodio_enable('edd1a500-0000-4000-8000-000000000001',s,true,1);raise exception 'membro não ativa fonte';exception when insufficient_privilege then null;end;
end $$;
commit;
begin;
select auth.test_login('33333333-3333-4333-8333-333333333333');
select pg_temp.assert_true((select count(*)=0 from public.fin_prodio_sources),'outro grupo não lê conexão');
select pg_temp.assert_true((select count(*)=0 from public.fin_prodio_documents),'outro grupo não lê documentos');
commit;
select 'Prodio: empresa, lease, intervalo, idempotência, atualizações fora de ordem, lista vazia, backoff, pausa, permissões e RLS aprovados.' as resultado;
