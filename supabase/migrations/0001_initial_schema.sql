-- ============================================================
-- 0001_initial_schema.sql
-- Alarma Vecinal · Esquema base (identidad, comunidades,
-- suscripciones, alertas, notificaciones, emergencias, auditoría)
-- Todas las fechas se almacenan en UTC (timestamptz).
-- ============================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- Tipos (enums)
-- ------------------------------------------------------------
create type public.app_role as enum ('user', 'admin_general');
create type public.community_role as enum ('admin', 'member');
create type public.membership_status as enum ('pending', 'active', 'left', 'removed');
create type public.community_status as enum ('active', 'archived');
create type public.join_policy as enum ('open', 'approval');
create type public.community_action as enum ('invite_used', 'member_approved', 'member_removed', 'member_left');
create type public.subscription_status as enum ('trial', 'active', 'past_due', 'expired', 'canceled', 'none');
create type public.payment_status as enum ('pending', 'approved', 'rejected', 'refunded', 'canceled');
create type public.alert_status as enum ('active', 'resolved', 'canceled');
create type public.delivery_status as enum ('pending', 'sending', 'sent', 'failed', 'skipped');
create type public.service_type as enum ('police', 'fire', 'ambulance');

-- ------------------------------------------------------------
-- Perfiles
-- ------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) between 2 and 120),
  phone text check (phone is null or phone ~ '^[0-9+() -]{6,20}$'),
  role public.app_role not null default 'user',
  suspended boolean not null default false,
  suspended_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Comunidades
-- ------------------------------------------------------------
create table public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 80),
  join_policy public.join_policy not null default 'open',
  created_by uuid not null references public.profiles (id) on delete restrict,
  status public.community_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.community_members (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.community_role not null default 'member',
  membership_status public.membership_status not null default 'pending',
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, user_id)
);

-- V1: un usuario pertenece como máximo a una comunidad (pendiente o activa).
create unique index community_members_one_active_per_user
  on public.community_members (user_id)
  where membership_status in ('pending', 'active');

create index community_members_community_idx on public.community_members (community_id);
create index community_members_user_idx on public.community_members (user_id);

create table public.community_invites (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz,
  revoked_at timestamptz,
  max_uses int not null default 1 check (max_uses between 1 and 500),
  use_count int not null default 0 check (use_count >= 0),
  created_at timestamptz not null default now()
);

create index community_invites_community_idx on public.community_invites (community_id);

create table public.community_logs (
  id bigint generated always as identity primary key,
  community_id uuid not null references public.communities (id) on delete cascade,
  actor_user_id uuid references public.profiles (id) on delete set null,
  action public.community_action not null,
  target_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index community_logs_community_idx on public.community_logs (community_id, created_at desc);

-- ------------------------------------------------------------
-- Planes y suscripciones (individuales por vecino)
-- ------------------------------------------------------------
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_ars numeric(12, 2) not null default 0 check (price_ars >= 0),
  billing_interval text not null default 'month' check (billing_interval in ('month')),
  trial_days int not null default 7 check (trial_days between 0 and 60),
  features jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  plan_id uuid not null references public.subscription_plans (id) on delete restrict,
  status public.subscription_status not null default 'none',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  provider text not null default 'manual' check (provider in ('manual', 'mercadopago')),
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_subscriptions_status_idx on public.user_subscriptions (status);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  user_subscription_id uuid not null references public.user_subscriptions (id) on delete cascade,
  provider text not null default 'mercadopago',
  provider_payment_id text,
  event_type text not null,
  amount_ars numeric(12, 2),
  currency text not null default 'ARS' check (currency = 'ARS'),
  status public.payment_status not null default 'pending',
  provider_event_id text not null unique,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index payment_events_subscription_idx on public.payment_events (user_subscription_id, created_at desc);

-- ------------------------------------------------------------
-- Alertas
-- ------------------------------------------------------------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  triggered_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  location_latitude double precision check (location_latitude between -90 and 90),
  location_longitude double precision check (location_longitude between -180 and 180),
  status public.alert_status not null default 'active',
  idempotency_key text not null unique,
  resolved_at timestamptz
);

create index alerts_community_created_idx on public.alerts (community_id, created_at desc);
create index alerts_triggered_by_idx on public.alerts (triggered_by);

create table public.alert_recipients (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts (id) on delete cascade,
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  delivery_status public.delivery_status not null default 'pending',
  delivered_at timestamptz,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (alert_id, recipient_user_id)
);

create index alert_recipients_user_idx on public.alert_recipients (recipient_user_id, created_at desc);

-- ------------------------------------------------------------
-- Notificaciones push (una fila por dispositivo)
-- ------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  -- Datos de la suscripción Web Push (p256dh/auth). No son credenciales de la
  -- cuenta: sólo permiten enviar mensajes a este dispositivo.
  subscription_data jsonb not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id)
  where revoked_at is null;

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts (id) on delete cascade,
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  push_subscription_id uuid references public.push_subscriptions (id) on delete set null,
  status public.delivery_status not null default 'pending',
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notification_jobs_pending_idx on public.notification_jobs (status, created_at)
  where status in ('pending', 'failed');

-- ------------------------------------------------------------
-- Contactos de emergencia
-- ------------------------------------------------------------
create table public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  country_code text not null default 'AR' check (char_length(country_code) = 2),
  province text,
  locality text,
  service_type public.service_type not null,
  phone_number text not null check (phone_number ~ '^[0-9+() -]{3,20}$'),
  label text,
  source_url text,
  verified_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Índice único con coalesce: los NULL no son únicos en Postgres.
create unique index emergency_contacts_uniq
  on public.emergency_contacts (country_code, coalesce(province, ''), coalesce(locality, ''), service_type);

-- ------------------------------------------------------------
-- Auditoría y controles
-- ------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) < 2048)
);

create index audit_logs_actor_idx on public.audit_logs (actor_user_id, created_at desc);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);

-- Intentos de registro para límites anti-abuso (hash irreversible, sin PII).
create table public.signup_attempts (
  id bigint generated always as identity primary key,
  email_hash text,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index signup_attempts_email_idx on public.signup_attempts (email_hash, created_at desc);
create index signup_attempts_ip_idx on public.signup_attempts (ip_hash, created_at desc);

-- ------------------------------------------------------------
-- updated_at automático
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger t_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger t_communities_updated_at before update on public.communities
  for each row execute function public.set_updated_at();
create trigger t_community_members_updated_at before update on public.community_members
  for each row execute function public.set_updated_at();
create trigger t_subscription_plans_updated_at before update on public.subscription_plans
  for each row execute function public.set_updated_at();
create trigger t_user_subscriptions_updated_at before update on public.user_subscriptions
  for each row execute function public.set_updated_at();
create trigger t_push_subscriptions_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();
create trigger t_notification_jobs_updated_at before update on public.notification_jobs
  for each row execute function public.set_updated_at();
create trigger t_emergency_contacts_updated_at before update on public.emergency_contacts
  for each row execute function public.set_updated_at();
