-- ============================================================
-- 0008_estoy_bien.sql
-- FASE 12 · Módulo "Estoy Bien" (confirmación diaria de bienestar).
--   1) estoy_bien_settings   : configuración por usuario (20:00, gracia 60 min).
--   2) estoy_bien_checks     : confirmaciones diarias (idempotentes).
--   3) estoy_bien_contacts   : contactos personales con invitación por link.
--   4) estoy_bien_alerts     : alerta por ciclo diario (grace/open/resolved/canceled).
--   5) estoy_bien_reminders  : registro de envíos (in_app, push, sms, email).
--   6) RPC del cliente: estado, confirmar, configuración, contactos.
--   7) estoy_bien_tick(p_now) : transiciones A-E idempotentes para el cron.
--   8) Panel admin: métricas y alertas abiertas.
-- Estados: disabled | pending | grace | alert | confirmed.
-- Pegar completo en el SQL Editor de Supabase y ejecutar.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Configuración por usuario
-- ------------------------------------------------------------
create table if not exists public.estoy_bien_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  enabled boolean not null default false,
  consented_at timestamptz,
  reminder_time time not null default '20:00',
  grace_minutes integer not null default 60
    check (grace_minutes between 0 and 1440),
  timezone text not null default 'America/Argentina/Buenos_Aires',
  enabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not enabled or consented_at is not null)
);

-- ------------------------------------------------------------
-- 2) Confirmaciones diarias (una por usuario y fecha local)
-- ------------------------------------------------------------
create table if not exists public.estoy_bien_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  cycle_date date not null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, cycle_date)
);

create index if not exists checks_user_date_idx
  on public.estoy_bien_checks (user_id, cycle_date desc);

-- ------------------------------------------------------------
-- 3) Contactos personales de emergencia (NO confundir con
--    emergency_contacts, que son números oficiales de servicios)
-- ------------------------------------------------------------
create table if not exists public.estoy_bien_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  phone text not null check (phone ~ '^[0-9+() -]{6,20}$'),
  email text check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  relationship text check (relationship is null or char_length(relationship) <= 60),
  notify_channel text not null default 'sms'
    check (notify_channel in ('sms', 'email')),
  invite_token uuid not null unique default gen_random_uuid(),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  consent_at timestamptz,
  invited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (notify_channel <> 'email' or email is not null)
);

create index if not exists contacts_user_idx
  on public.estoy_bien_contacts (user_id, created_at);

-- ------------------------------------------------------------
-- 4) Alerta por ciclo diario (una por usuario y fecha)
-- ------------------------------------------------------------
create table if not exists public.estoy_bien_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  cycle_date date not null,
  status text not null default 'grace'
    check (status in ('grace', 'open', 'resolved', 'canceled')),
  due_at timestamptz not null,
  grace_ends_at timestamptz not null,
  opened_at timestamptz,
  resolved_at timestamptz,
  resolution text check (resolution is null or resolution in ('user', 'admin', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, cycle_date)
);

create index if not exists alerts_open_idx
  on public.estoy_bien_alerts (status, opened_at)
  where status in ('grace', 'open');

-- ------------------------------------------------------------
-- 5) Registro de envíos (in-app, push y canales aún no configurados)
-- ------------------------------------------------------------
create table if not exists public.estoy_bien_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  cycle_date date not null,
  kind text not null check (kind in ('reminder', 'alert', 'resolved')),
  channel text not null check (channel in ('in_app', 'push', 'sms', 'email')),
  status public.delivery_status not null default 'pending',
  title text,
  body text,
  url text,
  contact_id uuid references public.estoy_bien_contacts (id) on delete set null,
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists reminders_uniq
  on public.estoy_bien_reminders
  (user_id, cycle_date, kind, channel, coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists reminders_push_pending_idx
  on public.estoy_bien_reminders (created_at)
  where channel = 'push' and status in ('pending', 'failed');

-- ------------------------------------------------------------
-- RLS: el cliente sólo lee; las escrituras pasan por RPC
-- ------------------------------------------------------------
alter table public.estoy_bien_settings enable row level security;
alter table public.estoy_bien_checks enable row level security;
alter table public.estoy_bien_contacts enable row level security;
alter table public.estoy_bien_alerts enable row level security;
alter table public.estoy_bien_reminders enable row level security;

drop policy if exists "settings_select_own" on public.estoy_bien_settings;
create policy "settings_select_own"
  on public.estoy_bien_settings for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "checks_select_own" on public.estoy_bien_checks;
create policy "checks_select_own"
  on public.estoy_bien_checks for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "contacts_select_own" on public.estoy_bien_contacts;
create policy "contacts_select_own"
  on public.estoy_bien_contacts for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "alerts_select_own" on public.estoy_bien_alerts;
create policy "alerts_select_own"
  on public.estoy_bien_alerts for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "reminders_select_own" on public.estoy_bien_reminders;
create policy "reminders_select_own"
  on public.estoy_bien_reminders for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.estoy_bien_settings from authenticated;
revoke insert, update, delete on public.estoy_bien_checks from authenticated;
revoke insert, update, delete on public.estoy_bien_contacts from authenticated;
revoke insert, update, delete on public.estoy_bien_alerts from authenticated;
revoke insert, update, delete on public.estoy_bien_reminders from authenticated;
revoke all on public.estoy_bien_settings from anon;
revoke all on public.estoy_bien_checks from anon;
revoke all on public.estoy_bien_contacts from anon;
revoke all on public.estoy_bien_alerts from anon;
revoke all on public.estoy_bien_reminders from anon;
grant select on public.estoy_bien_settings to authenticated;
grant select on public.estoy_bien_checks to authenticated;
grant select on public.estoy_bien_contacts to authenticated;
grant select on public.estoy_bien_alerts to authenticated;
grant select on public.estoy_bien_reminders to authenticated;

-- ------------------------------------------------------------
-- 7.1) Estado interno (no invocable desde el cliente)
-- ------------------------------------------------------------
create or replace function public.estoy_bien_state_internal(p_uid uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  s public.estoy_bien_settings%rowtype;
  v_check public.estoy_bien_checks%rowtype;
  v_alert public.estoy_bien_alerts%rowtype;
  v_local timestamp;
  v_date date;
  v_due timestamptz;
  v_grace_end timestamptz;
  v_status text;
  v_has_push boolean;
  v_has_check boolean := false;
  v_has_alert boolean := false;
  v_found boolean := false;
begin
  select * into s from public.estoy_bien_settings where user_id = p_uid;
  v_found := found;

  if not v_found or not s.enabled then
    return jsonb_build_object(
      'enabled', false,
      'status', 'disabled',
      'cycle_date', (p_now at time zone coalesce(s.timezone, 'America/Argentina/Buenos_Aires'))::date,
      'reminder_time', coalesce(to_char(s.reminder_time, 'HH24:MI'), '20:00'),
      'grace_minutes', coalesce(s.grace_minutes, 60),
      'timezone', coalesce(s.timezone, 'America/Argentina/Buenos_Aires'),
      'consented_at', s.consented_at,
      'confirmed_at', null,
      'alert', null,
      'push_enabled', exists (
        select 1 from public.push_subscriptions
         where user_id = p_uid and revoked_at is null
      ),
      'contacts_total', (select count(*) from public.estoy_bien_contacts where user_id = p_uid),
      'contacts_accepted', (select count(*) from public.estoy_bien_contacts
                             where user_id = p_uid and status = 'accepted')
    );
  end if;

  v_local := p_now at time zone s.timezone;
  v_date := v_local::date;
  v_due := (v_date + s.reminder_time) at time zone s.timezone;
  v_grace_end := v_due + make_interval(mins => s.grace_minutes);

  select * into v_check
    from public.estoy_bien_checks
   where user_id = p_uid and cycle_date = v_date;
  v_has_check := v_check.id is not null;

  select * into v_alert
    from public.estoy_bien_alerts
   where user_id = p_uid and cycle_date = v_date;
  v_has_alert := v_alert.id is not null;

  if v_has_check then
    v_status := 'confirmed';
  elsif v_has_alert and v_alert.status in ('grace', 'open') then
    v_status := case when v_alert.status = 'open' then 'alert' else 'grace' end;
  elsif s.enabled_at is not null and s.enabled_at > v_due then
    v_status := 'pending';
  elsif p_now >= v_grace_end then
    v_status := 'alert';
  elsif p_now >= v_due then
    v_status := 'grace';
  else
    v_status := 'pending';
  end if;

  select exists (
    select 1 from public.push_subscriptions
     where user_id = p_uid and revoked_at is null
  ) into v_has_push;

  return jsonb_build_object(
    'enabled', true,
    'status', v_status,
    'consented_at', s.consented_at,
    'cycle_date', v_date,
    'reminder_time', to_char(s.reminder_time, 'HH24:MI'),
    'grace_minutes', s.grace_minutes,
    'timezone', s.timezone,
    'due_at', v_due,
    'grace_ends_at', v_grace_end,
    'confirmed_at', case when v_check.id is not null then v_check.confirmed_at end,
    'alert', case
      when v_alert.id is null then null
      else jsonb_build_object(
        'id', v_alert.id,
        'status', v_alert.status,
        'due_at', v_alert.due_at,
        'grace_ends_at', v_alert.grace_ends_at,
        'opened_at', v_alert.opened_at,
        'resolved_at', v_alert.resolved_at
      )
    end,
    'push_enabled', v_has_push,
    'contacts_total', (select count(*) from public.estoy_bien_contacts where user_id = p_uid),
    'contacts_accepted', (select count(*) from public.estoy_bien_contacts
                           where user_id = p_uid and status = 'accepted')
  );
end;
$$;

-- ------------------------------------------------------------
-- 7.2) Estado para la pantalla principal
-- ------------------------------------------------------------
create or replace function public.estoy_bien_get_state(
  p_user_id uuid default null,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then
    if nullif(coalesce(current_setting('request.jwt.claims', true), ''), '') is not null
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
      raise exception 'No autorizado';
    end if;
    if p_user_id is null then
      raise exception 'Falta el usuario';
    end if;
    v_uid := p_user_id;
    v_now := coalesce(p_now, now());
  end if;

  return public.estoy_bien_state_internal(v_uid, v_now);
end;
$$;

-- ------------------------------------------------------------
-- 7.3) Confirmación diaria (idempotente) y resolución de alertas
-- ------------------------------------------------------------
create or replace function public.estoy_bien_confirm(
  p_user_id uuid default null,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  s public.estoy_bien_settings%rowtype;
  v_date date;
  v_alert_ids uuid[];
  v_resolved_count integer := 0;
begin
  if v_uid is null then
    if nullif(coalesce(current_setting('request.jwt.claims', true), ''), '') is not null
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
      raise exception 'No autorizado';
    end if;
    if p_user_id is null then
      raise exception 'Falta el usuario';
    end if;
    v_uid := p_user_id;
    v_now := coalesce(p_now, now());
  end if;

  select * into s from public.estoy_bien_settings where user_id = v_uid;

  if not found or not s.enabled then
    raise exception 'El módulo Estoy Bien no está activado';
  end if;

  v_date := (v_now at time zone s.timezone)::date;

  insert into public.estoy_bien_checks (user_id, cycle_date, confirmed_at, created_at)
  values (v_uid, v_date, v_now, v_now)
  on conflict (user_id, cycle_date) do nothing;

  -- Cierra cualquier alerta pendiente del usuario (incluidas las de
  -- días anteriores que el cron no haya alcanzado a resolver).
  with resolved as (
    update public.estoy_bien_alerts
       set status = 'resolved',
           resolved_at = v_now,
           resolution = 'user',
           updated_at = v_now
     where user_id = v_uid
       and status in ('grace', 'open')
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_alert_ids from resolved;

  v_resolved_count := coalesce(array_length(v_alert_ids, 1), 0);

  if v_resolved_count > 0 then
    insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    values (v_uid, 'checkin.alert_resolved', 'checkin_alert', v_alert_ids[1]::text,
            jsonb_build_object('cycle_date', v_date, 'resolved', v_resolved_count));
  end if;

  if v_resolved_count > 0 then
    with ins as (
      insert into public.estoy_bien_reminders
        (user_id, cycle_date, kind, channel, status, title, body, url,
         sent_at, created_at, updated_at)
      values (v_uid, v_date, 'resolved', 'in_app', 'sent',
              'Estoy bien: alerta resuelta',
              'Tu confirmación fue registrada y la alerta se cerró.',
              '/estoy-bien', v_now, v_now, v_now)
      on conflict do nothing
      returning id
    )
    insert into public.notifications (user_id, title, body, created_at)
    select v_uid,
           'Estoy bien: alerta resuelta',
           'Tu confirmación fue registrada y la alerta se cerró.',
           v_now
      from ins;

    insert into public.estoy_bien_reminders
      (user_id, cycle_date, kind, channel, status, title, body, url, created_at, updated_at)
    values (v_uid, v_date, 'resolved', 'push', 'pending',
            'Estoy bien: alerta resuelta',
            'Tu confirmación fue registrada y la alerta se cerró.',
            '/estoy-bien', v_now, v_now)
    on conflict do nothing;

    -- Aviso de resolución a los contactos: queda pendiente hasta
    -- que haya proveedor de SMS/email configurado.
    insert into public.estoy_bien_reminders
      (user_id, cycle_date, kind, channel, status, contact_id, title, body,
       attempts, last_error, created_at, updated_at)
    select v_uid, v_date, 'resolved', c.notify_channel, 'pending', c.id,
           'Estoy bien: alerta resuelta',
           'La persona que te contactaría confirmó que está bien.',
           0, 'sin proveedor de SMS/email configurado', v_now, v_now
      from public.estoy_bien_contacts c
     where c.user_id = v_uid
       and c.status <> 'declined'
       and exists (
         select 1 from public.estoy_bien_reminders r
          where r.user_id = v_uid and r.cycle_date = v_date
            and r.kind = 'alert' and r.contact_id = c.id
       )
    on conflict do nothing;
  end if;

  return public.estoy_bien_state_internal(v_uid, v_now);
end;
$$;

-- ------------------------------------------------------------
-- 7.4) Configurar (activar con consentimiento, horario y gracia)
-- ------------------------------------------------------------
create or replace function public.estoy_bien_save_settings(
  p_enabled boolean,
  p_reminder_time time default '20:00',
  p_grace_minutes integer default 60,
  p_timezone text default 'America/Argentina/Buenos_Aires',
  p_consent boolean default false,
  p_user_id uuid default null,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_consent timestamptz;
  v_enabled_at timestamptz;
  v_already_enabled boolean := false;
begin
  if v_uid is null then
    if nullif(coalesce(current_setting('request.jwt.claims', true), ''), '') is not null
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
      raise exception 'No autorizado';
    end if;
    if p_user_id is null then
      raise exception 'Falta el usuario';
    end if;
    v_uid := p_user_id;
    v_now := coalesce(p_now, now());
  end if;

  if p_grace_minutes is null or p_grace_minutes not between 0 and 1440 then
    raise exception 'La gracia debe estar entre 0 y 1440 minutos';
  end if;

  if p_reminder_time is null then
    raise exception 'Falta la hora del recordatorio';
  end if;

  if p_timezone is null
     or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Zona horaria inválida';
  end if;

  v_consent := null;
  if p_enabled then
    select enabled, consented_at, coalesce(enabled_at, v_now)
      into v_already_enabled, v_consent, v_enabled_at
      from public.estoy_bien_settings
     where user_id = v_uid;

    if not coalesce(v_already_enabled, false) and not coalesce(p_consent, false) then
      raise exception 'Para activar Estoy Bien hace falta aceptar el uso preventivo';
    end if;

    if v_consent is null then
      v_consent := v_now;
    end if;
    if v_enabled_at is null then
      v_enabled_at := v_now;
    end if;
  else
    v_enabled_at := null;
  end if;

  insert into public.estoy_bien_settings
    (user_id, enabled, consented_at, reminder_time, grace_minutes,
     timezone, enabled_at, created_at, updated_at)
  values
    (v_uid, p_enabled, v_consent, p_reminder_time, p_grace_minutes,
     p_timezone, v_enabled_at, v_now, v_now)
  on conflict (user_id) do update
    set enabled = excluded.enabled,
        consented_at = case when excluded.enabled then coalesce(excluded.consented_at, public.estoy_bien_settings.consented_at) end,
        reminder_time = excluded.reminder_time,
        grace_minutes = excluded.grace_minutes,
        timezone = excluded.timezone,
        enabled_at = case when excluded.enabled then coalesce(public.estoy_bien_settings.enabled_at, excluded.enabled_at) end,
        updated_at = excluded.updated_at;

  if not p_enabled then
    -- Al desactivar se cancela la alerta que estuviera abierta.
    update public.estoy_bien_alerts a
       set status = 'canceled',
           resolved_at = v_now,
           resolution = 'disabled',
           updated_at = v_now
     from public.estoy_bien_settings s
     where a.user_id = v_uid
       and s.user_id = v_uid
       and a.status in ('grace', 'open')
       and a.cycle_date = (v_now at time zone s.timezone)::date;
  end if;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (v_uid, 'checkin.settings', 'user', v_uid::text,
          jsonb_build_object('enabled', p_enabled, 'reminder_time', p_reminder_time::text,
                             'grace_minutes', p_grace_minutes));

  return public.estoy_bien_state_internal(v_uid, v_now);
end;
$$;

-- ------------------------------------------------------------
-- 7.5) Contactos: alta y edición
-- ------------------------------------------------------------
create or replace function public.estoy_bien_save_contact(
  p_id uuid default null,
  p_full_name text default null,
  p_phone text default null,
  p_email text default null,
  p_relationship text default null,
  p_notify_channel text default 'sms'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_phone text;
  v_email text;
  v_rel text;
  v_channel text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'No autorizado';
  end if;

  v_name := nullif(btrim(coalesce(p_full_name, '')), '');
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'El nombre debe tener entre 2 y 120 caracteres';
  end if;

  v_phone := nullif(btrim(coalesce(p_phone, '')), '');
  if v_phone is null or v_phone !~ '^[0-9+() -]{6,20}$' then
    raise exception 'Teléfono inválido';
  end if;

  v_email := nullif(btrim(coalesce(p_email, '')), '');
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Email inválido';
  end if;

  v_rel := nullif(btrim(coalesce(p_relationship, '')), '');
  if v_rel is not null and char_length(v_rel) > 60 then
    raise exception 'La relación no puede superar los 60 caracteres';
  end if;

  v_channel := coalesce(p_notify_channel, 'sms');
  if v_channel not in ('sms', 'email') then
    raise exception 'Canal inválido';
  end if;
  if v_channel = 'email' and v_email is null then
    raise exception 'Para avisar por email hace falta cargar uno';
  end if;

  if p_id is null then
    insert into public.estoy_bien_contacts
      (user_id, full_name, phone, email, relationship, notify_channel,
       created_at, updated_at)
    values
      (v_uid, v_name, v_phone, v_email, v_rel, v_channel, now(), now())
    returning id into v_id;
  else
    update public.estoy_bien_contacts
       set full_name = v_name,
           phone = v_phone,
           email = v_email,
           relationship = v_rel,
           notify_channel = v_channel,
           updated_at = now()
     where id = p_id and user_id = v_uid
    returning id into v_id;

    if v_id is null then
      raise exception 'No existe ese contacto';
    end if;
  end if;

  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- 7.6) Contactos: eliminar y renovar el link de invitación
-- ------------------------------------------------------------
create or replace function public.estoy_bien_delete_contact(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_ok boolean;
begin
  if v_uid is null then
    raise exception 'No autorizado';
  end if;

  delete from public.estoy_bien_contacts
   where id = p_id and user_id = v_uid
  returning true into v_ok;

  if not coalesce(v_ok, false) then
    raise exception 'No existe ese contacto';
  end if;
end;
$$;

create or replace function public.estoy_bien_rotate_invite(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_token uuid;
begin
  if v_uid is null then
    raise exception 'No autorizado';
  end if;

  update public.estoy_bien_contacts
     set invite_token = gen_random_uuid(),
         status = 'pending',
         consent_at = null,
         invited_at = now(),
         updated_at = now()
   where id = p_id and user_id = v_uid
  returning invite_token into v_token;

  if v_token is null then
    raise exception 'No existe ese contacto';
  end if;

  return v_token;
end;
$$;

-- ------------------------------------------------------------
-- 7.7) Respuesta del contacto: link público con token (sin cuenta)
-- ------------------------------------------------------------
create or replace function public.estoy_bien_contact_respond(p_token text, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_contact public.estoy_bien_contacts%rowtype;
  v_new_status text;
begin
  if p_token is null
     or p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Link de invitación inválido';
  end if;

  v_new_status := case when coalesce(p_accept, false) then 'accepted' else 'declined' end;

  update public.estoy_bien_contacts
     set status = v_new_status,
         consent_at = now(),
         updated_at = now()
   where invite_token = p_token::uuid
     and status = 'pending'
  returning * into v_contact;

  if not found then
    raise exception 'La invitación ya fue respondida o no existe';
  end if;

  return jsonb_build_object('ok', true, 'status', v_new_status);
end;
$$;

-- ------------------------------------------------------------
-- 7.8) Tick de cron: transiciones A-E, idempotente por (usuario, fecha)
-- ------------------------------------------------------------
create or replace function public.estoy_bien_tick(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
  v_tz text;
  v_date date;
  v_due timestamptz;
  v_grace_end timestamptz;
  v_alert_id uuid;
  v_title text;
  v_body text;
  v_time_label text;
  v_count integer := 0;
  v_notified integer := 0;
begin
  for r in
    select s.*
      from public.estoy_bien_settings s
      join public.profiles p on p.id = s.user_id
     where s.enabled
       and s.consented_at is not null
       and p.suspended = false
  loop
    v_tz := r.timezone;
    v_date := (p_now at time zone v_tz)::date;
    v_due := (v_date + r.reminder_time) at time zone v_tz;
    v_grace_end := v_due + make_interval(mins => r.grace_minutes);

    -- Activó hoy después de la hora de recordatorio: no se evalúa hoy.
    if r.enabled_at is not null and r.enabled_at > v_due then
      continue;
    end if;

    -- Ya confirmó: cierra cualquier alerta pendiente (incluidas viejas).
    if exists (select 1 from public.estoy_bien_checks
                where user_id = r.user_id and cycle_date = v_date) then
      update public.estoy_bien_alerts
         set status = 'resolved',
             resolved_at = p_now,
             resolution = 'user',
             updated_at = p_now
       where user_id = r.user_id
         and status in ('grace', 'open');
      continue;
    end if;

    if p_now < v_due then
      continue; -- estado B: pendiente, aún no toca recordar
    end if;

    v_time_label := to_char(v_due at time zone v_tz, 'HH24:MI');

    if p_now < v_grace_end then
      -- estado C: gracia corriendo + recordatorio idempotente
      -- Sólo se cuentan las transiciones realmente nuevas.
      v_alert_id := null;
      insert into public.estoy_bien_alerts
        (user_id, cycle_date, status, due_at, grace_ends_at, created_at, updated_at)
      values
        (r.user_id, v_date, 'grace', v_due, v_grace_end, p_now, p_now)
      on conflict (user_id, cycle_date) do nothing
      returning id into v_alert_id;

      v_title := 'Estoy bien: recordatorio';
      v_body := 'Todavía no confirmaste que estás bien. Tenés hasta las ' || v_time_label || '.';

      with ins as (
        insert into public.estoy_bien_reminders
          (user_id, cycle_date, kind, channel, status, title, body, url,
           sent_at, created_at, updated_at)
        values (r.user_id, v_date, 'reminder', 'in_app', 'sent',
                v_title, v_body, '/estoy-bien', p_now, p_now, p_now)
        on conflict do nothing
        returning id
      ), notif as (
        insert into public.notifications (user_id, title, body, created_at)
        select r.user_id, v_title, v_body, p_now from ins
        returning id
      )
      select count(*) into v_notified from notif;

      insert into public.estoy_bien_reminders
        (user_id, cycle_date, kind, channel, status, title, body, url,
         created_at, updated_at)
      values (r.user_id, v_date, 'reminder', 'push', 'pending',
              v_title, v_body, '/estoy-bien', p_now, p_now)
      on conflict do nothing;

      if v_alert_id is not null or v_notified > 0 then
        v_count := v_count + 1;
      end if;
      continue;
    end if;

    -- estado D: se abrió la alerta (idempotente)
    insert into public.estoy_bien_alerts
      (user_id, cycle_date, status, due_at, grace_ends_at, opened_at,
       created_at, updated_at)
    values
      (r.user_id, v_date, 'open', v_due, v_grace_end, p_now, p_now, p_now)
    on conflict (user_id, cycle_date) do update
      set status = 'open',
          opened_at = coalesce(public.estoy_bien_alerts.opened_at, p_now),
          updated_at = p_now
    where public.estoy_bien_alerts.status in ('grace', 'canceled')
    returning id into v_alert_id;

    if v_alert_id is null then
      continue; -- ya estaba abierta: no se repiten avisos
    end if;

    v_count := v_count + 1;

    insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    values (r.user_id, 'checkin.alert_opened', 'checkin_alert', v_alert_id::text,
            jsonb_build_object('cycle_date', v_date, 'due_at', v_due));

    v_title := 'Estoy bien: sin confirmación';
    v_body := 'No confirmaste tu bienestar. Si podés, avisale a tus contactos de emergencia.';

    with ins as (
      insert into public.estoy_bien_reminders
        (user_id, cycle_date, kind, channel, status, title, body, url,
         sent_at, created_at, updated_at)
      values (r.user_id, v_date, 'alert', 'in_app', 'sent',
              v_title, v_body, '/estoy-bien', p_now, p_now, p_now)
      on conflict do nothing
      returning id
    )
    insert into public.notifications (user_id, title, body, created_at)
    select r.user_id, v_title, v_body, p_now from ins;

    insert into public.estoy_bien_reminders
      (user_id, cycle_date, kind, channel, status, title, body, url,
       created_at, updated_at)
    values (r.user_id, v_date, 'alert', 'push', 'pending',
            v_title, v_body, '/estoy-bien', p_now, p_now)
    on conflict do nothing;

    -- Contactos: quedarían pendientes de proveedor de SMS/email.
    insert into public.estoy_bien_reminders
      (user_id, cycle_date, kind, channel, status, contact_id, title, body,
       attempts, last_error, created_at, updated_at)
    select r.user_id, v_date, 'alert', c.notify_channel, 'pending', c.id,
           'Estoy bien: sin respuesta',
           'No hubo confirmación de bienestar de tu contacto.',
           0, 'sin proveedor de SMS/email configurado', p_now, p_now
      from public.estoy_bien_contacts c
     where c.user_id = r.user_id
       and c.status <> 'declined'
    on conflict do nothing;
  end loop;

  return v_count;
end;
$$;

-- ------------------------------------------------------------
-- 8) Panel admin: alertas abiertas + métricas del módulo
-- ------------------------------------------------------------
create or replace function public.admin_checkin_alerts(p_limit integer default 50)
returns table (
  alert_id uuid,
  user_id uuid,
  full_name text,
  email text,
  cycle_date date,
  status text,
  opened_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth, extensions
as $$
begin
  perform public.assert_admin();

  return query
  select a.id, a.user_id, p.full_name, u.email::text, a.cycle_date, a.status, a.opened_at
    from public.estoy_bien_alerts a
    join public.profiles p on p.id = a.user_id
    left join auth.users u on u.id = a.user_id
   where a.status in ('grace', 'open')
   order by a.opened_at desc nulls last, a.cycle_date desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
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
  v_local_today date;
begin
  perform public.assert_admin();

  v_local_today := (now() at time zone 'America/Argentina/Buenos_Aires')::date;

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
    'notification_failures', (select count(*) from public.notification_jobs where status = 'failed'),
    'checkin_enabled', (select count(*) from public.estoy_bien_settings where enabled),
    'checkin_confirmed_today', (select count(*) from public.estoy_bien_checks
                                 where cycle_date = v_local_today),
    'checkin_alerts_open', (select count(*) from public.estoy_bien_alerts
                             where status in ('grace', 'open')),
    'checkin_push_failed', (select count(*) from public.estoy_bien_reminders
                             where channel = 'push' and status = 'failed'),
    'checkin_contacts_pending', (select count(*) from public.estoy_bien_contacts
                                  where status = 'pending')
  ) into v_result;

  return v_result;
end;
$$;

-- ------------------------------------------------------------
-- Permisos de ejecución
-- ------------------------------------------------------------
revoke execute on function public.estoy_bien_state_internal(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.estoy_bien_get_state(uuid, timestamptz) from public, anon;
revoke execute on function public.estoy_bien_confirm(uuid, timestamptz) from public, anon;
revoke execute on function public.estoy_bien_save_settings(boolean, time, integer, text, boolean, uuid, timestamptz) from public, anon;
revoke execute on function public.estoy_bien_save_contact(uuid, text, text, text, text, text) from public, anon;
revoke execute on function public.estoy_bien_delete_contact(uuid) from public, anon;
revoke execute on function public.estoy_bien_rotate_invite(uuid) from public, anon;
revoke execute on function public.estoy_bien_tick(timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_checkin_alerts(integer) from public, anon;

grant execute on function public.estoy_bien_state_internal(uuid, timestamptz) to postgres, service_role;
grant execute on function public.estoy_bien_get_state(uuid, timestamptz) to authenticated, postgres, service_role;
grant execute on function public.estoy_bien_confirm(uuid, timestamptz) to authenticated, postgres, service_role;
grant execute on function public.estoy_bien_save_settings(boolean, time, integer, text, boolean, uuid, timestamptz) to authenticated, postgres, service_role;
grant execute on function public.estoy_bien_save_contact(uuid, text, text, text, text, text) to authenticated, postgres, service_role;
grant execute on function public.estoy_bien_delete_contact(uuid) to authenticated, postgres, service_role;
grant execute on function public.estoy_bien_rotate_invite(uuid) to authenticated, postgres, service_role;
grant execute on function public.estoy_bien_tick(timestamptz) to postgres, service_role;
grant execute on function public.admin_checkin_alerts(integer) to authenticated, postgres, service_role;

-- El contacto responde el link sin cuenta (sólo con el token en la URL).
revoke execute on function public.estoy_bien_contact_respond(text, boolean) from public;
grant execute on function public.estoy_bien_contact_respond(text, boolean) to anon, authenticated, postgres, service_role;
