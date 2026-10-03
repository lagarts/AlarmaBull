-- ============================================================
-- 00_mock_supabase.sql
-- Réplica mínima del entorno Supabase para validar migraciones
-- y políticas RLS en un PostgreSQL local (no usar en producción).
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email varchar(255) unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Réplica de auth.uid() de Supabase (lee el JWT del request).
create or replace function auth.uid()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(current_setting('request.jwt.claims', true), '') = '' then null
    else nullif((current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')::uuid
  end
$$;

grant usage on schema auth to anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase: permisos amplios por defecto; RLS es la barrera real.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to authenticated;
