-- ============================================================
-- 0010_precaucion.sql
-- FASE 13 · Aviso de PRECAUCIÓN con mensaje de texto libre.
--   1) Tipo public.alert_severity ('alerta' | 'precaucion').
--   2) alerts.severity + alerts.message (1..200 caracteres).
--   3) trigger_alert con p_severity/p_message y cooldown propio:
--        alerta    -> 10 s (igual que siempre)
--        precaucion -> 15 s, sin bloquear a la alerta roja.
-- El aviso usa los mismos destinatarios, la misma Edge Function
-- (trigger-alert) y el mismo historial que la alerta vecinal.
-- Pegar completo en el SQL Editor de Supabase y ejecutar.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Tipo de severidad
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'alert_severity'
       and n.nspname = 'public'
  ) then
    create type public.alert_severity as enum ('alerta', 'precaucion');
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) Columnas en alerts
-- ------------------------------------------------------------
alter table public.alerts
  add column if not exists severity public.alert_severity not null default 'alerta',
  add column if not exists message text;

alter table public.alerts drop constraint if exists alerts_message_length;
alter table public.alerts add constraint alerts_message_length
  check (message is null or char_length(message) between 1 and 200);

-- ------------------------------------------------------------
-- 3) trigger_alert: severidad, mensaje y cooldown por severidad
--    (PostgreSQL no permite sumar parámetros con CREATE OR REPLACE,
--    por eso se elimina y se vuelve a crear con los mismos permisos).
-- ------------------------------------------------------------
drop function if exists public.trigger_alert(uuid, text, double precision, double precision);

create or replace function public.trigger_alert(
  p_community_id uuid,
  p_idempotency_key text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_severity text default 'alerta',
  p_message text default null
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
  v_severity public.alert_severity;
  v_message text;
  v_cooldown interval;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    raise exception 'Clave de idempotencia inválida';
  end if;

  if coalesce(p_severity, 'alerta') not in ('alerta', 'precaucion') then
    raise exception 'Tipo de aviso inválido';
  end if;

  v_severity := coalesce(p_severity, 'alerta')::public.alert_severity;

  if v_severity = 'precaucion' then
    v_message := nullif(btrim(coalesce(p_message, '')), '');

    if v_message is null or char_length(v_message) < 3 then
      raise exception 'El aviso necesita un mensaje de al menos 3 caracteres';
    end if;

    if char_length(v_message) > 200 then
      raise exception 'El mensaje no puede superar los 200 caracteres';
    end if;

    v_cooldown := interval '15 seconds';
  else
    -- La alerta roja no lleva mensaje.
    v_message := null;
    v_cooldown := interval '10 seconds';
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

    -- Cooldown por severidad: un aviso nunca bloquea una alerta urgente.
    select max(created_at) into v_last
      from public.alerts
     where community_id = p_community_id
       and triggered_by = auth.uid()
       and severity = v_severity;

    if v_last is not null and v_last > now() - v_cooldown then
      if v_severity = 'precaucion' then
        raise exception 'Esperá unos segundos antes de mandar otro aviso';
      end if;
      raise exception 'Esperá unos segundos antes de crear otra alerta';
    end if;

    if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then
      raise exception 'Latitud inválida';
    end if;

    if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
      raise exception 'Longitud inválida';
    end if;

    insert into public.alerts
      (community_id, triggered_by, location_latitude, location_longitude,
       idempotency_key, severity, message)
    values
      (p_community_id, auth.uid(), p_latitude, p_longitude,
       p_idempotency_key, v_severity, v_message)
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
                'has_location', p_latitude is not null,
                'severity', v_severity::text,
                'has_message', v_message is not null
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
    'severity', (select severity::text from public.alerts where id = v_alert_id),
    'message', (select message from public.alerts where id = v_alert_id),
    'registered_at', (select created_at from public.alerts where id = v_alert_id)
  );
end;
$$;
