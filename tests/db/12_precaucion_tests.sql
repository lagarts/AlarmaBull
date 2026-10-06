-- ============================================================
-- 12_precaucion_tests.sql
-- FASE 13 · Pruebas del aviso de PRECAUCIÓN con mensaje libre.
-- Cada bloque lanza una excepción si la regla no se cumple.
-- ============================================================

reset role;
reset request.jwt.claims;

-- ------------------------------------------------------------
-- 1) Validaciones del mensaje
-- ------------------------------------------------------------
do $$
declare
  v_community uuid;
begin
  select c.id into v_community
    from public.community_members m
    join public.communities c on c.id = m.community_id
   where m.user_id = '11111111-1111-1111-1111-111111111111'
     and m.membership_status = 'active'
   order by c.created_at
   limit 1;

  if v_community is null then
    raise exception 'FALLO: no se encontró la comunidad de Ana';
  end if;

  perform set_config('test.community_precaucion', v_community::text, false);

  set role authenticated;
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  begin
    perform public.trigger_alert(v_community, 'precau-key-a-01', null, null, 'precaucion', '  ');
    raise exception 'FALLO: se mandó un aviso sin mensaje';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: el aviso de precaución exige mensaje';
  end;

  begin
    perform public.trigger_alert(v_community, 'precau-key-a-02', null, null,
                                 'precaucion', repeat('a', 201));
    raise exception 'FALLO: se aceptó un mensaje de más de 200 caracteres';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: el mensaje se limita a 200 caracteres';
  end;

  begin
    perform public.trigger_alert(v_community, 'precau-key-a-03', null, null, 'invasion', 'hola');
    raise exception 'FALLO: se aceptó un tipo de aviso inválido';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: tipos y mensajes validados';
  end;

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- 2) Aviso válido: se guarda con su mensaje y sus destinatarios
-- ------------------------------------------------------------
do $$
declare
  v_community uuid := current_setting('test.community_precaucion', true);
  v_result jsonb;
  v_alert uuid;
  v_message text;
  v_severity text;
  v_recipients integer;
  v_jobs integer;
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  v_result := public.trigger_alert(v_community, 'precau-key-a-10', null, null,
                                   'precaucion', 'Hay un auto rojo dando vuelta en la esquina');

  if v_result ->> 'severity' <> 'precaucion' then
    raise exception 'FALLO: la respuesta no marca la severidad (%)', v_result;
  end if;

  v_alert := (v_result ->> 'alert_id')::uuid;

  select severity::text, message into v_severity, v_message
    from public.alerts
   where id = v_alert;

  if v_severity <> 'precaucion' then
    raise exception 'FALLO: la alerta quedó con severidad %', v_severity;
  end if;

  if v_message <> 'Hay un auto rojo dando vuelta en la esquina' then
    raise exception 'FALLO: no se guardó el mensaje (%)', v_message;
  end if;

  select count(*) into v_recipients from public.alert_recipients where alert_id = v_alert;
  if v_recipients < 1 then
    raise exception 'FALLO: el aviso no tiene destinatarios (%)', v_recipients;
  end if;

  select count(*) into v_jobs from public.notification_jobs where alert_id = v_alert;
  if v_jobs <> v_recipients then
    raise exception 'FALLO: jobs de notificación inconsistentes (% vs %)', v_jobs, v_recipients;
  end if;

  raise notice 'OK: aviso con mensaje, destinatarios y jobs de notificación';

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- 3) Cooldowns separados: un aviso no bloquea una alerta
--    (Bruno no había alertado antes, así que el estado es limpio)
-- ------------------------------------------------------------
do $$
declare
  -- Carla tiene su propia comunidad (Barrio Sur) y nunca alertó:
  -- estado de cooldown limpio para probar la separación.
  v_community uuid;
  v_result jsonb;
  v_alert uuid;
  v_severity text;
  v_message text;
begin
  select c.id into v_community
    from public.community_members m
    join public.communities c on c.id = m.community_id
   where m.user_id = '33333333-3333-3333-3333-333333333333'
     and m.membership_status = 'active'
   order by c.created_at
   limit 1;

  if v_community is null then
    raise exception 'FALLO: no se encontró la comunidad de Carla';
  end if;

  set role authenticated;
  set request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333"}';

  -- Aviso de Carla: entra de una.
  v_result := public.trigger_alert(v_community, 'precau-key-c-01', null, null,
                                   'precaucion', 'Ruido fuerte en la cuadra');
  if v_result ->> 'severity' <> 'precaucion' then
    raise exception 'FALLO: el aviso de Carla no quedó como precaución (%)', v_result;
  end if;

  -- Segundo aviso con otra clave en menos de 15 s: cooldown propio.
  begin
    perform public.trigger_alert(v_community, 'precau-key-c-02', null, null,
                                 'precaucion', 'Otro mensaje');
    raise exception 'FALLO: se permitió un segundo aviso inmediato';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: el aviso tiene cooldown propio de 15 s';
  end;

  -- La alerta roja NO está bloqueada por el aviso que acaba de mandar
  -- (y cualquier mensaje que le llegue se descarta).
  v_result := public.trigger_alert(v_community, 'alerta-key-c-01', null, null,
                                   'alerta', 'este mensaje no va');
  v_alert := (v_result ->> 'alert_id')::uuid;

  select severity::text, message into v_severity, v_message
    from public.alerts
   where id = v_alert;

  if v_severity <> 'alerta' then
    raise exception 'FALLO: la alerta quedó con severidad %', v_severity;
  end if;

  if v_message is not null then
    raise exception 'FALLO: la alerta roja guardó mensaje (%)', v_message;
  end if;

  raise notice 'OK: el aviso no bloquea la alerta vecinal (cooldowns separados)';

  -- La alerta roja mantiene su cooldown de 10 s.
  begin
    perform public.trigger_alert(v_community, 'alerta-key-c-02', null, null, 'alerta', null);
    raise exception 'FALLO: se permitió una alerta inmediata con otra clave';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: la alerta roja conserva su cooldown de 10 s';
  end;

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- 4) El cliente no puede escribir severidad ni mensaje a mano
-- ------------------------------------------------------------
do $$
declare
  v_community uuid := current_setting('test.community_precaucion', true);
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"44444444-4444-4444-4444-444444444444"}';

  begin
    insert into public.alerts (community_id, triggered_by, idempotency_key, severity, message)
    values (v_community, '44444444-4444-4444-4444-444444444444', 'manual-key-0001',
            'precaucion', 'aviso inventado');
    raise exception 'FALLO: el cliente pudo crear una alerta a mano';
  exception
    when insufficient_privilege then
      raise notice 'OK: no se puede insertar en alerts desde el cliente';
  end;

  begin
    update public.alerts
       set severity = 'precaucion', message = 'editado'
     where community_id = v_community;
    raise exception 'FALLO: el cliente pudo editar severidad y mensaje';
  exception
    when insufficient_privilege then
      raise notice 'OK: no se puede editar severity/message desde el cliente';
  end;

  reset role;
  reset request.jwt.claims;
end
$$;
