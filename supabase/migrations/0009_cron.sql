-- ============================================================
-- 0009_cron.sql
-- FASE 12 · Cron de "Estoy Bien": cada minuto corre el tick de
-- transiciones y llama a la Edge Function que envía los Web Push.
--
-- Requisitos (dashboard de Supabase):
--   1) Database → Extensions: habilitar pg_cron y pg_net.
--   2) SQL Editor: guardar el service role key como secreto:
--        select vault.create_secret('TU_SERVICE_ROLE_KEY', 'estoy_bien_service_key');
--      (Traelo desde Project Settings → API → service_role.)
--   3) Edge Functions → Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
--      y VAPID_SUBJECT (ya usados por trigger-alert).
--
-- Este archivo NO entra en el harness local (no hay pg_cron en el
-- clúster de prueba). Ejecutarlo sólo en Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Extensiones (si el dashboard no las creó antes)
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

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    create extension if not exists pg_net;
    raise notice 'pg_net creado';
  end if;
exception when others then
  raise notice 'No se pudo crear pg_net (%). Habilitá la extensión desde el dashboard.', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 2) Job único: tick + envío de push (idempotente)
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('cron.schedule(text, text, text)') is null then
    raise notice 'cron.schedule no existe: pg_cron sigue sin habilitar.';
    return;
  end if;

  begin
    perform cron.unschedule('estoy-bien');
  exception when others then
    null; -- aún no existía
  end;

  perform cron.schedule(
    'estoy-bien',
    '* * * * *',
    $job$
    select public.estoy_bien_tick();

    select net.http_post(
      url := 'https://kbzyeiymvlzjyuepujvy.supabase.co/functions/v1/estoy-bien-deliver',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'estoy_bien_service_key'),
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'estoy_bien_service_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 15000
    ) as request_id;
    $job$
  );

  raise notice 'Job "estoy-bien" agendado (cada minuto).';
end $$;

-- ------------------------------------------------------------
-- 3) Verificación
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('cron.schedule(text, text, text)') is not null then
    if exists (select 1 from cron.job where jobname = 'estoy-bien') then
      raise notice 'OK: el cron de Estoy Bien está activo.';
    else
      raise notice 'AVISO: no aparece el job "estoy-bien" en cron.job.';
    end if;
  end if;
end $$;
