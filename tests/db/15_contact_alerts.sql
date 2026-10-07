-- ============================================================
-- 15_contact_alerts.sql
-- FASE 15 — El aviso de alerta de Estoy Bien le llega por la app a
-- los contactos que aceptaron el link con cuenta (migración 0013):
-- campanita + fila de push, en vez de la fila de SMS/email que nunca
-- sale por no haber proveedor.
-- Cada bloque lanza una excepción si la regla no se cumple.
-- ============================================================

reset role;
reset request.jwt.claims;

-- ------------------------------------------------------------
-- 1) Fixtures: Diego activa Estoy Bien y carga 4 contactos
-- ------------------------------------------------------------
do $$
begin
  -- 10_tests borra a Diego con admin_delete_user: se da de alta de nuevo
  insert into auth.users (id, email, raw_user_meta_data)
  values ('44444444-4444-4444-4444-444444444444', 'diego@ejemplo.com',
          '{"full_name":"Diego Sosa"}')
  on conflict (id) do nothing;

  perform public.estoy_bien_save_settings(true, '20:00', 60,
    'America/Argentina/Buenos_Aires', true,
    '44444444-4444-4444-4444-444444444444', '2026-05-20 10:00:00-03');

  set role authenticated;
  set request.jwt.claims to '{"sub":"44444444-4444-4444-4444-444444444444"}';

  perform public.estoy_bien_save_contact(null, 'Contacto App',
    '1155551201', null, 'Vecina', 'sms');
  perform public.estoy_bien_save_contact(null, 'Contacto SMS',
    '1155551202', null, 'Hermano', 'sms');
  perform public.estoy_bien_save_contact(null, 'Contacto Rechaza',
    '1155551203', 'rechaza@ejemplo.com', 'Amigo', 'email');
  perform public.estoy_bien_save_contact(null, 'Contacto Dup',
    '1155551204', null, 'Primo', 'sms');

  reset role;
  reset request.jwt.claims;

  if (select count(*) from public.estoy_bien_contacts
       where user_id = '44444444-4444-4444-4444-444444444444') <> 4 then
    raise exception 'FALLO: no se crearon los 4 contactos de prueba';
  end if;

  raise notice 'OK: fixtures de contactos creados';
end
$$;

-- ------------------------------------------------------------
-- 2) Respuesta del link: aceptar exige cuenta, rechazar no
-- ------------------------------------------------------------
do $$
declare
  v_app_id uuid;
  v_app_token uuid;
  v_dup_id uuid;
  v_dup_token uuid;
  v_no_token uuid;
  v_status text;
begin
  select id, invite_token into v_app_id, v_app_token
    from public.estoy_bien_contacts
   where user_id = '44444444-4444-4444-4444-444444444444'
     and full_name = 'Contacto App';
  select id, invite_token into v_dup_id, v_dup_token
    from public.estoy_bien_contacts
   where user_id = '44444444-4444-4444-4444-444444444444'
     and full_name = 'Contacto Dup';
  select invite_token into v_no_token
    from public.estoy_bien_contacts
   where user_id = '44444444-4444-4444-4444-444444444444'
     and full_name = 'Contacto Rechaza';

  if v_app_id is null or v_dup_id is null or v_no_token is null then
    raise exception 'FALLO: faltan los contactos de prueba';
  end if;

  -- Aceptar sin cuenta no se puede
  set role anon;
  reset request.jwt.claims;
  begin
    perform public.estoy_bien_contact_respond(v_app_token::text, true);
    raise exception 'FALLO: se aceptó la invitación sin cuenta';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      if sqlerrm not like '%iniciar sesión%' then
        raise exception 'FALLO: error inesperado al aceptar sin cuenta (%)', sqlerrm;
      end if;
      raise notice 'OK: aceptar el link exige una cuenta en la app';
  end;

  -- Rechazar sigue pudiendo hacerse sin cuenta
  perform public.estoy_bien_contact_respond(v_no_token::text, false);
  reset role;

  if (select status from public.estoy_bien_contacts where invite_token = v_no_token)
     <> 'declined'
     or (select account_id from public.estoy_bien_contacts where invite_token = v_no_token)
     is not null then
    raise exception 'FALLO: el rechazo sin cuenta no quedó como se esperaba';
  end if;
  raise notice 'OK: rechazar el link sigue funcionando sin cuenta';

  -- El dueño no puede ser su propio contacto
  set role authenticated;
  set request.jwt.claims to '{"sub":"44444444-4444-4444-4444-444444444444"}';
  begin
    perform public.estoy_bien_contact_respond(v_dup_token::text, true);
    raise exception 'FALLO: el dueño aceptó ser contacto de sí mismo';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      if sqlerrm not like '%propio contacto%' then
        raise exception 'FALLO: error inesperado al aceptar como propio (%)', sqlerrm;
      end if;
      raise notice 'OK: nadie puede ser su propio contacto';
  end;

  -- Ana acepta con su cuenta
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';
  v_status := public.estoy_bien_contact_respond(v_app_token::text, true) ->> 'status';
  if v_status <> 'accepted' then
    raise exception 'FALLO: la aceptación con cuenta devolvió %', v_status;
  end if;

  -- La misma cuenta no puede ser contacto dos veces del mismo dueño
  begin
    perform public.estoy_bien_contact_respond(v_dup_token::text, true);
    raise exception 'FALLO: la misma cuenta quedó como contacto dos veces';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      if sqlerrm not like '%Ya sos contacto%' then
        raise exception 'FALLO: error inesperado en la duplicación (%)', sqlerrm;
      end if;
      raise notice 'OK: una cuenta no puede ser contacto dos veces del mismo dueño';
  end;

  reset role;
  reset request.jwt.claims;

  if (select account_id from public.estoy_bien_contacts where id = v_app_id)
     is distinct from '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'FALLO: la invitación no quedó ligada a la cuenta que aceptó';
  end if;
  raise notice 'OK: aceptar con sesión liga la invitación a la cuenta';
end
$$;

-- ------------------------------------------------------------
-- 3) Tick: al abrirse la alerta el contacto con cuenta recibe
--    campanita + push; los demás siguen en SMS/email pendiente
-- ------------------------------------------------------------
do $$
declare
  v_app uuid;
  v_sms uuid;
  v_no uuid;
  v_count integer;
  v_state text;
begin
  select id into v_app from public.estoy_bien_contacts
   where user_id = '44444444-4444-4444-4444-444444444444' and full_name = 'Contacto App';
  select id into v_sms from public.estoy_bien_contacts
   where user_id = '44444444-4444-4444-4444-444444444444' and full_name = 'Contacto SMS';
  select id into v_no from public.estoy_bien_contacts
   where user_id = '44444444-4444-4444-4444-444444444444' and full_name = 'Contacto Rechaza';

  -- 20:00 + 60 minutos de gracia: 21:30 ya pasó
  perform public.estoy_bien_tick('2026-05-20 21:30:00-03');

  v_state := (select status from public.estoy_bien_alerts
               where user_id = '44444444-4444-4444-4444-444444444444'
                 and cycle_date = '2026-05-20');
  if v_state is distinct from 'open' then
    raise exception 'FALLO: la alerta del dueño quedó en %', v_state;
  end if;
  raise notice 'OK: el tick abrió la alerta del dueño';

  -- Campanita del contacto con cuenta (sólo ese aviso, texto propio)
  select count(*) into v_count from public.notifications
   where user_id = '11111111-1111-1111-1111-111111111111'
     and title = 'Estoy bien: sin confirmación'
     and body = 'Diego Sosa no confirmó que está bien. Si podés, contactalo.';
  if v_count <> 1 then
    raise exception 'FALLO: campanita del contacto con cuenta = %', v_count;
  end if;
  raise notice 'OK: el contacto con cuenta recibe el aviso en la campanita';

  -- Y las dos filas de envío (in_app ya enviado, push en cola), con link
  select count(*) into v_count from public.estoy_bien_reminders
   where contact_id = v_app
     and user_id = '11111111-1111-1111-1111-111111111111'
     and cycle_date = '2026-05-20'
     and kind = 'alert'
     and channel in ('in_app', 'push')
     and url = '/inicio';
  if v_count <> 2 then
    raise exception 'FALLO: filas in_app+push del contacto = %', v_count;
  end if;

  if (select status from public.estoy_bien_reminders
       where contact_id = v_app and channel = 'in_app' and kind = 'alert')
     is distinct from 'sent' then
    raise exception 'FALLO: la fila in_app del contacto no quedó enviada';
  end if;
  if (select status from public.estoy_bien_reminders
       where contact_id = v_app and channel = 'push' and kind = 'alert')
     is distinct from 'pending' then
    raise exception 'FALLO: la fila push del contacto no quedó en cola';
  end if;
  raise notice 'OK: el contacto con cuenta queda con in_app enviado y push en cola';

  -- Con cuenta no se crea la fila de SMS/email muerta
  select count(*) into v_count from public.estoy_bien_reminders
   where contact_id = v_app and channel in ('sms', 'email');
  if v_count <> 0 then
    raise exception 'FALLO: había filas SMS/email para un contacto con cuenta (%)', v_count;
  end if;
  raise notice 'OK: el contacto con cuenta no acumula filas SMS/email';

  -- Sin cuenta: sigue la fila de SMS pendiente (hasta que haya proveedor)
  select count(*) into v_count from public.estoy_bien_reminders
   where contact_id = v_sms
     and user_id = '44444444-4444-4444-4444-444444444444'
     and kind = 'alert'
     and channel = 'sms'
     and status = 'pending'
     and last_error = 'sin proveedor de SMS/email configurado';
  if v_count <> 1 then
    raise exception 'FALLO: fila SMS del contacto sin cuenta = %', v_count;
  end if;
  raise notice 'OK: el contacto sin cuenta queda pendiente de proveedor de SMS';

  -- El que rechazó no recibe nada
  select count(*) into v_count from public.estoy_bien_reminders
   where contact_id = v_no;
  if v_count <> 0 then
    raise exception 'FALLO: el contacto que rechazó recibió % filas', v_count;
  end if;
  raise notice 'OK: el contacto que rechazó no recibe avisos';

  -- Idempotencia: otro tick no duplica nada
  perform public.estoy_bien_tick('2026-05-20 21:35:00-03');

  select count(*) into v_count from public.notifications
   where user_id = '11111111-1111-1111-1111-111111111111'
     and body = 'Diego Sosa no confirmó que está bien. Si podés, contactalo.';
  if v_count <> 1 then
    raise exception 'FALLO: el tick duplicó la campanita (%)', v_count;
  end if;

  select count(*) into v_count from public.estoy_bien_reminders
   where contact_id = v_app and kind = 'alert';
  if v_count <> 2 then
    raise exception 'FALLO: el tick duplicó las filas del contacto (%)', v_count;
  end if;
  raise notice 'OK: el tick de alerta es idempotente para los contactos';
end
$$;

-- ------------------------------------------------------------
-- 4) Confirmación: al resolverse, el contacto con cuenta recibe
--    el aviso de resolución por la app
-- ------------------------------------------------------------
do $$
declare
  v_app uuid;
  v_sms uuid;
  v_no uuid;
  v_count integer;
begin
  select id into v_app from public.estoy_bien_contacts
   where user_id = '44444444-4444-4444-4444-444444444444' and full_name = 'Contacto App';
  select id into v_sms from public.estoy_bien_contacts
   where user_id = '44444444-4444-4444-4444-444444444444' and full_name = 'Contacto SMS';
  select id into v_no from public.estoy_bien_contacts
   where user_id = '44444444-4444-4444-4444-444444444444' and full_name = 'Contacto Rechaza';

  reset role;
  reset request.jwt.claims;

  -- El dueño confirma por el camino del servidor (sin JWT)
  perform public.estoy_bien_confirm(
    '44444444-4444-4444-4444-444444444444', '2026-05-20 21:40:00-03');

  if (select status from public.estoy_bien_alerts
       where user_id = '44444444-4444-4444-4444-444444444444'
         and cycle_date = '2026-05-20') is distinct from 'resolved' then
    raise exception 'FALLO: la confirmación no cerró la alerta';
  end if;

  -- Campanita de resolución para el contacto con cuenta
  select count(*) into v_count from public.notifications
   where user_id = '11111111-1111-1111-1111-111111111111'
     and title = 'Estoy bien: alerta resuelta'
     and body = 'Diego Sosa confirmó que está bien.';
  if v_count <> 1 then
    raise exception 'FALLO: campanita de resolución del contacto = %', v_count;
  end if;
  raise notice 'OK: el contacto con cuenta recibe la resolución en la campanita';

  select count(*) into v_count from public.estoy_bien_reminders
   where contact_id = v_app
     and user_id = '11111111-1111-1111-1111-111111111111'
     and kind = 'resolved'
     and channel in ('in_app', 'push')
     and url = '/inicio';
  if v_count <> 2 then
    raise exception 'FALLO: filas de resolución del contacto = %', v_count;
  end if;

  if (select status from public.estoy_bien_reminders
       where contact_id = v_app and kind = 'resolved' and channel = 'in_app')
     is distinct from 'sent'
     or (select status from public.estoy_bien_reminders
       where contact_id = v_app and kind = 'resolved' and channel = 'push')
     is distinct from 'pending' then
    raise exception 'FALLO: estados de la resolución del contacto';
  end if;
  raise notice 'OK: la resolución llega por la app (in_app enviado, push en cola)';

  -- Sin cuenta: fila de SMS pendiente de proveedor
  select count(*) into v_count from public.estoy_bien_reminders
   where contact_id = v_sms
     and kind = 'resolved'
     and channel = 'sms'
     and status = 'pending'
     and last_error = 'sin proveedor de SMS/email configurado';
  if v_count <> 1 then
    raise exception 'FALLO: fila SMS de resolución = %', v_count;
  end if;
  raise notice 'OK: sin cuenta la resolución queda pendiente de SMS';

  -- El que rechazó, nada
  select count(*) into v_count from public.estoy_bien_reminders
   where contact_id = v_no;
  if v_count <> 0 then
    raise exception 'FALLO: el contacto que rechazó recibió % filas', v_count;
  end if;
  raise notice 'OK: el contacto que rechazó no recibe la resolución';
end
$$;

do $$
begin
  raise notice '=== PRUEBAS FASE 15 (CONTACTOS POR LA APP): OK ===';
  raise notice '=== TODAS LAS PRUEBAS DE BASE DE DATOS PASARON ===';
end
$$;
