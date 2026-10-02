\set ON_ERROR_STOP on
create or replace function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'TESTE: %',msg; end if; end $$;
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','admin@example.test'),
 ('22222222-2222-4222-8222-222222222222','leitura@example.test'),
 ('33333333-3333-4333-8333-333333333333','outro@example.test');
insert into public.fin_tenants(id,name,slug) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Outro grupo','outro');
insert into public.fin_memberships(tenant_id,user_id,role,permissions) values
 ('edd1a500-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','admin','{}'),
 ('edd1a500-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','membro','{"contas":"view"}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','admin','{}');
begin;
select auth.test_login('11111111-1111-4111-8111-111111111111');
do $$
begin
 for i in 1..4 loop
  perform public.fin_save_company('edd1a500-0000-4000-8000-000000000001',
   ('44444444-4444-4444-8444-'||lpad(i::text,12,'0'))::uuid,'Empresa '||i);
 end loop;
end $$;
select public.fin_save_account('edd1a500-0000-4000-8000-000000000001','55555555-5555-4555-8555-555555555555',
 '{"company_id":"44444444-4444-4444-8444-000000000001","name":"Principal","bank_name":"Kamino","bank_code":"","branch":"","account_number":"001","kind":"pagamento","currency":"BRL","reference_date":"2026-10-01","reference_balance_cents":0}');
select pg_temp.assert_true((select count(*)=1 from public.fin_bank_accounts),'conta criada uma vez');
do $$ begin
 begin
  perform public.fin_save_account('edd1a500-0000-4000-8000-000000000001',gen_random_uuid(),
   '{"company_id":"44444444-4444-4444-8444-000000000001","name":"Sem data","bank_name":"Banco","account_number":"002","kind":"corrente","currency":"BRL","reference_balance_cents":100}');
  raise exception 'deveria rejeitar saldo sem data';
 exception when sqlstate '22023' then null; end;
 begin
  update public.fin_bank_accounts set name='Direto';
  raise exception 'deveria bloquear escrita direta';
 exception when insufficient_privilege then null; end;
 begin
  perform public.fin_save_company('edd1a500-0000-4000-8000-000000000001',
   '44444444-4444-4444-8444-000000000001','Concorrente',null,9);
  raise exception 'deveria detectar versão desatualizada';
 exception when serialization_failure then null; end;
 begin
  perform public.fin_save_member('edd1a500-0000-4000-8000-000000000001','admin@example.test','membro',true,'{}',1);
  raise exception 'deveria preservar último admin';
 exception when sqlstate '22023' then null; end;
end $$;
select pg_temp.assert_true((public.fin_archive('edd1a500-0000-4000-8000-000000000001','companies',
 array['44444444-4444-4444-8444-000000000003','44444444-4444-4444-8444-000000000004']::uuid[],true)->>'blocked')::boolean,'50% bloqueados');
select pg_temp.assert_true((select count(*)=4 from public.fin_companies where deleted_at is null),'simulação não remove');
select public.fin_archive('edd1a500-0000-4000-8000-000000000001','companies',array['44444444-4444-4444-8444-000000000004']::uuid[],false);
select pg_temp.assert_true((select count(*)=3 from public.fin_companies where deleted_at is null),'25% arquivados');
commit;
begin;
select auth.test_login('22222222-2222-4222-8222-222222222222');
select pg_temp.assert_true((select count(*)=1 from public.fin_bank_accounts),'leitor vê conta do grupo');
select pg_temp.assert_true((select count(*)=1 from public.fin_tenants),'outro grupo fica invisível');
select pg_temp.assert_true((select count(*)=0 from public.fin_audit_log),'auditoria não liberada');
do $$ begin
 begin
  perform public.fin_save_company('edd1a500-0000-4000-8000-000000000001',gen_random_uuid(),'Proibida');
  raise exception 'leitor não grava';
 exception when insufficient_privilege then null; end;
 begin
  perform public.fin_members('edd1a500-0000-4000-8000-000000000001');
  raise exception 'leitor não lista membros';
 exception when insufficient_privilege then null; end;
end $$;
commit;
begin;
select auth.test_login('33333333-3333-4333-8333-333333333333');
select pg_temp.assert_true((select count(*)=0 from public.fin_bank_accounts),'grupo B não lê conta A');
do $$ begin
 begin
  perform public.fin_save_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',gen_random_uuid(),
   '{"company_id":"44444444-4444-4444-8444-000000000001","name":"Proibida","bank_name":"Banco","account_number":"1","kind":"corrente","currency":"BRL"}');
  raise exception 'não pode vincular empresa de outro grupo';
 exception when sqlstate '22023' then null; end;
end $$;
commit;
begin;
set local role anon;
do $$ begin
 begin perform public.fin_my_workspaces(); raise exception 'anon não executa RPC';
 exception when insufficient_privilege then null; end;
 begin perform count(*) from public.fin_bank_accounts; raise exception 'anon não lê';
 exception when insufficient_privilege then null; end;
end $$;
commit;
select pg_temp.assert_true(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname like 'fin_%' and c.relkind='r' and not c.relrowsecurity),'RLS em todas as tabelas');
select pg_temp.assert_true((select count(*)>0 from public.fin_audit_log),'histórico registrado');
do $$ begin
 begin update public.fin_audit_log set action='esconder';
 raise exception 'histórico não pode ser reescrito'; exception when insufficient_privilege then null; end;
end $$;
select 'Permissões, isolamento, cadastros, concorrência, dry-run e auditoria: OK' as resultado;
