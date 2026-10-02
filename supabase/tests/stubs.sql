-- Stubs do ambiente Supabase para rodar migrations e testes num PostgreSQL comum.
-- Reproduz o mínimo do schema auth e os papéis anon / authenticated / service_role.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

-- Supabase concede, por default privileges, ALL em toda tabela/função/sequência nova de public a anon,
-- authenticated e service_role (initial-schema.sql e post-setup.sql). Reproduzido aqui para que o ambiente
-- de teste seja tão hostil quanto a produção: as migrations precisam revogar explicitamente.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  is_anonymous boolean not null default false,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- Colunas do auth.users do Supabase que as RPCs de membros e da plataforma leem (último acesso, e-mail confirmado).
alter table auth.users add column if not exists last_sign_in_at timestamptz;
alter table auth.users add column if not exists email_confirmed_at timestamptz;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', 'anon')
$$;

-- Helper dos testes: assume a identidade de um usuário como o PostgREST faria.
create or replace function auth.test_login(p_user uuid, p_role text default 'authenticated') returns void
language plpgsql as $$
declare
  v_meta jsonb;
begin
  select raw_app_meta_data into v_meta from auth.users where id = p_user;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', p_role, 'app_metadata', coalesce(v_meta, '{}'::jsonb),
    'is_anonymous', coalesce((select u.is_anonymous from auth.users u where u.id = p_user), false))::text, true);
  execute format('set local role %I', p_role);
end $$;

create or replace function auth.test_logout() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end $$;

-- Helper dos testes: login com a verificação em duas etapas feita (claim aal = aal2), como a equipe Prodio precisa.
create or replace function auth.test_login_aal2(p_user uuid) returns void
language plpgsql as $$
begin
  perform auth.test_login(p_user);
  perform set_config('request.jwt.claims', (current_setting('request.jwt.claims')::jsonb || '{"aal":"aal2"}'::jsonb)::text, true);
end $$;
