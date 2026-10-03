-- ============================================================
-- 10_tests.sql
-- Pruebas de seguridad y reglas de negocio sobre el esquema real.
-- Cada bloque lanza una excepción si la regla no se cumple.
-- ============================================================

-- Datos base: 4 vecinos (el trigger de alta crea perfil + prueba de 7 días).
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'ana@ejemplo.com',   '{"full_name":"Ana Perez"}'),
  ('22222222-2222-2222-2222-222222222222', 'bruno@ejemplo.com', '{"full_name":"Bruno Diaz"}'),
  ('33333333-3333-3333-3333-333333333333', 'carla@ejemplo.com', '{"full_name":"Carla Ruiz"}'),
  ('44444444-4444-4444-4444-444444444444', 'diego@ejemplo.com', '{"full_name":"Diego Sosa"}')
on conflict do nothing;

-- ------------------------------------------------------------
do $$
declare
  v_count integer;
  v_days numeric;
begin
  select count(*) into v_count from public.profiles;
  if v_count < 4 then
    raise exception 'FALLO: no se crearon los perfiles en el alta (%)', v_count;
  end if;

  select count(*) into v_count
    from public.user_subscriptions
   where status = 'trial'
     and trial_started_at is not null
     and trial_ends_at is not null;
  if v_count < 4 then
    raise exception 'FALLO: la prueba no se creó en el servidor (%)', v_count;
  end if;

  select extract(epoch from (trial_ends_at - trial_started_at)) / 86400
    into v_days
    from public.user_subscriptions
   where user_id = '11111111-1111-1111-1111-111111111111';

  if v_days is null or v_days < 6.99 or v_days > 7.01 then
    raise exception 'FALLO: la prueba no dura 7 días (%)', v_days;
  end if;

  raise notice 'OK: alta crea perfil y prueba de 7 días en el servidor';
end
$$;

-- ------------------------------------------------------------
-- El cliente no puede modificar su propia suscripción ni su estado de pago
-- ------------------------------------------------------------
do $$
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  begin
    update public.user_subscriptions
       set status = 'active'
     where user_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FALLO: el cliente pudo modificar su suscripción';
  exception
    when insufficient_privilege then
      raise notice 'OK: el cliente no puede modificar su suscripción';
  end;

  begin
    insert into public.payment_events (user_subscription_id, event_type, provider_event_id, status)
    select id, 'payment', 'fake-1', 'approved' from public.user_subscriptions
     where user_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FALLO: el cliente pudo insertar un pago';
  exception
    when insufficient_privilege then
      raise notice 'OK: el cliente no puede insertar eventos de pago';
  end;

  begin
    update public.profiles set role = 'admin_general'
     where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FALLO: el cliente pudo autoasignarse administrador';
  exception
    when insufficient_privilege then
      raise notice 'OK: el cliente no puede cambiar su rol';
  end;

  begin
    update public.user_subscriptions
       set trial_ends_at = now() + interval '365 days'
     where user_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FALLO: el cliente pudo extender su prueba';
  exception
    when insufficient_privilege then
      raise notice 'OK: el cliente no puede extender la prueba';
  end;

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- Comunidad A: creación e invitación
-- ------------------------------------------------------------
do $$
declare
  v_community uuid;
  v_token text;
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  v_community := public.create_community('Barrio Norte');
  if v_community is null then
    raise exception 'FALLO: create_community no devolvió id';
  end if;

  if not exists (
    select 1 from public.community_members
     where community_id = v_community
       and user_id = '11111111-1111-1111-1111-111111111111'
       and role = 'admin' and membership_status = 'active'
  ) then
    raise exception 'FALLO: el creador no quedó como administrador activo';
  end if;

  v_token := public.generate_invite(v_community, 3600, 10);
  if v_token is null or char_length(v_token) < 32 then
    raise exception 'FALLO: generate_invite no devolvió un token';
  end if;

  if exists (select 1 from public.community_invites where token_hash = v_token) then
    raise exception 'FALLO: se guardó el token en claro';
  end if;

  perform set_config('test.token_a', v_token, false);

  -- Bruno (2) se une con el código
  set request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';
  perform public.join_community(v_token);

  if not exists (
    select 1 from public.community_members
     where community_id = v_community
       and user_id = '22222222-2222-2222-2222-222222222222'
       and membership_status = 'active'
  ) then
    raise exception 'FALLO: Bruno no quedó activo en la comunidad';
  end if;

  -- Carla (3) crea su propia comunidad y no puede unirse a una segunda
  set request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333"}';
  perform public.create_community('Barrio Sur');

  begin
    perform public.join_community(v_token);
    raise exception 'FALLO: se permitió pertenecer a dos comunidades';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: una sola comunidad por usuario';
  end;

  reset role;
  reset request.jwt.claims;
  perform set_config('test.community_a', v_community::text, false);
end
$$;

-- ------------------------------------------------------------
-- Alarma: registro idempotente + destinatarios sólo activos
-- ------------------------------------------------------------
do $$
declare
  v_community uuid := current_setting('test.community_a', true);
  v_token text := current_setting('test.token_a', true);
  v_first jsonb;
  v_second jsonb;
  v_count integer;
  v_alert uuid;
begin
  set role authenticated;

  -- Carla ya tiene su comunidad (Barrio Sur): no debe ver alertas de Ana
  set request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333"}';
  reset role;

  -- Ana dispara la alarma (misma clave = reintento)
  set role authenticated;
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  v_first := public.trigger_alert(v_community, 'idem-key-0001', null, null);
  v_second := public.trigger_alert(v_community, 'idem-key-0001', null, null);

  if (v_first ->> 'alert_id') <> (v_second ->> 'alert_id') then
    raise exception 'FALLO: el reintento no devolvió la misma alerta';
  end if;

  if (v_second ->> 'duplicate') <> 'true' then
    raise exception 'FALLO: el reintento no se marcó como duplicado';
  end if;

  select count(*) into v_count from public.alerts where community_id = v_community;
  if v_count <> 1 then
    raise exception 'FALLO: se duplicaron alertas (%)', v_count;
  end if;

  v_alert := (v_first ->> 'alert_id')::uuid;

  -- Destinatarios: sólo Bruno (activo); Carla es de otra comunidad
  select count(*) into v_count from public.alert_recipients where alert_id = v_alert;
  if v_count <> 1 then
    raise exception 'FALLO: destinatarios incorrectos (%)', v_count;
  end if;

  if not exists (
    select 1 from public.alert_recipients
     where alert_id = v_alert and recipient_user_id = '22222222-2222-2222-2222-222222222222'
  ) then
    raise exception 'FALLO: Bruno debía recibir la alerta';
  end if;

  -- Cooldown: otra clave en menos de 10 segundos debe fallar
  begin
    perform public.trigger_alert(v_community, 'idem-key-0002', null, null);
    raise exception 'FALLO: se permitió una alerta inmediata con otra clave';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: alarma idempotente y con cooldown de 10s';
  end;

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- Aislamiento entre comunidades + sin escritura directa de alertas
-- ------------------------------------------------------------
do $$
declare
  v_foreign integer;
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333"}';

  select count(*) into v_foreign from public.alerts;
  if v_foreign <> 0 then
    raise exception 'FALLO: Carla vio alertas ajenas (%)', v_foreign;
  end if;

  begin
    insert into public.alerts (community_id, triggered_by, idempotency_key)
    values (current_setting('test.community_a', true)::uuid,
            '33333333-3333-3333-3333-333333333333', 'spoof-key-1');
    raise exception 'FALLO: se permitió insertar alertas directamente';
  exception
    when insufficient_privilege then
      raise notice 'OK: sin escritura directa de alertas y sin lectura entre comunidades';
  end;

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- Suscripción vencida: sin alertas, pero emergencias y cuenta siguen
-- ------------------------------------------------------------
do $$
declare
  v_community uuid := current_setting('test.community_a', true);
  v_count integer;
begin
  -- El servidor vence la prueba de Bruno
  update public.user_subscriptions
     set trial_ends_at = now() - interval '1 day'
   where user_id = '22222222-2222-2222-2222-222222222222';

  if public.is_entitled('22222222-2222-2222-2222-222222222222') then
    raise exception 'FALLO: una prueba vencida sigue siendo elegible';
  end if;

  insert into public.emergency_contacts (country_code, service_type, phone_number, source_url)
  values ('AR', 'police', '911', 'https://www.argentina.gob.ar')
  on conflict do nothing;

  set role authenticated;
  set request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';

  select count(*) into v_count from public.emergency_contacts where active;
  if v_count < 1 then
    raise exception 'FALLO: un usuario vencido perdió los contactos de emergencia';
  end if;

  begin
    perform public.trigger_alert(v_community, 'expired-key-1', null, null);
    raise exception 'FALLO: un usuario vencido activó una alerta';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: sin alertas con prueba vencida, emergencias disponibles';
  end;

  -- Sigue pudiendo consultar su suscripción y su perfil
  if public.get_my_subscription() is null then
    raise exception 'FALLO: el usuario vencido no puede ver su suscripción';
  end if;

  perform public.update_own_profile('Bruno D.', '');

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- Invitaciones: revocación, expiración y usos
-- ------------------------------------------------------------
do $$
declare
  v_community uuid := current_setting('test.community_a', true);
  v_token text;
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  v_token := public.generate_invite(v_community, 60, 1);
  perform public.revoke_invites(v_community);

  set request.jwt.claims to '{"sub":"44444444-4444-4444-4444-444444444444"}';
  begin
    perform public.join_community(v_token);
    raise exception 'FALLO: se usó una invitación revocada';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: invitaciones revocadas e impredecibles';
  end;

  -- Un vecino no admin no puede generar invitaciones
  set request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';
  begin
    perform public.generate_invite(v_community, 60, 1);
    raise exception 'FALLO: un integrante no admin generó invitaciones';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: sólo el admin gestiona invitaciones';
  end;

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- Administración general
-- ------------------------------------------------------------
do $$
declare
  v_plan uuid;
  v_metrics jsonb;
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  begin
    perform public.admin_metrics();
    raise exception 'FALLO: un usuario común accedió al panel de administración';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: panel de administración protegido en el servidor';
  end;

  reset role;
  reset request.jwt.claims;

  -- Promoción desde el SQL editor (sin JWT = service role)
  perform public.admin_promote_by_email('ana@ejemplo.com');

  set role authenticated;
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  v_metrics := public.admin_metrics();
  if (v_metrics ->> 'users_total')::int < 4 then
    raise exception 'FALLO: métricas incompletas';
  end if;

  select id into v_plan from public.subscription_plans where active limit 1;
  perform public.admin_set_plan_price(v_plan, 2500);
  perform public.admin_set_plan(v_plan, 7, true);

  if not exists (select 1 from public.subscription_plans where id = v_plan and price_ars = 2500) then
    raise exception 'FALLO: no se actualizó el precio';
  end if;

  perform public.admin_upsert_emergency_contact('fire', '100', 'Buenos Aires', 'La Plata', 'Bomberos La Plata', 'https://ejemplo.gob.ar');

  if not exists (
    select 1 from public.emergency_contacts
     where service_type = 'fire' and locality = 'La Plata' and phone_number = '100'
  ) then
    raise exception 'FALLO: no se guardó el contacto de emergencia';
  end if;

  -- Restaurar precio "sin configurar" para no dejar valores ficticios
  perform public.admin_set_plan_price(v_plan, 0);

  reset role;
  reset request.jwt.claims;

  raise notice 'OK: administración general verificada en el servidor';
end
$$;

-- ------------------------------------------------------------
-- Web Push: registro de dispositivos
-- ------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_count integer;
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  v_id := public.register_push_subscription(
    'https://push.ejemplo.com/abc123',
    '{"endpoint":"https://push.ejemplo.com/abc123","keys":{"p256dh":"clave","auth":"auth"}}'::jsonb,
    'Test Agent'
  );

  if v_id is null then
    raise exception 'FALLO: no se registró la suscripción push';
  end if;

  -- Re-registro del mismo endpoint no duplica
  perform public.register_push_subscription(
    'https://push.ejemplo.com/abc123',
    '{"endpoint":"https://push.ejemplo.com/abc123","keys":{"p256dh":"clave2","auth":"auth2"}}'::jsonb,
    'Test Agent'
  );

  select count(*) into v_count
    from public.push_subscriptions
   where endpoint = 'https://push.ejemplo.com/abc123' and revoked_at is null;
  if v_count <> 1 then
    raise exception 'FALLO: la suscripción push se duplicó (%)', v_count;
  end if;

  -- Otro usuario no ve dispositivos ajenos
  set request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333"}';
  select count(*) into v_count
    from push_subscriptions
   where endpoint = 'https://push.ejemplo.com/abc123';
  if v_count <> 0 then
    raise exception 'FALLO: se filtró una suscripción push ajena';
  end if;

  reset role;
  reset request.jwt.claims;
  raise notice 'OK: dispositivos push propios y aislados';
end
$$;

-- ------------------------------------------------------------
-- Perfiles: visibles entre vecinos de la misma comunidad
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  set role authenticated;

  -- Bruno (sin rol admin) ve a Ana (mismo barrio), pero no a Carla (barrio ajeno)
  set request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';
  select count(*) into v_count
    from public.profiles
   where id = '11111111-1111-1111-1111-111111111111';
  if v_count <> 1 then
    raise exception 'FALLO: no se ve el perfil de un vecino (%)', v_count;
  end if;

  select count(*) into v_count
    from public.profiles
   where id = '33333333-3333-3333-3333-333333333333';
  if v_count <> 0 then
    raise exception 'FALLO: se filtró el perfil de un vecino de otro barrio';
  end if;

  -- Sin comunidad no se ve a nadie más
  set request.jwt.claims to '{"sub":"44444444-4444-4444-4444-444444444444"}';
  select count(*) into v_count from public.profiles;
  if v_count <> 1 then
    raise exception 'FALLO: un usuario sin comunidad ve perfiles ajenos (%)', v_count;
  end if;

  reset role;
  reset request.jwt.claims;
  raise notice 'OK: perfiles visibles sólo entre vecinos';
end
$$;

-- ------------------------------------------------------------
-- Emergencias: números oficiales sembrados con fuente verificada
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from public.emergency_contacts
   where active
     and source_url like 'https://www.argentina.gob.ar%'
     and phone_number in ('911', '100', '107');

  if v_count < 3 then
    raise exception 'FALLO: faltan números oficiales de emergencia sembrados (%)', v_count;
  end if;

  raise notice 'OK: números oficiales de emergencia con fuente oficial';
end
$$;

do $$
begin
  raise notice '=== TODAS LAS PRUEBAS DE BASE DE DATOS PASARON ===';
end
$$;
