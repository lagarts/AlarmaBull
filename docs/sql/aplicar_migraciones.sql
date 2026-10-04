-- ============================================================
-- APLICAR TODO EN UN SOLO PASO (Supabase SQL Editor)
-- Alarma Vecinal - migraciones 0001..0005 concatenadas
-- Subir este archivo completo y presionar Run.
-- ============================================================

-- >>> INICIO 0001_initial_schema.sql

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
-- >>> FIN 0001_initial_schema.sql

-- >>> INICIO 0002_functions.sql

-- ============================================================
-- 0002_functions.sql
-- Funciones del servidor (SECURITY DEFINER).
-- Todas las operaciones sensibles pasan por acá: el cliente nunca
-- modifica estados de pago, roles ni membresías directamente.
-- ============================================================

-- ------------------------------------------------------------
-- Utilidades de acceso
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.profiles
     where id = auth.uid()
       and role = 'admin_general'
       and suspended = false
  );
$$;

create or replace function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Permisos insuficientes';
  end if;
end;
$$;

-- Elegibilidad comercial: ¿puede usar las funciones pagas?
create or replace function public.is_entitled(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce((
    select case
      when s.status = 'active'
        and (s.current_period_end is null or s.current_period_end > now())
        then true
      when s.status = 'trial'
        and s.trial_ends_at is not null
        and s.trial_ends_at > now()
        then true
      when s.status = 'canceled'
        and s.current_period_end is not null
        and s.current_period_end > now()
        then true
      else false
    end
      from public.user_subscriptions s
     where s.user_id = p_user_id
  ), false);
$$;

create or replace function public.get_my_subscription()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'subscription_id', s.id,
    'status', case
      when s.status = 'trial' and s.trial_ends_at is not null and s.trial_ends_at <= now() then 'expired'
      when s.status = 'active' and s.current_period_end is not null and s.current_period_end <= now() then 'expired'
      else s.status
    end,
    'raw_status', s.status,
    'trial_started_at', s.trial_started_at,
    'trial_ends_at', s.trial_ends_at,
    'trial_days_left', case
      when s.trial_ends_at is null then null
      else greatest(0, ceil(extract(epoch from (s.trial_ends_at - now())) / 86400))::int
    end,
    'current_period_start', s.current_period_start,
    'current_period_end', s.current_period_end,
    'cancel_at_period_end', s.cancel_at_period_end,
    'provider', s.provider,
    'plan', jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'price_ars', p.price_ars,
      'trial_days', p.trial_days,
      'features', p.features
    ),
    'entitled', public.is_entitled(auth.uid())
  )
  from public.user_subscriptions s
  join public.subscription_plans p on p.id = s.plan_id
  where s.user_id = auth.uid();
$$;

-- Mantenimiento: vence pruebas y períodos pagos no renovados.
create or replace function public.refresh_subscription_states()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer := 0;
  v_aux integer := 0;
begin
  update public.user_subscriptions
     set status = 'expired', updated_at = now()
   where status = 'trial'
     and trial_ends_at is not null
     and trial_ends_at <= now();
  get diagnostics v_count = row_count;

  update public.user_subscriptions
     set status = case when cancel_at_period_end then 'canceled' else 'past_due' end,
         updated_at = now()
   where status = 'active'
     and current_period_end is not null
     and current_period_end <= now();
  get diagnostics v_aux = row_count;

  return v_count + v_aux;
end;
$$;

-- ------------------------------------------------------------
-- Alta de usuario: perfil + prueba (7 días) calculada en el servidor
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_plan_id uuid;
  v_trial_days integer;
  v_name text;
begin
  v_name := nullif(
    case
      when char_length(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''))) >= 2
        then btrim(new.raw_user_meta_data ->> 'full_name')
    end,
    ''
  );

  insert into public.profiles (id, full_name)
  values (new.id, v_name);

  select id, trial_days
    into v_plan_id, v_trial_days
    from public.subscription_plans
   where active = true
   order by created_at
   limit 1;

  if v_plan_id is not null then
    insert into public.user_subscriptions
      (user_id, plan_id, status, trial_started_at, trial_ends_at)
    values
      (new.id, v_plan_id, 'trial', now(), now() + make_interval(days => v_trial_days));
  end if;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (new.id, 'auth.signup', 'user', new.id::text,
          jsonb_build_object('trial_days', coalesce(v_trial_days, 0)));

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- Guardas de profiles: nadie se autoasigna rol ni se autolevanta la suspensión
-- ------------------------------------------------------------
create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- Escrituras del servidor (service role / postgres): auth.uid() es null.
  if auth.uid() is null then
    return new;
  end if;

  if new.id <> auth.uid() and not public.is_admin() then
    raise exception 'No autorizado a modificar este perfil';
  end if;

  if new.id = auth.uid() then
    if new.role is distinct from old.role
       or new.suspended is distinct from old.suspended
       or new.suspended_reason is distinct from old.suspended_reason
       or new.created_at is distinct from old.created_at then
      raise exception 'No podés modificar tu rol ni el estado de tu cuenta';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists t_profiles_guard on public.profiles;
create trigger t_profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- ------------------------------------------------------------
-- Perfil
-- ------------------------------------------------------------
create or replace function public.update_own_profile(p_full_name text, p_phone text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Nombre inválido';
  end if;

  if v_phone is not null and v_phone !~ '^[0-9+() -]{6,20}$' then
    raise exception 'Teléfono inválido';
  end if;

  update public.profiles
     set full_name = v_name, phone = v_phone
   where id = auth.uid();

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id)
  values (auth.uid(), 'profile.update', 'profile', auth.uid()::text);
end;
$$;

-- ------------------------------------------------------------
-- Comunidades
-- ------------------------------------------------------------
create or replace function public.create_community(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if v_name is null or char_length(v_name) < 3 or char_length(v_name) > 80 then
    raise exception 'El nombre debe tener entre 3 y 80 caracteres';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid() and suspended) then
    raise exception 'Cuenta suspendida';
  end if;

  if not public.is_entitled(auth.uid()) then
    raise exception 'Se requiere una suscripción vigente para crear una comunidad';
  end if;

  if exists (
    select 1 from public.community_members
     where user_id = auth.uid() and membership_status in ('pending', 'active')
  ) then
    raise exception 'Ya pertenecés a una comunidad';
  end if;

  insert into public.communities (name, created_by)
  values (v_name, auth.uid())
  returning id into v_id;

  insert into public.community_members (community_id, user_id, role, membership_status)
  values (v_id, auth.uid(), 'admin', 'active');

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'community.create', 'community', v_id::text,
          jsonb_build_object('name', v_name));

  return v_id;
end;
$$;

create or replace function public.get_my_community()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'community_id', c.id,
    'name', c.name,
    'status', c.status,
    'join_policy', c.join_policy,
    'created_at', c.created_at,
    'created_by', c.created_by,
    'member_count', (
      select count(*) from public.community_members m2
       where m2.community_id = c.id and m2.membership_status = 'active'
    ),
    'pending_count', (
      select count(*) from public.community_members m2
       where m2.community_id = c.id and m2.membership_status = 'pending'
    ),
    'my_member_id', m.id,
    'my_role', m.role,
    'my_status', m.membership_status
  )
  from public.community_members m
  join public.communities c on c.id = m.community_id
  where m.user_id = auth.uid()
    and m.membership_status in ('pending', 'active')
  limit 1;
$$;

create or replace function public.generate_invite(
  p_community_id uuid,
  p_ttl_seconds integer default 604800,
  p_max_uses integer default 25
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if not exists (
    select 1 from public.community_members
     where community_id = p_community_id
       and user_id = auth.uid()
       and role = 'admin'
       and membership_status = 'active'
  ) then
    raise exception 'Sólo el administrador de la comunidad puede generar invitaciones';
  end if;

  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 2592000 then
    raise exception 'Duración inválida';
  end if;

  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 500 then
    raise exception 'Usos máximos inválido';
  end if;

  -- 256 bits de entropía; nunca se guarda el token en claro.
  v_token := gen_random_uuid()::text || gen_random_uuid()::text;
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.community_invites (community_id, token_hash, created_by, expires_at, max_uses)
  values (p_community_id, v_hash, auth.uid(), now() + make_interval(secs => p_ttl_seconds), p_max_uses);

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'invite.create', 'community', p_community_id::text,
          jsonb_build_object('ttl_seconds', p_ttl_seconds, 'max_uses', p_max_uses));

  return v_token;
end;
$$;

create or replace function public.revoke_invites(p_community_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if not exists (
    select 1 from public.community_members
     where community_id = p_community_id and user_id = auth.uid()
       and role = 'admin' and membership_status = 'active'
  ) then
    raise exception 'Sólo el administrador puede revocar invitaciones';
  end if;

  update public.community_invites
     set revoked_at = now()
   where community_id = p_community_id
     and revoked_at is null;
  get diagnostics v_count = row_count;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'invite.revoke', 'community', p_community_id::text,
          jsonb_build_object('revoked', v_count));

  return v_count;
end;
$$;

create or replace function public.join_community(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invite public.community_invites%rowtype;
  v_status public.membership_status;
  v_member_id uuid;
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if p_token is null or char_length(btrim(p_token)) < 32 then
    raise exception 'Código de invitación inválido';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid() and suspended) then
    raise exception 'Cuenta suspendida';
  end if;

  if not public.is_entitled(auth.uid()) then
    raise exception 'Se requiere una suscripción vigente para unirse a una comunidad';
  end if;

  if exists (
    select 1 from public.community_members
     where user_id = auth.uid() and membership_status in ('pending', 'active')
  ) then
    raise exception 'Ya pertenecés a una comunidad';
  end if;

  v_hash := encode(extensions.digest(btrim(p_token), 'sha256'), 'hex');

  select * into v_invite
    from public.community_invites
   where token_hash = v_hash
   for update;

  if not found then
    raise exception 'Código de invitación inválido';
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'La invitación fue revocada';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'La invitación expiró';
  end if;

  if v_invite.use_count >= v_invite.max_uses then
    raise exception 'La invitación ya alcanzó su máximo de usos';
  end if;

  if not exists (
    select 1 from public.communities
     where id = v_invite.community_id and status = 'active'
  ) then
    raise exception 'La comunidad no está activa';
  end if;

  select case when join_policy = 'approval' then 'pending' else 'active' end
    into v_status
    from public.communities
   where id = v_invite.community_id;

  if exists (
    select 1 from public.community_members
     where community_id = v_invite.community_id and user_id = auth.uid()
  ) then
    update public.community_members
       set membership_status = v_status,
           role = 'member',
           joined_at = now()
     where community_id = v_invite.community_id
       and user_id = auth.uid()
    returning id into v_member_id;
  else
    insert into public.community_members (community_id, user_id, role, membership_status)
    values (v_invite.community_id, auth.uid(), 'member', v_status)
    returning id into v_member_id;
  end if;

  update public.community_invites
     set use_count = use_count + 1
   where id = v_invite.id;

  insert into public.community_logs (community_id, actor_user_id, action, target_user_id)
  values (v_invite.community_id, auth.uid(), 'invite_used', auth.uid());

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'community.join', 'community', v_invite.community_id::text,
          jsonb_build_object('membership_status', v_status));

  return v_invite.community_id;
end;
$$;

create or replace function public.approve_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_community_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select community_id into v_community_id
    from public.community_members
   where id = p_member_id;

  if v_community_id is null then
    raise exception 'Integrante no encontrado';
  end if;

  if not exists (
    select 1 from public.community_members
     where community_id = v_community_id and user_id = auth.uid()
       and role = 'admin' and membership_status = 'active'
  ) then
    raise exception 'Sólo el administrador puede aprobar integrantes';
  end if;

  update public.community_members
     set membership_status = 'active'
   where id = p_member_id
     and membership_status = 'pending';

  insert into public.community_logs (community_id, actor_user_id, action, target_user_id)
  values (v_community_id, auth.uid(), 'member_approved',
          (select user_id from public.community_members where id = p_member_id));
end;
$$;

create or replace function public.remove_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_community_id uuid;
  v_target_user uuid;
  v_target_role public.community_role;
  v_active_admins integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select community_id, user_id, role
    into v_community_id, v_target_user, v_target_role
    from public.community_members
   where id = p_member_id;

  if v_community_id is null then
    raise exception 'Integrante no encontrado';
  end if;

  if not exists (
    select 1 from public.community_members
     where community_id = v_community_id and user_id = auth.uid()
       and role = 'admin' and membership_status = 'active'
  ) and v_target_user <> auth.uid() then
    raise exception 'No autorizado para quitar integrantes';
  end if;

  if v_target_role = 'admin' then
    select count(*) into v_active_admins
      from public.community_members
     where community_id = v_community_id
       and role = 'admin'
       and membership_status = 'active';

    if v_active_admins <= 1 then
      raise exception 'No se puede quitar al único administrador de la comunidad';
    end if;
  end if;

  update public.community_members
     set membership_status = case when user_id = auth.uid() then 'left' else 'removed' end
   where id = p_member_id;

  insert into public.community_logs (community_id, actor_user_id, action, target_user_id)
  values (v_community_id, auth.uid(),
          case when v_target_user = auth.uid() then 'member_left' else 'member_removed' end,
          v_target_user);

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(),
          case when v_target_user = auth.uid() then 'community.leave' else 'member.remove' end,
          'community', v_community_id::text,
          jsonb_build_object('target_user_id', v_target_user));
end;
$$;

-- ------------------------------------------------------------
-- Alarma (registro idempotente + destinatarios autorizados)
-- ------------------------------------------------------------
create or replace function public.trigger_alert(
  p_community_id uuid,
  p_idempotency_key text,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_alert_id uuid;
  v_duplicate boolean := false;
  v_recipients integer := 0;
  v_last timestamptz;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    raise exception 'Clave de idempotencia inválida';
  end if;

  -- Reintento / doble clic con la misma clave: devolvemos la alerta existente.
  select id into v_alert_id
    from public.alerts
   where idempotency_key = p_idempotency_key;

  if v_alert_id is not null then
    v_duplicate := true;
  else
    if exists (select 1 from public.profiles where id = auth.uid() and suspended) then
      raise exception 'Cuenta suspendida';
    end if;

    if not public.is_entitled(auth.uid()) then
      raise exception 'Suscripción vencida: renová tu plan para activar alertas';
    end if;

    if not exists (
      select 1 from public.community_members m
        join public.communities c on c.id = m.community_id
       where m.community_id = p_community_id
         and m.user_id = auth.uid()
         and m.membership_status = 'active'
         and c.status = 'active'
    ) then
      raise exception 'No sos integrante activo de esta comunidad';
    end if;

    select max(created_at) into v_last
      from public.alerts
     where community_id = p_community_id
       and triggered_by = auth.uid();

    if v_last is not null and v_last > now() - interval '10 seconds' then
      raise exception 'Esperá unos segundos antes de crear otra alerta';
    end if;

    if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then
      raise exception 'Latitud inválida';
    end if;

    if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
      raise exception 'Longitud inválida';
    end if;

    insert into public.alerts
      (community_id, triggered_by, location_latitude, location_longitude, idempotency_key)
    values
      (p_community_id, auth.uid(), p_latitude, p_longitude, p_idempotency_key)
    on conflict (idempotency_key) do nothing
    returning id into v_alert_id;

    if v_alert_id is null then
      -- Otra petición concurrente ganó: devolvemos su alerta.
      select id into v_alert_id
        from public.alerts
       where idempotency_key = p_idempotency_key;
      v_duplicate := true;
    else
      -- Destinatarios: sólo integrantes activos de esa comunidad, en este momento.
      insert into public.alert_recipients (alert_id, recipient_user_id)
      select v_alert_id, m.user_id
        from public.community_members m
       where m.community_id = p_community_id
         and m.membership_status = 'active'
         and m.user_id <> auth.uid();

      get diagnostics v_recipients = row_count;

      insert into public.notification_jobs (alert_id, recipient_user_id)
      select v_alert_id, recipient_user_id
        from public.alert_recipients
       where alert_id = v_alert_id;

      insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
      values (auth.uid(), 'alert.trigger', 'alert', v_alert_id::text,
              jsonb_build_object(
                'community_id', p_community_id,
                'recipients', v_recipients,
                'has_location', p_latitude is not null
              ));
    end if;
  end if;

  select count(*) into v_recipients
    from public.alert_recipients
   where alert_id = v_alert_id;

  return jsonb_build_object(
    'alert_id', v_alert_id,
    'duplicate', v_duplicate,
    'recipients', v_recipients,
    'registered_at', (select created_at from public.alerts where id = v_alert_id)
  );
end;
$$;

-- ------------------------------------------------------------
-- Dispositivos / Web Push
-- ------------------------------------------------------------
create or replace function public.register_push_subscription(
  p_endpoint text,
  p_subscription jsonb,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if p_endpoint is null or p_endpoint !~ '^https://' then
    raise exception 'Endpoint inválido';
  end if;

  if p_subscription is null
     or p_subscription -> 'keys' ->> 'p256dh' is null
     or p_subscription -> 'keys' ->> 'auth' is null then
    raise exception 'Suscripción push incompleta';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, subscription_data, user_agent, revoked_at)
  values (auth.uid(), p_endpoint, p_subscription, left(p_user_agent, 300), null)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        subscription_data = excluded.subscription_data,
        user_agent = excluded.user_agent,
        revoked_at = null,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.revoke_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  update public.push_subscriptions
     set revoked_at = now()
   where endpoint = p_endpoint
     and user_id = auth.uid()
     and revoked_at is null;
end;
$$;

-- ------------------------------------------------------------
-- Panel de administración (verificación de permisos en el servidor)
-- ------------------------------------------------------------
create or replace function public.admin_set_plan_price(p_plan_id uuid, p_price_ars numeric)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_admin();

  if p_price_ars is null or p_price_ars < 0 or p_price_ars > 10000000 then
    raise exception 'Precio inválido';
  end if;

  update public.subscription_plans
     set price_ars = p_price_ars, updated_at = now()
   where id = p_plan_id;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'plan.price.update', 'subscription_plan', p_plan_id::text,
          jsonb_build_object('price_ars', p_price_ars));
end;
$$;

create or replace function public.admin_set_plan(p_plan_id uuid, p_trial_days integer, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_admin();

  if p_trial_days is null or p_trial_days < 0 or p_trial_days > 60 then
    raise exception 'Días de prueba inválidos';
  end if;

  update public.subscription_plans
     set trial_days = p_trial_days, active = coalesce(p_active, active), updated_at = now()
   where id = p_plan_id;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'plan.update', 'subscription_plan', p_plan_id::text,
          jsonb_build_object('trial_days', p_trial_days, 'active', p_active));
end;
$$;

create or replace function public.admin_set_user_suspended(
  p_user_id uuid,
  p_suspended boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_admin();

  if p_user_id = auth.uid() then
    raise exception 'No podés suspender tu propia cuenta';
  end if;

  update public.profiles
     set suspended = p_suspended,
         suspended_reason = case when p_suspended then left(coalesce(p_reason, 'Sin motivo'), 300) else null end
   where id = p_user_id;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), case when p_suspended then 'user.suspend' else 'user.reinstate' end,
          'user', p_user_id::text, jsonb_build_object('reason', coalesce(p_reason, '')));
end;
$$;

create or replace function public.admin_upsert_emergency_contact(
  p_service_type public.service_type,
  p_phone_number text,
  p_province text default null,
  p_locality text default null,
  p_label text default null,
  p_source_url text default null,
  p_country_code text default 'AR'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  perform public.assert_admin();

  if p_phone_number is null or p_phone_number !~ '^[0-9+() -]{3,20}$' then
    raise exception 'Número inválido';
  end if;

  insert into public.emergency_contacts
    (country_code, province, locality, service_type, phone_number, label, source_url, verified_at, active)
  values
    (upper(p_country_code), nullif(btrim(coalesce(p_province, '')), ''),
     nullif(btrim(coalesce(p_locality, '')), ''), p_service_type,
     btrim(p_phone_number), nullif(btrim(coalesce(p_label, '')), ''),
     nullif(btrim(coalesce(p_source_url, '')), ''), now(), true)
  on conflict (country_code, coalesce(province, ''), coalesce(locality, ''), service_type) do update
    set phone_number = excluded.phone_number,
        label = excluded.label,
        source_url = excluded.source_url,
        verified_at = now(),
        active = true,
        updated_at = now()
  returning id into v_id;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'emergency_contact.upsert', 'emergency_contact', v_id::text,
          jsonb_build_object('service_type', p_service_type, 'locality', p_locality));

  return v_id;
end;
$$;

create or replace function public.admin_set_emergency_contact_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_admin();

  update public.emergency_contacts
     set active = p_active, updated_at = now()
   where id = p_id;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'emergency_contact.toggle', 'emergency_contact', p_id::text,
          jsonb_build_object('active', p_active));
end;
$$;

create or replace function public.admin_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_result jsonb;
begin
  perform public.assert_admin();

  select jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_suspended', (select count(*) from public.profiles where suspended),
    'communities_total', (select count(*) from public.communities),
    'members_active', (select count(*) from public.community_members where membership_status = 'active'),
    'alerts_last_30d', (select count(*) from public.alerts where created_at > now() - interval '30 days'),
    'revenue_month_ars', coalesce((select sum(amount_ars) from public.payment_events
                                    where status = 'approved'
                                      and created_at >= date_trunc('month', now())), 0),
    'subscriptions_trial', (select count(*) from public.user_subscriptions
                             where status = 'trial' and trial_ends_at > now()),
    'subscriptions_trial_expired', (select count(*) from public.user_subscriptions
                                     where status = 'trial' and trial_ends_at <= now()),
    'subscriptions_active', (select count(*) from public.user_subscriptions where status = 'active'),
    'subscriptions_past_due', (select count(*) from public.user_subscriptions where status = 'past_due'),
    'subscriptions_expired', (select count(*) from public.user_subscriptions where status = 'expired'),
    'subscriptions_canceled', (select count(*) from public.user_subscriptions where status = 'canceled'),
    'alerts_total', (select count(*) from public.alerts),
    'alerts_last_7d', (select count(*) from public.alerts where created_at > now() - interval '7 days'),
    'payment_events', (select count(*) from public.payment_events),
    'notification_failures', (select count(*) from public.notification_jobs where status = 'failed')
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_users(p_limit integer default 50, p_offset integer default 0)
returns table (
  user_id uuid,
  full_name text,
  email text,
  suspended boolean,
  role public.app_role,
  subscription_status text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_admin();

  return query
  select
    p.id,
    p.full_name,
    u.email::text,
    p.suspended,
    p.role,
    coalesce(s.status::text, 'none'),
    s.trial_ends_at,
    s.current_period_end,
    p.created_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join public.user_subscriptions s on s.user_id = p.id
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create or replace function public.admin_payment_events(p_limit integer default 50)
returns table (
  id uuid,
  provider text,
  provider_payment_id text,
  event_type text,
  amount_ars numeric,
  status public.payment_status,
  provider_event_id text,
  created_at timestamptz,
  user_id uuid
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_admin();

  return query
  select e.id, e.provider, e.provider_payment_id, e.event_type, e.amount_ars,
         e.status, e.provider_event_id, e.created_at, s.user_id
    from public.payment_events e
    join public.user_subscriptions s on s.id = e.user_subscription_id
   order by e.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

-- Promoción a administrador general: sólo desde el SQL editor (service role).
create or replace function public.admin_promote_by_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
begin
  if auth.uid() is not null then
    raise exception 'Esta operación sólo puede ejecutarse desde el SQL editor';
  end if;

  select id into v_user_id from auth.users where lower(email) = lower(p_email) limit 1;

  if v_user_id is null then
    raise exception 'No existe un usuario con ese email';
  end if;

  update public.profiles
     set role = 'admin_general'
   where id = v_user_id;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (v_user_id, 'admin.promote', 'user', v_user_id::text, jsonb_build_object('by', 'sql_editor'));
end;
$$;

revoke execute on function public.admin_promote_by_email(text) from public, anon, authenticated;
grant execute on function public.admin_promote_by_email(text) to postgres, service_role;
-- >>> FIN 0002_functions.sql

-- >>> INICIO 0003_rls.sql

-- ============================================================
-- 0003_rls.sql
-- Row Level Security: activación + políticas.
-- Regla general: el cliente sólo LEE lo que le corresponde;
-- las escrituras sensibles pasan por funciones SECURITY DEFINER.
-- ============================================================

-- ------------------------------------------------------------
-- Helper sin RLS (evita recursión entre políticas)
-- ------------------------------------------------------------
create or replace function public.is_active_member(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.community_members
     where community_id = p_community_id
       and user_id = auth.uid()
       and membership_status = 'active'
  );
$$;

create or replace function public.is_member_any(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.community_members
     where community_id = p_community_id
       and user_id = auth.uid()
       and membership_status in ('pending', 'active')
  );
$$;

create or replace function public.is_community_admin(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.community_members
     where community_id = p_community_id
       and user_id = auth.uid()
       and role = 'admin'
       and membership_status = 'active'
  );
$$;

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles_select_self_or_admin"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Vecinos que comparten comunidad activa pueden verse entre sí
-- (nombres en listados, emisor de alertas y destinatarios).
create policy "profiles_select_community_peers"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1
        from public.community_members mine
        join public.community_members theirs
          on theirs.community_id = mine.community_id
       where mine.user_id = auth.uid()
         and mine.membership_status = 'active'
         and theirs.user_id = profiles.id
         and theirs.membership_status in ('active', 'pending')
    )
  );

-- Datos básicos visibles; nada sensible (no hay documento ni email acá).
revoke select on public.profiles from authenticated, anon;
grant select (id, full_name, phone, role, suspended, created_at, updated_at)
  on public.profiles to authenticated;

create policy "profiles_update_self"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Sólo columnas editables por el propio usuario (rol/suspensión: servidor).
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone, updated_at) on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated, anon;

-- ------------------------------------------------------------
-- communities
-- ------------------------------------------------------------
alter table public.communities enable row level security;

create policy "communities_select_member"
  on public.communities for select to authenticated
  using (public.is_member_any(id) or created_by = auth.uid() or public.is_admin());

create policy "communities_update_admin"
  on public.communities for update to authenticated
  using (public.is_community_admin(id))
  with check (public.is_community_admin(id));

-- Crear/eliminar comunidades: únicamente vía create_community().
revoke insert, delete on public.communities from authenticated, anon;

-- ------------------------------------------------------------
-- community_members
-- ------------------------------------------------------------
alter table public.community_members enable row level security;

create policy "community_members_select"
  on public.community_members for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_active_member(community_id)
    or public.is_admin()
  );

-- Altas, aprobaciones y bajas: únicamente vía funciones del servidor.
revoke insert, update, delete on public.community_members from authenticated, anon;

-- ------------------------------------------------------------
-- community_invites
-- ------------------------------------------------------------
alter table public.community_invites enable row level security;

create policy "invites_select_admin"
  on public.community_invites for select to authenticated
  using (created_by = auth.uid() or public.is_community_admin(community_id) or public.is_admin());

revoke insert, update, delete on public.community_invites from authenticated, anon;

-- ------------------------------------------------------------
-- community_logs
-- ------------------------------------------------------------
alter table public.community_logs enable row level security;

create policy "community_logs_select_admin"
  on public.community_logs for select to authenticated
  using (public.is_community_admin(community_id) or public.is_admin());

revoke insert, update, delete on public.community_logs from authenticated, anon;

-- ------------------------------------------------------------
-- subscription_plans (sólo lectura pública del precio vigente)
-- ------------------------------------------------------------
alter table public.subscription_plans enable row level security;

create policy "plans_select"
  on public.subscription_plans for select to authenticated
  using (active = true or public.is_admin());

revoke insert, update, delete on public.subscription_plans from authenticated, anon;

-- ------------------------------------------------------------
-- user_subscriptions (NUNCA modificable desde el cliente)
-- ------------------------------------------------------------
alter table public.user_subscriptions enable row level security;

create policy "subscriptions_select_own_or_admin"
  on public.user_subscriptions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke insert, update, delete on public.user_subscriptions from authenticated, anon;

-- ------------------------------------------------------------
-- payment_events (sólo lectura del propio historial)
-- ------------------------------------------------------------
alter table public.payment_events enable row level security;

create policy "payment_events_select_own_or_admin"
  on public.payment_events for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
        from public.user_subscriptions s
       where s.id = payment_events.user_subscription_id
         and s.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.payment_events from authenticated, anon;

-- ------------------------------------------------------------
-- alerts
-- ------------------------------------------------------------
alter table public.alerts enable row level security;

create policy "alerts_select_members"
  on public.alerts for select to authenticated
  using (public.is_active_member(community_id) or public.is_admin());

revoke insert, update, delete on public.alerts from authenticated, anon;

-- ------------------------------------------------------------
-- alert_recipients
-- ------------------------------------------------------------
alter table public.alert_recipients enable row level security;

create policy "alert_recipients_select"
  on public.alert_recipients for select to authenticated
  using (
    recipient_user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1
        from public.alerts a
       where a.id = alert_recipients.alert_id
         and public.is_active_member(a.community_id)
    )
  );

create policy "alert_recipients_update_seen"
  on public.alert_recipients for update to authenticated
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- El cliente sólo puede marcar "visto"; el estado de envío lo gestiona el servidor.
revoke update on public.alert_recipients from authenticated;
grant update (seen_at) on public.alert_recipients to authenticated;
revoke insert, delete on public.alert_recipients from authenticated, anon;

-- ------------------------------------------------------------
-- push_subscriptions (dispositivos propios)
-- ------------------------------------------------------------
alter table public.push_subscriptions enable row level security;

create policy "push_select_own"
  on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "push_delete_own"
  on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

-- Registro/upsert: vía register_push_subscription().
revoke insert, update on public.push_subscriptions from authenticated, anon;

-- ------------------------------------------------------------
-- notification_jobs (interno)
-- ------------------------------------------------------------
alter table public.notification_jobs enable row level security;

create policy "notification_jobs_select_admin"
  on public.notification_jobs for select to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.notification_jobs from authenticated, anon;

-- ------------------------------------------------------------
-- emergency_contacts (lectura para todos los autenticados)
-- ------------------------------------------------------------
alter table public.emergency_contacts enable row level security;

create policy "emergency_contacts_select"
  on public.emergency_contacts for select to authenticated
  using (active = true or public.is_admin());

revoke insert, update, delete on public.emergency_contacts from authenticated, anon;

-- ------------------------------------------------------------
-- audit_logs / signup_attempts (sólo servidor y admin)
-- ------------------------------------------------------------
alter table public.audit_logs enable row level security;

create policy "audit_logs_select_admin"
  on public.audit_logs for select to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.audit_logs from authenticated, anon;

alter table public.signup_attempts enable row level security;
revoke all on public.signup_attempts from anon, authenticated;

-- ------------------------------------------------------------
-- Anon no accede a ninguna tabla de la aplicación
-- ------------------------------------------------------------
revoke all on all tables in schema public from anon;

-- ------------------------------------------------------------
-- Realtime (alertas y membresías para las pantallas abiertas)
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alerts'
  ) then
    alter publication supabase_realtime add table public.alerts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alert_recipients'
  ) then
    alter publication supabase_realtime add table public.alert_recipients;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_members'
  ) then
    alter publication supabase_realtime add table public.community_members;
  end if;
end
$$;

-- ------------------------------------------------------------
-- Ejecución de funciones
-- ------------------------------------------------------------
revoke execute on all functions in schema public from anon;
grant execute on all functions in schema public to authenticated;

-- Sólo el SQL editor / service role (el grant anterior no debe reabrirla).
revoke execute on function public.admin_promote_by_email(text) from anon, authenticated;
grant execute on function public.admin_promote_by_email(text) to postgres, service_role;
-- >>> FIN 0003_rls.sql

-- >>> INICIO 0004_seed.sql

-- ============================================================
-- 0004_seed.sql
-- Datos iniciales.
-- IMPORTANTE: no se inventan precios. El precio en ARS se configura
-- desde el panel de administración (admin_set_plan_price).
-- ============================================================

insert into public.subscription_plans (name, price_ars, billing_interval, trial_days, features, active)
select
  'Plan mensual',
  0,                 -- 0 = precio sin configurar todavía (admin lo define en ARS)
  'month',
  7,
  jsonb_build_array(
    'Alertas vecinales ilimitadas',
    'Comunidad e invitaciones',
    'Notificaciones push',
    'Historial de alertas',
    'Contactos de emergencia'
  ),
  true
where not exists (select 1 from public.subscription_plans);

-- Contactos de emergencia: se cargan desde el panel de administración con
-- fuente oficial verificada (varía por provincia/localidad).
-- Ver docs/FASE8_emergencias.md antes de publicar números.
-- >>> FIN 0004_seed.sql

-- >>> INICIO 0005_seed_emergency_contacts.sql

-- ============================================================
-- 0005_seed_emergency_contacts.sql
-- Números oficiales de emergencia (Argentina).
-- TODOS verificados en fuentes oficiales; jamás se inventan números.
-- Fuente general: https://www.argentina.gob.ar/tema/emergencias
--   - 911  Central de Emergencias Nacional (policía / emergencias)
--   - 100  Bomberos
--   - 107  SAME, emergencias médicas (Ciudad de Buenos Aires y
--          localidades de la provincia de Buenos Aires)
-- Carga desde el panel de administración con su propia fuente.
-- ============================================================

insert into public.emergency_contacts
  (country_code, province, locality, service_type, phone_number, label, source_url, verified_at, active)
values
  ('AR', null, null, 'police',   '911', 'Central de Emergencias Nacional',
   'https://www.argentina.gob.ar/tema/emergencias', now(), true),
  ('AR', null, null, 'fire',     '100', 'Bomberos',
   'https://www.argentina.gob.ar/tema/emergencias', now(), true),
  ('AR', null, null, 'ambulance','107', 'SAME · emergencias médicas',
   'https://www.argentina.gob.ar/tema/emergencias', now(), true)
on conflict (country_code, coalesce(province, ''), coalesce(locality, ''), service_type)
do nothing;
-- >>> FIN 0005_seed_emergency_contacts.sql
