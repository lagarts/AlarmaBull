-- ============================================================
-- 16_subscription_states.sql
-- FASE 16 - refresh_subscription_states() (la llama el cron horario
-- de 0014_subscription_cron.sql): vence pruebas, pasa a "canceled"
-- los períodos cancelados y a "past_due" los vencidos sin cancelar.
-- Cada bloque lanza una excepción si la regla no se cumple.
-- ============================================================

reset role;
reset request.jwt.claims;

-- ------------------------------------------------------------
-- 1) Fixtures: 4 usuarios (el trigger crea perfil + prueba de 7 días)
-- ------------------------------------------------------------
do $$
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    ('55555555-5555-5555-5555-555555555555', 'eva@ejemplo.com',    '{"full_name":"Eva Prueba"}'),
    ('66666666-6666-6666-6666-666666666666', 'fausto@ejemplo.com', '{"full_name":"Fausto Prueba"}'),
    ('77777777-7777-7777-7777-777777777777', 'gina@ejemplo.com',   '{"full_name":"Gina Prueba"}'),
    ('88888888-8888-8888-8888-888888888888', 'hugo@ejemplo.com',   '{"full_name":"Hugo Prueba"}')
  on conflict (id) do nothing;

  if (select count(*) from public.user_subscriptions
       where user_id in ('55555555-5555-5555-5555-555555555555',
                         '66666666-6666-6666-6666-666666666666',
                         '77777777-7777-7777-7777-777777777777',
                         '88888888-8888-8888-8888-888888888888')) <> 4 then
    raise exception 'FALLO: no se crearon las suscripciones de prueba';
  end if;

  raise notice 'OK: fixtures de suscripciones creadas';
end
$$;

-- ------------------------------------------------------------
-- 2) Estados vencidos -> refresh_subscription_states()
-- ------------------------------------------------------------
do $$
declare
  v_status text;
begin
  -- Eva: prueba vencida -> expired
  update public.user_subscriptions
     set status = 'trial',
         trial_started_at = now() - interval '10 days',
         trial_ends_at = now() - interval '3 days',
         current_period_start = null,
         current_period_end = null,
         cancel_at_period_end = false
   where user_id = '55555555-5555-5555-5555-555555555555';

  -- Fausto: activo con período vencido y cancelación pendiente -> canceled
  update public.user_subscriptions
     set status = 'active',
         trial_ends_at = null,
         current_period_start = now() - interval '40 days',
         current_period_end = now() - interval '10 days',
         cancel_at_period_end = true
   where user_id = '66666666-6666-6666-6666-666666666666';

  -- Gina: activo con período vencido sin cancelar -> past_due
  update public.user_subscriptions
     set status = 'active',
         trial_ends_at = null,
         current_period_start = now() - interval '40 days',
         current_period_end = now() - interval '10 days',
         cancel_at_period_end = false
   where user_id = '77777777-7777-7777-7777-777777777777';

  -- Hugo: activo con período futuro -> no cambia
  update public.user_subscriptions
     set status = 'active',
         trial_ends_at = null,
         current_period_start = now() - interval '20 days',
         current_period_end = now() + interval '10 days',
         cancel_at_period_end = false
   where user_id = '88888888-8888-8888-8888-888888888888';

  perform public.refresh_subscription_states();

  select status into v_status
    from public.user_subscriptions
   where user_id = '55555555-5555-5555-5555-555555555555';
  if v_status <> 'expired' then
    raise exception 'FALLO: la prueba vencida no pasó a expired (%)', v_status;
  end if;
  raise notice 'OK: la prueba vencida pasa a expired';

  select status into v_status
    from public.user_subscriptions
   where user_id = '66666666-6666-6666-6666-666666666666';
  if v_status <> 'canceled' then
    raise exception 'FALLO: el período cancelado vencido no pasó a canceled (%)', v_status;
  end if;
  raise notice 'OK: el período cancelado vencido pasa a canceled';

  select status into v_status
    from public.user_subscriptions
   where user_id = '77777777-7777-7777-7777-777777777777';
  if v_status <> 'past_due' then
    raise exception 'FALLO: el período vencido sin cancelar no pasó a past_due (%)', v_status;
  end if;
  raise notice 'OK: el período vencido sin cancelar pasa a past_due';

  select status into v_status
    from public.user_subscriptions
   where user_id = '88888888-8888-8888-8888-888888888888';
  if v_status <> 'active' then
    raise exception 'FALLO: el período vigente debía seguir activo (%)', v_status;
  end if;
  raise notice 'OK: el período vigente sigue activo';

  raise notice 'OK: refresh_subscription_states aplica vencimientos y cancelaciones';
end
$$;

-- ------------------------------------------------------------
-- 3) Limpieza
-- ------------------------------------------------------------
do $$
begin
  delete from public.user_subscriptions
   where user_id in ('55555555-5555-5555-5555-555555555555',
                     '66666666-6666-6666-6666-666666666666',
                     '77777777-7777-7777-7777-777777777777',
                     '88888888-8888-8888-8888-888888888888');
  delete from public.profiles
   where id in ('55555555-5555-5555-5555-555555555555',
                '66666666-6666-6666-6666-666666666666',
                '77777777-7777-7777-7777-777777777777',
                '88888888-8888-8888-8888-888888888888');
  delete from auth.users
   where id in ('55555555-5555-5555-5555-555555555555',
                '66666666-6666-6666-6666-666666666666',
                '77777777-7777-7777-7777-777777777777',
                '88888888-8888-8888-8888-888888888888');
  raise notice 'OK: limpieza de fixtures de suscripciones';
end
$$;
