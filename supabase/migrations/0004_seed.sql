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
