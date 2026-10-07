-- ============================================================
-- 0015_subscription_refresh_fix.sql
-- FASE 16 - Fix de refresh_subscription_states(): el segundo UPDATE
-- usaba un CASE con literales de texto y la columna es el enum
-- subscription_status, así que la función fallaba siempre que se
-- ejecutaba ("column status is of type subscription_status but
-- expression is of type text"). Nadie lo vio antes porque no había
-- ningún cron que la llamara (recién se agenda en
-- 0014_subscription_cron.sql).
--
-- Aplicar en Supabase ANTES de agendar/activar el cron de la 0014.
-- ============================================================

create or replace function public.refresh_subscription_states()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer := 0;
  v_aux integer := 0;
begin
  update public.user_subscriptions
     set status = 'expired'::public.subscription_status
   where status = 'trial'
     and trial_ends_at is not null
     and trial_ends_at <= now();
  get diagnostics v_count = row_count;

  update public.user_subscriptions
     set status = case
                    when cancel_at_period_end then 'canceled'::public.subscription_status
                    else 'past_due'::public.subscription_status
                  end,
         updated_at = now()
   where status = 'active'
     and current_period_end is not null
     and current_period_end <= now();
  get diagnostics v_aux = row_count;

  return v_count + v_aux;
end;
$$;

-- Verificación
do $$
begin
  if (select prosrc from pg_proc where proname = 'refresh_subscription_states') like '%::public.subscription_status%' then
    raise notice 'OK: refresh_subscription_states() reemplazada con el cast al enum.';
  else
    raise exception 'FALLO: refresh_subscription_states() no quedó con el cast al enum';
  end if;
end
$$;
