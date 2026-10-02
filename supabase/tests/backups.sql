\set ON_ERROR_STOP on
create or replace function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'TESTE: %',msg; end if; end $$;
begin;
set local role authenticated;
do $$ begin
 begin perform public.fin_backup_revision('edd1a500-0000-4000-8000-000000000001');
 raise exception 'authenticated não deve executar backup privilegiado'; exception when insufficient_privilege then null; end;
end $$;
commit;
begin;
set local role service_role;
do $$
declare tenant uuid := 'edd1a500-0000-4000-8000-000000000001'; payload jsonb; rev text; one uuid; again uuid;
begin
 select jsonb_build_object(
 'fin_tenants',(select jsonb_agg(to_jsonb(t)) from public.fin_tenants t where id=tenant),
 'fin_memberships',(select jsonb_agg(to_jsonb(t)) from public.fin_memberships t where tenant_id=tenant),
 'fin_companies',(select jsonb_agg(to_jsonb(t)) from public.fin_companies t where tenant_id=tenant),
 'fin_bank_accounts',(select jsonb_agg(to_jsonb(t)) from public.fin_bank_accounts t where tenant_id=tenant),
 'fin_audit_log',(select jsonb_agg(to_jsonb(t)) from public.fin_audit_log t where tenant_id=tenant)) into payload;
 rev := public.fin_backup_revision(tenant);
 one := public.fin_store_backup(tenant,'same',rev,payload);
 again := public.fin_store_backup(tenant,'same',rev,payload);
 perform pg_temp.assert_true(one=again,'repetição idempotente');
 begin perform public.fin_store_backup(tenant,'empty',rev,'{}'); raise exception 'vazio deveria falhar';
 exception when sqlstate '22023' then null; end;
 begin perform public.fin_store_backup(tenant,'stale','0:0',payload); raise exception 'revisão antiga deveria falhar';
 exception when serialization_failure then null; end;
 for i in 1..22 loop
  one := public.fin_store_backup(tenant,'run-'||i,rev,payload);
  perform pg_temp.assert_true(exists(select 1 from public.fin_backups where id=one),'snapshot novo preservado');
 end loop;
 perform pg_temp.assert_true((select count(*)=20 from public.fin_backups where tenant_id=tenant),'retenção de vinte');
 perform pg_temp.assert_true(not exists(select 1 from public.fin_backups where tenant_id=tenant and run_key='same'),'mais antigo removido');
end $$;
commit;
select 'Backups: privilégios, revisão, rejeição de vazio, idempotência e retenção: OK' as resultado;
