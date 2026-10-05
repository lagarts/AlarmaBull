-- ============================================================
-- 11_estoy_bien_tests.sql
-- FASE 12 · Pruebas del módulo "Estoy Bien" con fechas controladas
-- (el tick y las RPC aceptan p_now/p_user_id sólo para el SQL editor).
-- Cada bloque lanza una excepción si la regla no se cumple.
-- ============================================================

reset role;
reset request.jwt.claims;

-- ------------------------------------------------------------
-- 1) Activación con consentimiento y estado inicial
-- ------------------------------------------------------------
do $$
declare
  v_state jsonb;
  v_count integer;
begin
  -- Estado base: sin dispositivos push (10_tests dejó uno de Ana)
  delete from public.push_subscriptions
   where user_id = '11111111-1111-1111-1111-111111111111';

  -- Guardas de validación
  begin
    perform public.estoy_bien_save_settings(true, '20:00', 60,
      'America/Argentina/Buenos_Aires', false,
      '11111111-1111-1111-1111-111111111111', '2026-03-10 18:00:00-03');
    raise exception 'FALLO: se activó sin consentimiento';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: activar exige aceptar el uso preventivo';
  end;

  begin
    perform public.estoy_bien_save_settings(true, '20:00', 2000,
      'America/Argentina/Buenos_Aires', true,
      '11111111-1111-1111-1111-111111111111', '2026-03-10 18:00:00-03');
    raise exception 'FALLO: se aceptó una gracia fuera de rango';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: la gracia se valida entre 0 y 1440 minutos';
  end;

  begin
    perform public.estoy_bien_save_settings(true, '20:00', 60,
      'Marte/Olympus', true,
      '11111111-1111-1111-1111-111111111111', '2026-03-10 18:00:00-03');
    raise exception 'FALLO: se aceptó una zona horaria inválida';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: la zona horaria se valida contra pg_timezone_names';
  end;

  -- Activación válida a las 18:00 (antes del recordatorio de las 20:00)
  v_state := public.estoy_bien_save_settings(true, '20:00', 60,
    'America/Argentina/Buenos_Aires', true,
    '11111111-1111-1111-1111-111111111111', '2026-03-10 18:00:00-03');

  if (v_state ->> 'enabled')::boolean is not true
     or v_state ->> 'status' <> 'pending' then
    raise exception 'FALLO: estado inicial esperado pending, llegó %', v_state;
  end if;
  if v_state ->> 'cycle_date' <> '2026-03-10' then
    raise exception 'FALLO: cycle_date %', v_state ->> 'cycle_date';
  end if;
  if v_state ->> 'reminder_time' <> '20:00'
     or (v_state ->> 'grace_minutes')::int <> 60 then
    raise exception 'FALLO: no se guardó horario/gracia %', v_state;
  end if;
  if v_state ->> 'push_enabled' <> 'false' then
    raise exception 'FALLO: push_enabled debería ser false %', v_state;
  end if;

  select count(*) into v_count from public.estoy_bien_settings
   where user_id = '11111111-1111-1111-1111-111111111111';
  if v_count <> 1 then
    raise exception 'FALLO: settings duplicados (%)', v_count;
  end if;

  raise notice 'OK: activación con consentimiento, validaciones y estado pending';
end
$$;

-- ------------------------------------------------------------
-- 2) Tick antes de la hora: no hace nada (estado B)
-- ------------------------------------------------------------
do $$
declare
  v_acted integer;
  v_count integer;
begin
  v_acted := public.estoy_bien_tick('2026-03-10 19:30:00-03');
  if v_acted <> 0 then
    raise exception 'FALLO: el tick actuó antes de la hora (%)', v_acted;
  end if;

  select count(*) into v_count from public.estoy_bien_alerts
   where user_id = '11111111-1111-1111-1111-111111111111';
  if v_count <> 0 then
    raise exception 'FALLO: hubo alertas antes de la hora (%)', v_count;
  end if;

  select count(*) into v_count from public.estoy_bien_reminders
   where user_id = '11111111-1111-1111-1111-111111111111';
  if v_count <> 0 then
    raise exception 'FALLO: hubo recordatorios antes de la hora (%)', v_count;
  end if;

  raise notice 'OK: el tick no actúa antes de la hora de recordatorio';
end
$$;

-- ------------------------------------------------------------
-- 3) Confirmación diaria idempotente (estado E)
-- ------------------------------------------------------------
do $$
declare
  v_state jsonb;
  v_count integer;
begin
  v_state := public.estoy_bien_confirm(
    '11111111-1111-1111-1111-111111111111', '2026-03-10 19:35:00-03');

  if v_state ->> 'status' <> 'confirmed' then
    raise exception 'FALLO: se esperaba confirmed, llegó %', v_state ->> 'status';
  end if;
  if v_state ->> 'confirmed_at' is null then
    raise exception 'FALLO: falta confirmed_at %', v_state;
  end if;

  -- Segunda confirmación del mismo día: no debe duplicar
  perform public.estoy_bien_confirm(
    '11111111-1111-1111-1111-111111111111', '2026-03-10 19:40:00-03');

  select count(*) into v_count from public.estoy_bien_checks
   where user_id = '11111111-1111-1111-1111-111111111111';
  if v_count <> 1 then
    raise exception 'FALLO: la confirmación no es idempotente (%)', v_count;
  end if;

  -- Confirmada: el tick de la hora de gracia no debe tocarla
  perform public.estoy_bien_tick('2026-03-10 21:00:00-03');
  select count(*) into v_count from public.estoy_bien_alerts
   where user_id = '11111111-1111-1111-1111-111111111111';
  if v_count <> 0 then
    raise exception 'FALLO: se abrió alerta a un usuario confirmado (%)', v_count;
  end if;

  -- A las 20:30 sigue contando como confirmada (no grace)
  v_state := public.estoy_bien_get_state(
    '11111111-1111-1111-1111-111111111111', '2026-03-10 20:30:00-03');
  if v_state ->> 'status' <> 'confirmed' then
    raise exception 'FALLO: confirmada debería primar sobre grace (%)', v_state ->> 'status';
  end if;

  raise notice 'OK: la confirmación diaria es idempotente y bloquea el tick';
end
$$;

-- ------------------------------------------------------------
-- 4) Bruno: gracia con recordatorio idempotente (estado C)
-- ------------------------------------------------------------
do $$
declare
  v_state jsonb;
  v_count integer;
  v_acted integer;
begin
  -- Contacto de emergencia personal (se necesita antes de la alerta)
  perform public.estoy_bien_save_settings(true, '20:00', 60,
    'America/Argentina/Buenos_Aires', true,
    '22222222-2222-2222-2222-222222222222', '2026-03-11 10:00:00-03');

  set role authenticated;
  set request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';

  begin
    perform public.estoy_bien_save_contact(null, 'Lia', '11', null, 'Hermana', 'sms');
    raise exception 'FALLO: se aceptó un teléfono demasiado corto';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: el teléfono del contacto se valida en el servidor';
  end;

  perform public.estoy_bien_save_contact(null, 'Lucia Gomez', '1155551234',
    null, 'Hermana', 'sms');

  reset role;
  reset request.jwt.claims;

  if (select count(*) from public.estoy_bien_contacts
       where user_id = '22222222-2222-2222-2222-222222222222') <> 1 then
    raise exception 'FALLO: no se guardó el contacto';
  end if;

  -- 20:30: Ana (confirmada ayer) y Bruno entran en gracia
  v_acted := public.estoy_bien_tick('2026-03-11 20:30:00-03');
  if v_acted < 1 then
    raise exception 'FALLO: el tick no registró la gracia (%)', v_acted;
  end if;

  select count(*) into v_count from public.estoy_bien_alerts
   where user_id = '22222222-2222-2222-2222-222222222222'
     and cycle_date = '2026-03-11' and status = 'grace';
  if v_count <> 1 then
    raise exception 'FALLO: se esperaba 1 alerta en gracia (%)', v_count;
  end if;

  select count(*) into v_count from public.estoy_bien_reminders
   where user_id = '22222222-2222-2222-2222-222222222222'
     and kind = 'reminder' and channel = 'in_app' and status = 'sent';
  if v_count <> 1 then
    raise exception 'FALLO: recordatorio in-app (%)', v_count;
  end if;

  select count(*) into v_count from public.estoy_bien_reminders
   where user_id = '22222222-2222-2222-2222-222222222222'
     and kind = 'reminder' and channel = 'push' and status = 'pending';
  if v_count <> 1 then
    raise exception 'FALLO: recordatorio push pendiente (%)', v_count;
  end if;

  -- Idempotencia: segundo tick en la misma ventana
  v_acted := public.estoy_bien_tick('2026-03-11 20:35:00-03');
  if v_acted <> 0 then
    raise exception 'FALLO: el tick de gracia no es idempotente (%)', v_acted;
  end if;
  if (select count(*) from public.notifications
       where user_id = '22222222-2222-2222-2222-222222222222'
         and title = 'Estoy bien: recordatorio') <> 1 then
    raise exception 'FALLO: notificación in-app duplicada';
  end if;

  v_state := public.estoy_bien_get_state(
    '22222222-2222-2222-2222-222222222222', '2026-03-11 20:40:00-03');
  if v_state ->> 'status' <> 'grace' then
    raise exception 'FALLO: se esperaba grace (%)', v_state ->> 'status';
  end if;
  if v_state ->> 'grace_ends_at' is null then
    raise exception 'FALLO: falta grace_ends_at %', v_state;
  end if;

  raise notice 'OK: gracia con recordatorio in-app + push e idempotencia';
end
$$;

-- ------------------------------------------------------------
-- 5) Ana confirma durante la gracia: se cierra sin avisos de resolución
-- ------------------------------------------------------------
do $$
declare
  v_state jsonb;
  v_count integer;
begin
  -- Ana entró en gracia en el tick anterior (2026-03-11 20:30)
  select count(*) into v_count from public.estoy_bien_alerts
   where user_id = '11111111-1111-1111-1111-111111111111'
     and status = 'grace';
  if v_count <> 1 then
    raise exception 'FALLO: Ana debería tener 1 alerta en gracia (%)', v_count;
  end if;

  v_state := public.estoy_bien_confirm(
    '11111111-1111-1111-1111-111111111111', '2026-03-11 20:45:00-03');

  if v_state ->> 'status' <> 'confirmed' then
    raise exception 'FALLO: se esperaba confirmed (%)', v_state ->> 'status';
  end if;

  select count(*) into v_count from public.estoy_bien_alerts
   where user_id = '11111111-1111-1111-1111-111111111111'
     and status = 'resolved' and resolution = 'user';
  if v_count <> 1 then
    raise exception 'FALLO: la alerta en gracia no se resolvió (%)', v_count;
  end if;

  raise notice 'OK: confirmar en gracia cierra la alerta como resolved/user';
end
$$;

-- ------------------------------------------------------------
-- 6) Bruno pasa la gracia: alerta abierta, avisos y contactos
-- ------------------------------------------------------------
do $$
declare
  v_state jsonb;
  v_count integer;
  v_acted integer;
  v_alert_id uuid;
begin
  v_acted := public.estoy_bien_tick('2026-03-11 21:30:00-03');
  if v_acted < 1 then
    raise exception 'FALLO: el tick no abrió la alerta (%)', v_acted;
  end if;

  select id into v_alert_id from public.estoy_bien_alerts
   where user_id = '22222222-2222-2222-2222-222222222222'
     and cycle_date = '2026-03-11';
  if v_alert_id is null then
    raise exception 'FALLO: no existe la alerta de Bruno';
  end if;

  v_state := public.estoy_bien_get_state(
    '22222222-2222-2222-2222-222222222222', '2026-03-11 21:35:00-03');
  if v_state ->> 'status' <> 'alert' then
    raise exception 'FALLO: se esperaba alert (%)', v_state ->> 'status';
  end if;
  if (v_state -> 'alert' ->> 'status') <> 'open' then
    raise exception 'FALLO: la alerta debería estar open %', v_state -> 'alert';
  end if;

  select count(*) into v_count from public.notifications
   where user_id = '22222222-2222-2222-2222-222222222222'
     and title = 'Estoy bien: sin confirmación';
  if v_count <> 1 then
    raise exception 'FALLO: notificación de alerta (%)', v_count;
  end if;

  -- El contacto personal queda avisado pero sin proveedor configurado
  select count(*) into v_count from public.estoy_bien_reminders
   where contact_id is not null
     and kind = 'alert'
     and status = 'pending'
     and last_error = 'sin proveedor de SMS/email configurado';
  if v_count <> 1 then
    raise exception 'FALLO: aviso al contacto (%)', v_count;
  end if;

  -- Auditoría de apertura
  if not exists (
    select 1 from public.audit_logs
     where action = 'checkin.alert_opened' and resource_id = v_alert_id::text
  ) then
    raise exception 'FALLO: no se registró la apertura en audit_logs';
  end if;

  -- Idempotencia del tick en estado D
  v_acted := public.estoy_bien_tick('2026-03-11 21:35:00-03');
  if v_acted <> 0 then
    raise exception 'FALLO: el tick de alerta no es idempotente (%)', v_acted;
  end if;
  if (select count(*) from public.estoy_bien_reminders
       where user_id = '22222222-2222-2222-2222-222222222222'
         and kind = 'alert' and channel = 'in_app') <> 1 then
    raise exception 'FALLO: avisos de alerta duplicados';
  end if;

  raise notice 'OK: apertura de alerta, notificación, contactos y auditoría';
end
$$;

-- ------------------------------------------------------------
-- 7) Bruno confirma con alerta abierta: resolución + avisos
-- ------------------------------------------------------------
do $$
declare
  v_state jsonb;
  v_count integer;
begin
  v_state := public.estoy_bien_confirm(
    '22222222-2222-2222-2222-222222222222', '2026-03-11 22:00:00-03');

  if v_state ->> 'status' <> 'confirmed' then
    raise exception 'FALLO: se esperaba confirmed (%)', v_state ->> 'status';
  end if;

  select count(*) into v_count from public.estoy_bien_alerts
   where user_id = '22222222-2222-2222-2222-222222222222'
     and status = 'resolved' and resolution = 'user';
  if v_count <> 1 then
    raise exception 'FALLO: la alerta abierta no se resolvió (%)', v_count;
  end if;

  select count(*) into v_count from public.notifications
   where user_id = '22222222-2222-2222-2222-222222222222'
     and title = 'Estoy bien: alerta resuelta';
  if v_count <> 1 then
    raise exception 'FALLO: notificación de resolución (%)', v_count;
  end if;

  select count(*) into v_count from public.estoy_bien_reminders
   where user_id = '22222222-2222-2222-2222-222222222222'
     and kind = 'resolved' and channel = 'push' and status = 'pending';
  if v_count <> 1 then
    raise exception 'FALLO: push de resolución (%)', v_count;
  end if;

  select count(*) into v_count from public.estoy_bien_reminders
   where kind = 'resolved' and contact_id is not null
     and last_error = 'sin proveedor de SMS/email configurado';
  if v_count <> 1 then
    raise exception 'FALLO: aviso de resolución al contacto (%)', v_count;
  end if;

  raise notice 'OK: confirmar con alerta abierta la resuelve y avisa';
end
$$;

-- ------------------------------------------------------------
-- 8) Zona horaria: Madrid y Buenos Aires ven fechas distintas
-- ------------------------------------------------------------
do $$
declare
  v_state jsonb;
  v_acted integer;
  v_count integer;
begin
  perform public.estoy_bien_save_settings(true, '20:00', 60,
    'Europe/Madrid', true,
    '33333333-3333-3333-3333-333333333333', '2026-03-12 12:00:00+01');

  -- 19:30 UTC = 20:30 en Madrid (Ana/Bruno: 16:30 en Buenos Aires)
  v_state := public.estoy_bien_get_state(
    '33333333-3333-3333-3333-333333333333', '2026-03-12 19:30:00+00');
  if v_state ->> 'status' <> 'grace'
     or v_state ->> 'cycle_date' <> '2026-03-12'
     or v_state ->> 'timezone' <> 'Europe/Madrid' then
    raise exception 'FALLO: estado en Madrid %', v_state;
  end if;

  v_state := public.estoy_bien_get_state(
    '11111111-1111-1111-1111-111111111111', '2026-03-12 19:30:00+00');
  if v_state ->> 'status' <> 'pending'
     or v_state ->> 'cycle_date' <> '2026-03-12' then
    raise exception 'FALLO: estado en Buenos Aires %', v_state;
  end if;

  v_acted := public.estoy_bien_tick('2026-03-12 19:30:00+00');
  if v_acted <> 1 then
    raise exception 'FALLO: sólo Carla debería actuar (%)', v_acted;
  end if;

  select count(*) into v_count from public.estoy_bien_alerts
   where user_id = '33333333-3333-3333-3333-333333333333'
     and status = 'grace';
  if v_count <> 1 then
    raise exception 'FALLO: alerta de Carla en gracia (%)', v_count;
  end if;
  if exists (
    select 1 from public.estoy_bien_alerts
     where user_id in ('11111111-1111-1111-1111-111111111111',
                       '22222222-2222-2222-2222-222222222222')
       and cycle_date = '2026-03-12'
  ) then
    raise exception 'FALLO: se alertó a usuarios que aún no vencieron';
  end if;

  raise notice 'OK: la fecha y el tick respetan la zona horaria de cada usuario';
end
$$;

-- ------------------------------------------------------------
-- 9) Panel admin: métricas y alertas abiertas sólo para el admin
-- ------------------------------------------------------------
do $$
declare
  v_metrics jsonb;
  v_rows integer;
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';

  begin
    perform public.admin_checkin_alerts();
    raise exception 'FALLO: un usuario común leyó las alertas del módulo';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: admin_checkin_alerts exige administrador';
  end;

  -- Ana es administradora general (promovida en 10_tests)
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  select count(*) into v_rows from public.admin_checkin_alerts();
  if v_rows < 1 then
    raise exception 'FALLO: la alerta en gracia de Carla no aparece (%)', v_rows;
  end if;

  v_metrics := public.admin_metrics();
  if (v_metrics ->> 'checkin_enabled')::int < 3 then
    raise exception 'FALLO: checkin_enabled %', v_metrics ->> 'checkin_enabled';
  end if;
  if (v_metrics ->> 'checkin_alerts_open')::int < 1 then
    raise exception 'FALLO: checkin_alerts_open %', v_metrics ->> 'checkin_alerts_open';
  end if;
  if not (v_metrics ? 'checkin_confirmed_today')
     or not (v_metrics ? 'checkin_push_failed')
     or not (v_metrics ? 'checkin_contacts_pending') then
    raise exception 'FALLO: faltan claves checkin en admin_metrics %', v_metrics;
  end if;

  reset role;
  reset request.jwt.claims;

  raise notice 'OK: métricas y alertas del módulo visibles sólo para admin';
end
$$;

-- ------------------------------------------------------------
-- 10) Desactivar cancela la alerta abierta del día
-- ------------------------------------------------------------
do $$
declare
  v_state jsonb;
begin
  v_state := public.estoy_bien_save_settings(false, '20:00', 60,
    'Europe/Madrid', false,
    '33333333-3333-3333-3333-333333333333', '2026-03-12 21:05:00+01');

  if (v_state ->> 'enabled')::boolean is not false
     or v_state ->> 'status' <> 'disabled' then
    raise exception 'FALLO: estado tras desactivar %', v_state;
  end if;

  if (select status from public.estoy_bien_alerts
       where user_id = '33333333-3333-3333-3333-333333333333'
         and cycle_date = '2026-03-12') <> 'canceled' then
    raise exception 'FALLO: la alerta no se canceló al desactivar';
  end if;

  if (select resolution from public.estoy_bien_alerts
       where user_id = '33333333-3333-3333-3333-333333333333'
         and cycle_date = '2026-03-12') <> 'disabled' then
    raise exception 'FALLO: la resolución debería ser disabled';
  end if;

  -- Con el módulo apagado el tick la salta
  if public.estoy_bien_tick('2026-03-12 23:00:00+01') <> 0 then
    raise exception 'FALLO: el tick procesó un usuario desactivado';
  end if;

  raise notice 'OK: desactivar cancela la alerta y detiene el tick';
end
$$;

-- ------------------------------------------------------------
-- 11) Activar tarde no castiga: sin alerta el mismo día
-- ------------------------------------------------------------
do $$
declare
  v_state jsonb;
  v_count integer;
begin
  -- Ana se desactiva...
  perform public.estoy_bien_save_settings(false, '20:00', 60,
    'America/Argentina/Buenos_Aires', false,
    '11111111-1111-1111-1111-111111111111', '2026-03-13 10:00:00-03');

  -- ...y no puede confirmar apagado
  begin
    perform public.estoy_bien_confirm(
      '11111111-1111-1111-1111-111111111111', '2026-03-13 10:05:00-03');
    raise exception 'FALLO: se confirmó con el módulo apagado';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: no se puede confirmar con el módulo apagado';
  end;

  -- ...y sin consentimiento no reactiva
  begin
    perform public.estoy_bien_save_settings(true, '20:00', 60,
      'America/Argentina/Buenos_Aires', false,
      '11111111-1111-1111-1111-111111111111', '2026-03-13 21:30:00-03');
    raise exception 'FALLO: reactivó sin consentimiento';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: reactivar vuelve a exigir consentimiento';
  end;

  -- Reactiva a las 21:30, después del recordatorio de las 20:00
  v_state := public.estoy_bien_save_settings(true, '20:00', 60,
    'America/Argentina/Buenos_Aires', true,
    '11111111-1111-1111-1111-111111111111', '2026-03-13 21:30:00-03');

  v_state := public.estoy_bien_get_state(
    '11111111-1111-1111-1111-111111111111', '2026-03-13 23:00:00-03');
  if v_state ->> 'status' <> 'pending' then
    raise exception 'FALLO: quien activa tarde no debería quedar en alerta (%)',
      v_state ->> 'status';
  end if;

  perform public.estoy_bien_tick('2026-03-13 23:30:00-03');

  select count(*) into v_count from public.estoy_bien_alerts
   where user_id = '11111111-1111-1111-1111-111111111111'
     and cycle_date = '2026-03-13';
  if v_count <> 0 then
    raise exception 'FALLO: se castigó al usuario que activó tarde (%)', v_count;
  end if;

  -- En cambio Bruno (activo desde siempre) sí queda en alerta hoy
  if (select status from public.estoy_bien_alerts
       where user_id = '22222222-2222-2222-2222-222222222222'
         and cycle_date = '2026-03-13') <> 'open' then
    raise exception 'FALLO: la alerta de Bruno del día siguiente no se abrió';
  end if;

  v_state := public.estoy_bien_get_state(
    '22222222-2222-2222-2222-222222222222', '2026-03-13 23:45:00-03');
  if v_state ->> 'status' <> 'alert' then
    raise exception 'FALLO: estado alert de Bruno (%)', v_state ->> 'status';
  end if;

  raise notice 'OK: activar tarde no genera alerta y el ciclo siguiente funciona';
end
$$;

-- ------------------------------------------------------------
-- 12) Contacto: link con token, aceptación sin cuenta
-- ------------------------------------------------------------
do $$
declare
  v_token uuid;
  v_state jsonb;
begin
  select invite_token into v_token from public.estoy_bien_contacts
   where user_id = '22222222-2222-2222-2222-222222222222';

  if v_token is null then
    raise exception 'FALLO: el contacto no tiene token';
  end if;

  -- El link se renueva (el viejo deja de servir)
  set role authenticated;
  set request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';
  v_token := public.estoy_bien_rotate_invite(
    (select id from public.estoy_bien_contacts
      where user_id = '22222222-2222-2222-2222-222222222222'));

  -- Y no puede tocar contactos ajenos
  begin
    perform public.estoy_bien_delete_contact(
      (select id from public.estoy_bien_contacts
        where user_id = '11111111-1111-1111-1111-111111111111' limit 1));
    raise exception 'FALLO: borró un contacto ajeno';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: cada usuario sólo administra sus contactos';
  end;

  reset role;
  reset request.jwt.claims;

  -- El contacto responde sin cuenta, sólo con el token
  set role anon;
  v_state := public.estoy_bien_contact_respond(v_token::text, true);

  if v_state ->> 'status' <> 'accepted' then
    raise exception 'FALLO: respuesta del contacto %', v_state;
  end if;

  begin
    perform public.estoy_bien_contact_respond(v_token::text, false);
    raise exception 'FALLO: se aceptó una respuesta repetida';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: el link de invitación sólo se puede responder una vez';
  end;

  -- anon no tiene acceso directo a las tablas del módulo
  begin
    perform count(*) from public.estoy_bien_contacts;
    raise exception 'FALLO: anon leyó contactos directamente';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: anon no accede a las tablas del módulo';
  end;

  begin
    perform public.estoy_bien_confirm(null, null);
    raise exception 'FALLO: anon pudo ejecutar confirm';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: confirm no está disponible para anon';
  end;

  reset role;

  if (select status from public.estoy_bien_contacts
       where user_id = '22222222-2222-2222-2222-222222222222') <> 'accepted' then
    raise exception 'FALLO: el contacto no quedó aceptado';
  end if;

  raise notice 'OK: invitación con token, aceptación sin cuenta y cierre anon';
end
$$;

-- ------------------------------------------------------------
-- 13) RLS: cada usuario sólo ve lo suyo y escribe vía RPC
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';

  select count(*) into v_count from public.estoy_bien_settings;
  if v_count <> 1 then
    raise exception 'FALLO: Bruno ve configuraciones ajenas (%)', v_count;
  end if;

  select count(*) into v_count from public.estoy_bien_checks;
  if (select count(*) from public.estoy_bien_checks
       where user_id <> '22222222-2222-2222-2222-222222222222') <> 0 then
    raise exception 'FALLO: Bruno ve confirmaciones ajenas';
  end if;

  select count(*) into v_count from public.estoy_bien_alerts;
  if (select count(*) from public.estoy_bien_alerts
       where user_id <> '22222222-2222-2222-2222-222222222222') <> 0 then
    raise exception 'FALLO: Bruno ve alertas ajenas';
  end if;

  begin
    insert into public.estoy_bien_checks (user_id, cycle_date)
    values ('22222222-2222-2222-2222-222222222222', '2026-04-01');
    raise exception 'FALLO: el cliente insertó una confirmación';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: las confirmaciones se crean sólo vía RPC';
  end;

  begin
    update public.estoy_bien_alerts set status = 'resolved';
    raise exception 'FALLO: el cliente modificó alertas';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: las alertas sólo las cambia el servidor';
  end;

  begin
    perform public.estoy_bien_tick();
    raise exception 'FALLO: el cliente ejecutó el tick';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: el tick sólo corre desde el servidor';
  end;

  -- El p_user_id del cliente se ignora: manda el JWT
  perform public.estoy_bien_confirm('11111111-1111-1111-1111-111111111111', null);

  if not exists (
    select 1 from public.estoy_bien_checks
     where user_id = '22222222-2222-2222-2222-222222222222'
       and cycle_date = (now() at time zone 'America/Argentina/Buenos_Aires')::date
  ) then
    raise exception 'FALLO: la confirmación no quedó para el usuario del JWT';
  end if;
  if exists (
    select 1 from public.estoy_bien_checks
     where user_id = '11111111-1111-1111-1111-111111111111'
       and cycle_date = (now() at time zone 'America/Argentina/Buenos_Aires')::date
  ) then
    raise exception 'FALLO: se confirmó en nombre de otro usuario';
  end if;

  raise notice 'OK: RLS del módulo y suplantación imposible';
end
$$;

-- ------------------------------------------------------------
-- 14) Guardas de las RPC con parámetros de servidor
-- ------------------------------------------------------------
do $$
begin
  -- Con JWT sin usuario: no se puede elegir víctima
  set request.jwt.claims to '{"role":"authenticated"}';
  begin
    perform public.estoy_bien_get_state('11111111-1111-1111-1111-111111111111', null);
    raise exception 'FALLO: se permitió elegir usuario con un JWT sin sub';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: sin sub en el JWT no se puede apuntar a otro usuario';
  end;
  reset request.jwt.claims;

  -- service_role (Edge Function) sí puede usar los parámetros de servidor
  set request.jwt.claims to '{"role":"service_role"}';
  perform public.estoy_bien_get_state(
    '22222222-2222-2222-2222-222222222222', '2026-03-11 21:35:00-03');
  reset request.jwt.claims;

  raise notice 'OK: service_role conserva el acceso de servidor a las RPC';
end
$$;

do $$
begin
  raise notice '=== PRUEBAS FASE 12 (ESTOY BIEN): OK ===';
  raise notice '=== TODAS LAS PRUEBAS DE BASE DE DATOS PASARON ===';
end
$$;
