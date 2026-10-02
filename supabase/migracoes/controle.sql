-- Controle das migrations aplicadas pelo supabase/aplicar-migracoes.sh. Não é migration: o aplicador roda
-- este arquivo (idempotente) antes de aplicar qualquer coisa. Fica no schema financeiro_admin, que o PostgREST
-- não expõe (o Supabase só expõe o que está em Settings > API > Exposed schemas: public e graphql_public)
-- e que ninguém além do dono (postgres) enxerga: nem anon, nem authenticated, nem service_role.
create schema if not exists financeiro_admin;

create table if not exists financeiro_admin.migracoes (
  arquivo text primary key check (arquivo ~ '^[0-9]{14}_[a-z0-9_]+\.sql$'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  aplicado_em timestamptz not null default now(),
  commit text not null,
  -- aplicada: rodou pela primeira vez; reaplicada: rodou na primeira execução do aplicador num banco que já
  -- tinha o schema (aplicado à mão), e o aplicador provou na mesma transação que nenhuma linha mudou.
  modo text not null check (modo in ('aplicada', 'reaplicada')),
  aplicado_por text not null default current_user
);
alter table financeiro_admin.migracoes enable row level security;

-- reaplicar_verificando_ate: gravado na primeira execução num banco que já tinha o schema (aplicado à mão).
-- Todo arquivo com nome até ele é reaplicado provando que nenhuma linha de public mudou — mesmo que a
-- primeira execução pare no meio e o resto entre numa execução seguinte.
create table if not exists financeiro_admin.parametros (
  chave text primary key,
  valor text not null,
  definido_em timestamptz not null default now()
);
alter table financeiro_admin.parametros enable row level security;

-- Impressão digital dos dados de public: contagem e hash de cada linha de cada tabela. Usada só na primeira
-- execução num banco existente, antes e depois de cada arquivo, para provar que reaplicar não mudou dado.
-- Nenhuma tabela fica de fora em silêncio: sem permissão de leitura dá erro, e row_security = off faz a
-- consulta falhar (em vez de ver só parte das linhas) se a RLS valesse para quem aplica. Erro aqui desfaz
-- o arquivo e para o aplicador, como o pg_dump do backup faria no mesmo caso.
create or replace function financeiro_admin.impressao_dados() returns text
language plpgsql stable set search_path = '' set row_security = off as $$
declare
  r record;
  parte text;
  acumulado text := '';
begin
  for r in
    select c.oid::regclass as tabela
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname
  loop
    execute pg_catalog.format(
      'select count(*)::text || '':'' || coalesce(pg_catalog.md5(pg_catalog.string_agg(h, '''' order by h)), '''') '
      'from (select pg_catalog.md5(x::text) as h from %s x) linhas', r.tabela) into parte;
    acumulado := acumulado || r.tabela::text || '=' || parte || ';';
  end loop;
  return pg_catalog.md5(acumulado);
end $$;

revoke all on schema financeiro_admin from public;
revoke all on all tables in schema financeiro_admin from public;
revoke all on all functions in schema financeiro_admin from public;
do $$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = papel) then
      execute format('revoke all on schema financeiro_admin from %I', papel);
      execute format('revoke all on all tables in schema financeiro_admin from %I', papel);
      execute format('revoke all on all functions in schema financeiro_admin from %I', papel);
    end if;
  end loop;
end $$;
