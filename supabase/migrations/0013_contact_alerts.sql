-- ============================================================
-- 0013_contact_alerts.sql
-- FASE 15 — Aviso de Estoy Bien "por la app" para los contactos.
-- Hoy los contactos se avisan por SMS/email (todavía sin proveedor),
-- así que nadie recibe nada. Este cambio deja el aviso de alerta en
-- la app, igual que lo recibe un vecino:
--   1) Nueva columna account_id en estoy_bien_contacts: la cuenta del
--      contacto que aceptó el link.
--   2) estoy_bien_contact_respond: ACEPTAR exige sesión (queda
--      vinculado a esa cuenta); RECHAZAR sigue pudiendo hacerse sin
--      cuenta, sólo con el token.
--   3) estoy_bien_tick: al abrirse la alerta, los contactos aceptados
--      con cuenta reciben campanita + push (los demás siguen en
--      SMS/email pendiente).
--   4) estoy_bien_confirm: al resolverse la alerta reciben el aviso
--      de resolución por la app.
-- Pegar completo en el SQL Editor de Supabase y ejecutar.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Cuenta del contacto que aceptó el link (null = sin cuenta)
-- ------------------------------------------------------------
alter table public.estoy_bien_contacts
  add column if not exists account_id uuid
  references public.profiles (id) on delete set null;

-- Una misma cuenta no puede ser contacto dos veces de la misma persona.
create unique index if not exists contacts_account_uniq
  on public.estoy_bien_contacts (user_id, account_id)
  where account_id is not null;

-- ------------------------------------------------------------
-- 2) Respuesta del contacto: aceptar queda ligado a la cuenta,
--    rechazar sigue anónimo (sólo con el token de la URL)
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
  v_uid uuid := auth.uid();
begin
  if p_token is null
     or p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Link de invitación inválido';
  end if;

  select * into v_contact
    from public.estoy_bien_contacts
   where invite_token = p_token::uuid
     and status = 'pending';

  if v_contact.id is null then
    raise exception 'La invitación ya fue respondida o no existe';
  end if;

  if coalesce(p_accept, false) then
    -- Sin cuenta no hay forma de avisarle por la app: hace falta sesión.
    if v_uid is null then
      raise exception 'Para recibir los avisos en la app necesitás iniciar sesión o crear una cuenta';
    end if;
    if v_uid = v_contact.user_id then
      raise exception 'No podés ser tu propio contacto';
    end if;
    if exists (select 1 from public.estoy_bien_contacts
                where user_id = v_contact.user_id
                  and account_id = v_uid) then
      raise exception 'Ya sos contacto de esa persona';
    end if;
    v_new_status := 'accepted';
  else
    v_new_status := 'declined';
  end if;

  update public.estoy_bien_contacts
     set status = v_new_status,
         consent_at = now(),
         account_id = case when v_new_status = 'accepted' then v_uid else null end,
         updated_at = now()
   where id = v_contact.id;

  return jsonb_build_object('ok', true, 'status', v_new_status);
end;
$$;

-- ------------------------------------------------------------
-- 3) Tick: al abrirse la alerta se avisa a los contactos con cuenta
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
  v_contact_body text;
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

    -- Contactos aceptados con cuenta: el aviso entra por la app
    -- (campanita + push), igual que cualquier otro aviso.
    select coalesce(nullif(p.full_name, ''), 'Tu contacto')
           || ' no confirmó que está bien. Si podés, contactalo.'
      into v_contact_body
      from public.profiles p
     where p.id = r.user_id;

    with ins as (
      insert into public.estoy_bien_reminders
        (user_id, cycle_date, kind, channel, status, contact_id, title, body, url,
         sent_at, created_at, updated_at)
      select c.account_id, v_date, 'alert', 'in_app', 'sent', c.id,
             'Estoy bien: sin confirmación',
             coalesce(v_contact_body, 'Tu contacto no confirmó que está bien.'),
             '/inicio', p_now, p_now, p_now
        from public.estoy_bien_contacts c
       where c.user_id = r.user_id
         and c.status = 'accepted'
         and c.account_id is not null
      on conflict do nothing
      returning id, user_id
    )
    insert into public.notifications (user_id, title, body, created_at)
    select ins.user_id,
           'Estoy bien: sin confirmación',
           coalesce(v_contact_body, 'Tu contacto no confirmó que está bien.'),
           p_now
      from ins;

    insert into public.estoy_bien_reminders
      (user_id, cycle_date, kind, channel, status, contact_id, title, body, url,
       created_at, updated_at)
    select c.account_id, v_date, 'alert', 'push', 'pending', c.id,
           'Estoy bien: sin confirmación',
           coalesce(v_contact_body, 'Tu contacto no confirmó que está bien.'),
           '/inicio', p_now, p_now
      from public.estoy_bien_contacts c
     where c.user_id = r.user_id
       and c.status = 'accepted'
       and c.account_id is not null
    on conflict do nothing;

    -- Contactos sin cuenta: quedan pendientes de proveedor de SMS/email.
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
       and c.account_id is null
    on conflict do nothing;
  end loop;

  return v_count;
end;
$$;

-- ------------------------------------------------------------
-- 4) Confirmación: al resolverse se les avisa a los contactos
--    con cuenta, por la app
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
  v_contact_body text;
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

    -- Contactos con cuenta: resolución por la app (campanita + push).
    -- Sólo si el aviso de alerta les llegó ese día.
    select coalesce(nullif(p.full_name, ''), 'La persona que te contactaría')
           || ' confirmó que está bien.'
      into v_contact_body
      from public.profiles p
     where p.id = v_uid;

    with ins as (
      insert into public.estoy_bien_reminders
        (user_id, cycle_date, kind, channel, status, contact_id, title, body, url,
         sent_at, created_at, updated_at)
      select c.account_id, v_date, 'resolved', 'in_app', 'sent', c.id,
             'Estoy bien: alerta resuelta',
             coalesce(v_contact_body, 'La persona que te contactaría confirmó que está bien.'),
             '/inicio', v_now, v_now, v_now
        from public.estoy_bien_contacts c
       where c.user_id = v_uid
         and c.status = 'accepted'
         and c.account_id is not null
         and exists (
           select 1 from public.estoy_bien_reminders r
            where r.cycle_date = v_date
              and r.kind = 'alert'
              and r.contact_id = c.id
         )
      on conflict do nothing
      returning id, user_id
    )
    insert into public.notifications (user_id, title, body, created_at)
    select ins.user_id,
           'Estoy bien: alerta resuelta',
           coalesce(v_contact_body, 'La persona que te contactaría confirmó que está bien.'),
           v_now
      from ins;

    insert into public.estoy_bien_reminders
      (user_id, cycle_date, kind, channel, status, contact_id, title, body, url,
       created_at, updated_at)
    select c.account_id, v_date, 'resolved', 'push', 'pending', c.id,
           'Estoy bien: alerta resuelta',
           coalesce(v_contact_body, 'La persona que te contactaría confirmó que está bien.'),
           '/inicio', v_now, v_now
      from public.estoy_bien_contacts c
     where c.user_id = v_uid
       and c.status = 'accepted'
       and c.account_id is not null
       and exists (
         select 1 from public.estoy_bien_reminders r
          where r.cycle_date = v_date
            and r.kind = 'alert'
            and r.contact_id = c.id
       )
    on conflict do nothing;

    -- Contactos sin cuenta: queda pendiente de proveedor de SMS/email.
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
       and c.account_id is null
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
-- 5) Permisos (se mantienen los de 0008)
-- ------------------------------------------------------------
revoke execute on function public.estoy_bien_confirm(uuid, timestamptz) from public, anon;
revoke execute on function public.estoy_bien_tick(timestamptz) from public, anon, authenticated;

grant execute on function public.estoy_bien_confirm(uuid, timestamptz) to authenticated, postgres, service_role;
grant execute on function public.estoy_bien_tick(timestamptz) to postgres, service_role;

-- El contacto responde el link: aceptar exige sesión, rechazar no.
revoke execute on function public.estoy_bien_contact_respond(text, boolean) from public;
grant execute on function public.estoy_bien_contact_respond(text, boolean) to anon, authenticated, postgres, service_role;
