// Casos da trava de migrations. Roda com `node --test supabase/migracoes/` (pnpm db:test:migracoes).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analisar } from './trava.mjs'

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))
const regras = (sql) => analisar(sql).destrutivas.map((a) => a.regra)
const passa = (sql) => {
  const r = analisar(sql)
  assert.equal(r.recusado, false, `devia passar: ${sql}\n${JSON.stringify(r, null, 1)}`)
  assert.equal(r.destrutivas.length, 0, `não devia achar destrutiva: ${sql}\n${JSON.stringify(r.destrutivas)}`)
}
const destrutiva = (sql, regra) => {
  const r = analisar(sql)
  assert.equal(r.recusado, true, `devia recusar: ${sql}`)
  assert.equal(r.estruturais.length, 0, `não é estrutural: ${sql}\n${JSON.stringify(r.estruturais)}`)
  assert.ok(r.destrutivas.some((a) => a.regra.startsWith(regra)), `esperava ${regra} em: ${sql}\nachou ${JSON.stringify(regras(sql))}`)
}
const estrutural = (sql, trecho) => {
  const r = analisar(sql)
  assert.equal(r.recusado, true, `devia recusar: ${sql}`)
  assert.ok(r.estruturais.some((a) => a.regra.includes(trecho)), `esperava "${trecho}" em: ${sql}\nachou ${JSON.stringify(r.estruturais)}`)
}

test('todas as migrations do repositório passam (destrutiva só com aprovação)', () => {
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql'))) {
    const r = analisar(readFileSync(join(MIGRATIONS, f), 'utf8'))
    assert.equal(r.recusado, false, `${f}: ${JSON.stringify(r)}`)
    if (r.destrutivas.length) assert.ok(r.aprovacao, `${f}: destrutiva sem aprovação`)
  }
  // as de hoje não têm destrutiva nenhuma
  for (const f of readdirSync(MIGRATIONS).filter((n) => /^2026092[16]/.test(n))) {
    assert.equal(analisar(readFileSync(join(MIGRATIONS, f), 'utf8')).destrutivas.length, 0, f)
  }
})

test('comentário e string não contam', () => {
  passa('-- delete from public.t; drop table public.t\nselect 1;')
  passa('/* truncate t; /* aninhado: update t set a = 1 */ drop table t; */ select 1;')
  passa("insert into public.notas (texto) values ('delete from t'), (E'it\\'s update t set a = 1; drop table t');")
  passa("comment on table public.t is 'nunca rode truncate aqui';")
})

test('corpo de função criada e não chamada não conta', () => {
  passa('create or replace function public.f() returns void language plpgsql as $$\nbegin\n  delete from public.t;\n  update public.t set a = 1;\n  truncate public.t;\n  drop table public.u;\nend $$;')
  passa("create function public.g() returns void language sql as 'delete from public.t';")
  passa('create function public.h() returns void language plpgsql as $corpo$ begin execute $q$ drop table x $q$; end $corpo$;')
  // corpo SQL padrão: o END final não é COMMIT e o ';' de dentro não parte o comando
  passa('create function public.a() returns int language sql begin atomic update public.t set a = case when a > 0 then 1 else 2 end; select 1; end;\nselect 2;')
})

test('palavras destrutivas em contexto que não apaga nem sobrescreve', () => {
  passa('create trigger x before update or delete on public.t for each row execute function public.f();')
  passa('create trigger y after truncate on public.t for each statement execute function public.f();')
  passa('grant select, insert, update, delete, truncate on public.t to authenticated;')
  passa('revoke truncate, update (a) on public.t from anon;')
  passa('create policy p on public.t for update to authenticated using (true);')
  passa('create policy q on public.t for delete using (tenant_id = (select public.current_tenant_id()));')
  passa('alter table public.t add constraint fk foreign key (a) references public.u(id) on delete cascade on update cascade;')
  passa('select * from public.t for update;')
  passa('select * from public.t for no key update of t skip locked;')
  passa('alter table public.t drop constraint if exists c, add constraint c check (a > 0);')
  passa('alter table public.t alter column c drop default, alter column c drop not null, alter column d drop identity if exists;')
  passa('drop policy if exists p on public.t; drop trigger if exists x on public.t; drop function if exists public.f(int); drop index if exists public.i; drop view if exists public.v;')
  passa('alter table public.t add column if not exists c int, add column if not exists "update" text;')
  passa('create table if not exists public.t (type text, "delete" text, id uuid references auth.users(id) on delete cascade);')
  passa('insert into public.t (a) values (1) on conflict do nothing;')
  passa('insert into public.stages (tenant_id, codigo) select t.id, $$final$$ from public.tenants t where not exists (select 1 from public.stages s where s.tenant_id = t.id);')
  passa("do $$ begin create type public.x as enum ('a'); exception when duplicate_object then null; end $$;")
  passa("do $$ declare t text; begin foreach t in array array['a','b'] loop execute format('create policy %1$s_sel on public.%1$I for select using (tenant_id = (select public.current_tenant_id()))', t); execute format('drop trigger if exists %1$s_upd on public.%1$I', t); execute format('create trigger %1$s_upd before update on public.%1$I for each row execute function public.set_updated_at()', t); end loop; end $$;")
  passa('select set_config($$financeiro.x$$, $$1$$, true), now(), format($$%s$$, 1);')
  passa('select $1, $2::int;')
})

test('DROP TABLE, SCHEMA, OWNED, CASCADE e ATTRIBUTE', () => {
  destrutiva('drop table public.t;', 'DROP TABLE')
  destrutiva('drop table if exists public.t, public.u;', 'DROP TABLE')
  destrutiva('drop foreign table x;', 'DROP TABLE')
  destrutiva('drop schema velho cascade;', 'DROP SCHEMA')
  destrutiva('drop owned by alguem;', 'DROP OWNED')
  destrutiva('drop type public.status cascade;', 'DROP … CASCADE')
  destrutiva('drop function public.f() cascade;', 'DROP … CASCADE')
  destrutiva('alter type public.endereco drop attribute cep;', 'DROP ATTRIBUTE')
})

test('ALTER TABLE: DROP COLUMN, ALTER COLUMN TYPE e RENAME', () => {
  destrutiva('alter table public.t drop column c;', 'DROP COLUMN')
  destrutiva('alter table public.t drop c;', 'DROP COLUMN')
  destrutiva('alter table if exists only public.t drop if exists c;', 'DROP COLUMN')
  destrutiva('alter table public.t add column x int, drop column y;', 'DROP COLUMN')
  destrutiva('alter table public.t alter column c type bigint;', 'ALTER COLUMN … TYPE')
  destrutiva('alter table public.t alter c type numeric(14,4) using c::numeric;', 'ALTER COLUMN … TYPE')
  destrutiva('alter table public.t alter column c set data type text;', 'ALTER COLUMN … TYPE')
  destrutiva('alter table public.t rename to u;', 'RENAME')
  destrutiva('alter table public.t rename column a to b;', 'RENAME')
  destrutiva('alter function public.f() rename to g;', 'RENAME')
  destrutiva("alter type public.status rename value 'a' to 'b';", 'RENAME')
})

test('TRUNCATE, DELETE, UPDATE, upsert e MERGE', () => {
  destrutiva('truncate public.t;', 'TRUNCATE')
  destrutiva('truncate table only public.t, public.u restart identity cascade;', 'TRUNCATE')
  destrutiva('delete from public.t where a = 1;', 'DELETE')
  destrutiva('with apagados as (delete from public.t returning *) select count(*) from apagados;', 'DELETE')
  destrutiva('update public.t set a = 1;', 'UPDATE')
  destrutiva('update only public.t as q set a = 1 where q.b;', 'UPDATE')
  destrutiva('update "Tabela" set a = 1;', 'UPDATE')
  destrutiva('update t x set a = 1;', 'UPDATE')
  destrutiva('insert into public.t (id, a) values (1, 2) on conflict (id) do update set a = excluded.a;', 'INSERT … ON CONFLICT DO UPDATE')
  destrutiva('merge into public.t using public.s on t.id = s.id when matched then delete;', 'DELETE')
  destrutiva('merge into public.t using public.s on t.id = s.id when matched then update set a = s.a when not matched then insert values (s.id);', 'UPDATE (MERGE)')
})

test('DO executa na hora: corpo e SQL dinâmico contam', () => {
  destrutiva('do $$ begin delete from public.t; end $$;', 'DELETE')
  destrutiva('do $$ begin if true then update public.t set a = 1; end if; end $$;', 'UPDATE')
  destrutiva("do $x$ begin execute 'drop table ' || 'public.t'; end $x$;", 'DROP')
  destrutiva("do $$ begin execute format('delete from public.%I', 't'); end $$;", 'DELETE')
  destrutiva("do $$ begin execute 'update ' || 't' || ' set a = 1'; end $$;", 'UPDATE')
  destrutiva("do 'begin truncate public.t; end';", 'TRUNCATE')
  destrutiva('do $$ begin perform public.limpar_tudo(); end $$;', 'chama public.limpar_tudo()')
  destrutiva('do $$ begin alter table public.t drop column c; end $$;', 'DROP COLUMN')
  destrutiva('do $$ begin if true then drop type public.x cascade; end if; end $$;', 'DROP … CASCADE')
  destrutiva("do $$ begin execute 'alter table public.t alter column c type int'; end $$;", 'ALTER COLUMN … TYPE')
  passa('do $$ begin if not exists (select 1 from pg_type where typname = $q$x$q$) then create type public.x as enum ($q$a$q$); end if; end $$;')
})

test('função criada e chamada no mesmo arquivo: o corpo conta', () => {
  destrutiva('create function public.limpa() returns void language sql as $$ delete from public.t $$;\nselect public.limpa();', 'DELETE')
  destrutiva('create or replace function limpa() returns void language plpgsql as $$ begin update public.t set a = 0; end $$;\ndo $$ begin perform limpa(); end $$;', 'UPDATE')
  destrutiva('create procedure public.p() language sql as $$ truncate public.t $$;\ncall public.p();', 'TRUNCATE')
  passa('create function public.soma(a int) returns int language sql as $$ select a + 1 $$;\nselect public.soma(1);')
})

test('chamada que a trava não enxerga pede aprovação', () => {
  destrutiva('call public.arrumar();', 'CALL de procedimento')
  destrutiva('select public.funcao_existente();', 'chama public.funcao_existente()')
  destrutiva('insert into public.log (x) select public.gerar();', 'chama public.gerar()')
  passa('insert into public.t (a, b) values (1, 2);')
})

test('chamada sem schema a função que existe em public (o search_path resolve para public)', () => {
  const noBanco = { funcoesPublic: new Set(['limpar_exemplo', 'recalcular']) }
  const recusa = (sql, regra) => {
    const r = analisar(sql, noBanco)
    assert.equal(r.recusado, true, `devia recusar: ${sql}`)
    assert.ok(r.destrutivas.some((a) => a.regra.startsWith(regra)), `esperava ${regra}: ${JSON.stringify(r.destrutivas)}`)
  }
  recusa('select limpar_exemplo();', 'chama limpar_exemplo() sem schema')
  recusa('SELECT * FROM Limpar_Exemplo();', 'chama limpar_exemplo() sem schema')
  recusa('do $$ begin perform recalcular(); end $$;', 'chama recalcular() sem schema')
  recusa('with x as (select recalcular()) select 1;', 'chama recalcular() sem schema')
  // sem schema e fora de public é função do sistema; criada no próprio arquivo, o corpo é lido
  assert.equal(analisar('select now(), format($$%s$$, 1), coalesce(null, 1);', noBanco).recusado, false)
  assert.equal(analisar('create or replace function recalcular() returns int language sql as $$ select 1 $$;\nselect recalcular();', noBanco).recusado, false)
  // DDL que só guarda a chamada para depois não executa
  assert.equal(analisar('create policy p on public.t for select using (recalcular() > 0);', noBanco).recusado, false)
})

test('DDL que executa na hora: ALTER TABLE (DEFAULT, CHECK) e CREATE TABLE/MATERIALIZED VIEW … AS', () => {
  destrutiva('alter table public.t add column c int default public.limpar();', 'chama public.limpar()')
  destrutiva('alter table public.t add constraint k check (public.limpar(a));', 'chama public.limpar()')
  destrutiva('create table public.x as select public.limpar();', 'chama public.limpar()')
  destrutiva('create materialized view public.mv as (select public.limpar());', 'chama public.limpar()')
  destrutiva('create function public.l() returns int language sql as $$ delete from public.t returning 1 $$;\nalter table public.u add column c int default public.l();', 'DELETE')
  passa('create table if not exists public.t (id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id), n numeric(14,4) check (n >= 0));')
  passa('create table public.g (a int, b int generated always as (a * 2) stored);')
  passa('alter table public.t add column if not exists c numeric(14,4) not null default 0 check (c >= 0);')
  passa('create index if not exists i on public.t (lower(nome));')
})

test('sequência: setval, RESTART e DROP SEQUENCE; SET SCHEMA', () => {
  destrutiva("select setval('public.stock_moves_id_seq', 1, false);", 'setval()')
  destrutiva("select pg_catalog.setval('public.s', 1);", 'setval()')
  destrutiva("do $$ begin perform setval('public.s', 1); end $$;", 'setval()')
  destrutiva('alter sequence public.s restart with 1;', 'RESTART')
  destrutiva('alter table public.stock_moves alter column id restart with 1;', 'RESTART')
  destrutiva('drop sequence if exists public.s;', 'DROP SEQUENCE')
  destrutiva('alter table public.t set schema lixo;', 'SET SCHEMA')
  destrutiva('alter function public.f() set schema lixo;', 'SET SCHEMA')
  passa("select nextval('public.s'), currval('public.s');")
  passa("create or replace function public.f() returns void language plpgsql set search_path = '' as $$ begin null; end $$;")
  passa('alter default privileges in schema public grant select on tables to authenticated;')
})

test('corpo SQL padrão (BEGIN ATOMIC) chamado no mesmo arquivo conta', () => {
  destrutiva('create function public.z() returns void language sql begin atomic delete from public.t; end;\nselect public.z();', 'DELETE')
  destrutiva('create function z() returns int language sql begin atomic update public.t set a = 1; select 1; end;\ndo $$ begin perform z(); end $$;', 'UPDATE')
  passa('create function public.z() returns int language sql begin atomic select 1; end;\nselect public.z();')
})

test('estruturais: transação própria, CONCURRENTLY e meta-comando do psql', () => {
  estrutural('begin;\ncreate table public.t (a int);\ncommit;', 'controle de transação')
  estrutural('start transaction; select 1;', 'controle de transação')
  estrutural('select 1; rollback;', 'controle de transação')
  estrutural('savepoint a;', 'controle de transação')
  estrutural('end;', 'controle de transação')
  estrutural('create index concurrently i on public.t (a);', 'CONCURRENTLY')
  estrutural('drop index concurrently if exists public.i;', 'CONCURRENTLY')
  estrutural("do $$ begin execute 'create index concurrently i on public.t (a)'; end $$;", 'CONCURRENTLY')
  estrutural('do $$ begin insert into public.t values (1); commit; end $$;', 'controle de transação dentro de bloco DO')
  estrutural('\\i outro.sql\nselect 1;', 'meta-comando')
  estrutural('select 1;\n\\set ON_ERROR_STOP off\nselect 2;', 'meta-comando')
  estrutural("select 'sem fim;", 'não consegui ler')
  estrutural('select $$ sem fim;', 'não consegui ler')
  estrutural("do $$ begin raise notice 'sem fim; delete from public.t; end $$;", 'não consegui ler o corpo')
  passa("do $$ begin raise notice '%', 'texto com '' aspas'; end $$;")
})

test('linha de aprovação libera destrutiva, mas nunca a estrutural', () => {
  const ok = analisar('-- financeiro:destrutiva-aprovada: coluna sem uso desde 2026-09, com o fundador\nalter table public.t drop column c;')
  assert.equal(ok.recusado, false)
  assert.equal(ok.aprovacao, 'coluna sem uso desde 2026-09, com o fundador')
  assert.deepEqual(ok.destrutivas.map((a) => a.regra), ['DROP COLUMN'])
  estrutural('-- financeiro:destrutiva-aprovada: tanto faz\ncommit;', 'controle de transação')
  estrutural('-- financeiro:destrutiva-aprovada:   \ndelete from public.t;', 'sem motivo')
  // dentro de corpo de função ou de comentário de bloco não é aprovação
  destrutiva('create function public.f() returns void language sql as $$\n-- financeiro:destrutiva-aprovada: x\nselect 1 $$;\ndrop table public.t;', 'DROP TABLE')
  destrutiva('/* -- financeiro:destrutiva-aprovada: x */ drop table public.t;', 'DROP TABLE')
})

test('CRLF e BOM não mudam o resultado', () => {
  destrutiva('﻿select 1;\r\ndelete from public.t;\r\n', 'DELETE')
  const r = analisar('-- financeiro:destrutiva-aprovada: motivo\r\ndrop table public.t;\r\n')
  assert.equal(r.aprovacao, 'motivo')
  assert.equal(r.recusado, false)
  assert.equal(analisar('select 1;\r\n\r\ndelete from public.t;').destrutivas[0].linha, 3)
})
