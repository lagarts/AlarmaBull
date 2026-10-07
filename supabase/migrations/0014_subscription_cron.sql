-- ============================================================
-- 0014_subscription_cron.sql
-- FASE 16 - Cada hora se ejecuta refresh_subscription_states():
-- vence pruebas y períodos pagos que ninguna webhook alcanzó a
-- cerrar (cancelaciones, cobros rechazados, etc.).
--
-- Requisitos (dashboard de Supabase):
--   Database  Extensions: habilitar pg_cron (ya activo desde 0009_cron.sql).
--
-- Este archivo NO entra en el harness local (no hay pg_cron en el
-- clúster de prueba): la función que agenda se deja para Supabase y
-- la lógica de vencimientos se prueba en
-- tests/db/16_subscription_states.sql.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Extensión (por si el dashboard no la creó antes)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension if not exists pg_cron;
    raise notice 'pg_cron creado';
  end if;
exception when others then
  raise notice 'No se pudo crear pg_cron (%). Habilitá la extensión desde el dashboard.', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 2) Job horario (idempotente)
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('cron.schedule(text, text, text)') is null then
    raise notice 'cron.schedule no existe: pg_cron sigue sin habilitar.';
    return;
  end if;

  begin
    perform cron.unschedule('subscriptions-refresh');
  exception when others then
    null; -- aún no existía
  end;

  perform cron.schedule(
    'subscriptions-refresh',
    '15 * * * *',
    $job$
    select public.refresh_subscription_states();
    $job$
  );

  raise notice 'Job "subscriptions-refresh" agendado (cada hora, minuto 15).';
end $$;

-- ------------------------------------------------------------
-- 3) Verificación
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('cron.schedule(text, text, text)') is not null then
    if exists (select 1 from cron.job where jobname = 'subscriptions-refresh') then
      raise notice 'OK: el cron de suscripciones está activo.';
    else
      raise notice 'AVISO: no aparece el job "subscriptions-refresh" en cron.job.';
    end if;
  end if;
end $$;
