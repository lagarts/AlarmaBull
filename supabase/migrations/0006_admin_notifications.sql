-- ============================================================
-- 0006_admin_notifications.sql
-- FASE 11 · Panel de administración y "campanita" de notificaciones.
--   1) Precio del plan mensual: $3.000 ARS.
--   2) Tabla notifications (in-app) con RLS por usuario + realtime.
--   3) admin_broadcast_notifications: mensaje a todos los usuarios.
--   4) admin_set_subscription_free: dar la suscripción gratis para siempre.
--   5) admin_delete_user: eliminar un usuario de raíz.
-- Pegar completo en el SQL Editor de Supabase y ejecutar.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Precio del plan (sólo si todavía estaba sin configurar)
-- ------------------------------------------------------------
update public.subscription_plans
   set price_ars = 3000, updated_at = now()
 where price_ars = 0;

-- ------------------------------------------------------------
-- 2) Notificaciones in-app (una fila por usuario)
-- ------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text check (body is null or char_length(body) <= 500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.notifications from anon;
revoke insert, update, delete on table public.notifications from authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

-- Realtime: la campanita se actualiza con la pantalla abierta.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 3) Mensaje broadcast del administrador a todos los usuarios
-- ------------------------------------------------------------
create or replace function public.admin_broadcast_notifications(p_title text, p_body text default null)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_title text;
  v_body text;
  v_count integer;
begin
  perform public.assert_admin();

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null or char_length(v_title) > 120 then
    raise exception 'El título debe tener entre 1 y 120 caracteres';
  end if;

  v_body := nullif(btrim(coalesce(p_body, '')), '');
  if v_body is not null and char_length(v_body) > 500 then
    raise exception 'El mensaje no puede superar los 500 caracteres';
  end if;

  insert into public.notifications (user_id, title, body)
  select id, v_title, v_body from public.profiles;

  get diagnostics v_count = row_count;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (
    auth.uid(),
    'admin.broadcast',
    'notification',
    null,
    jsonb_build_object('recipients', v_count, 'title', v_title)
  );

  return v_count;
end;
$$;

-- ------------------------------------------------------------
-- 4) Suscripción gratis para siempre (sin vencimiento)
-- ------------------------------------------------------------
create or replace function public.admin_set_subscription_free(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_plan_id uuid;
begin
  perform public.assert_admin();

  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No existe ese usuario';
  end if;

  select id
    into v_plan_id
    from public.subscription_plans
   where active = true
   order by created_at
   limit 1;

  if v_plan_id is null then
    raise exception 'No hay ningún plan activo configurado';
  end if;

  -- status = 'active' con current_period_end = null => is_entitled() siempre true.
  insert into public.user_subscriptions
    (user_id, plan_id, status, provider, provider_subscription_id,
     trial_started_at, trial_ends_at, current_period_start, current_period_end,
     cancel_at_period_end)
  values
    (p_user_id, v_plan_id, 'active', 'manual', null,
     null, null, now(), null, false)
  on conflict (user_id) do update
    set plan_id = excluded.plan_id,
        status = 'active',
        provider = 'manual',
        provider_subscription_id = null,
        trial_started_at = null,
        trial_ends_at = null,
        current_period_start = now(),
        current_period_end = null,
        cancel_at_period_end = false,
        updated_at = now();

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'admin.subscription_free', 'user', p_user_id::text, '{}'::jsonb);
end;
$$;

-- ------------------------------------------------------------
-- 5) Eliminación definitiva de un usuario
--    (reasigna comunidades creadas y alertas disparadas antes de borrar)
-- ------------------------------------------------------------
create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_actor uuid;
  v_email text;
  v_comm uuid;
  v_new_creator uuid;
begin
  perform public.assert_admin();

  if p_user_id is null then
    raise exception 'Falta el usuario a eliminar';
  end if;

  if auth.uid() is not null and p_user_id = auth.uid() then
    raise exception 'No podés eliminar tu propia cuenta';
  end if;

  select u.email::text into v_email from auth.users u where u.id = p_user_id;

  if v_email is null and not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No existe ese usuario';
  end if;

  -- Responsable de la reasignación y de la auditoría.
  select id
    into v_actor
    from public.profiles
   where role = 'admin_general' and suspended = false and id <> p_user_id
   order by created_at
   limit 1;

  if v_actor is null then
    select id into v_actor
      from public.profiles
     where id <> p_user_id
     order by created_at
     limit 1;
  end if;

  if v_actor is null then
    raise exception 'No queda ningún usuario destino para reasignar los registros';
  end if;

  -- Comunidades creadas por el usuario: se transfiere la autoría a otro
  -- miembro activo (prioriza administradores) o se elimina la comunidad.
  for v_comm in select id from public.communities where created_by = p_user_id loop
    select cm.user_id
      into v_new_creator
      from public.community_members cm
     where cm.community_id = v_comm
       and cm.user_id <> p_user_id
       and cm.membership_status = 'active'
     order by (cm.role = 'admin') desc, cm.joined_at
     limit 1;

    if v_new_creator is not null then
      update public.communities set created_by = v_new_creator where id = v_comm;
    else
      delete from public.communities where id = v_comm;
    end if;
  end loop;

  -- Alertas que disparó el usuario en comunidades que siguen existiendo.
  update public.alerts set triggered_by = v_actor where triggered_by = p_user_id;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (v_actor, 'admin.delete_user', 'user', p_user_id::text,
          jsonb_build_object('email', v_email));

  -- Cascada: profiles, community_members, invites, alerts (receptores),
  -- push_subscriptions, notification_jobs, notifications, suscripciones.
  delete from auth.users where id = p_user_id;
end;
$$;

-- ------------------------------------------------------------
-- Permisos de ejecución: sólo la app autenticada (los admin RPC
-- validan internamente con assert_admin()).
-- ------------------------------------------------------------
revoke execute on function public.admin_broadcast_notifications(text, text) from public, anon;
revoke execute on function public.admin_set_subscription_free(uuid) from public, anon;
revoke execute on function public.admin_delete_user(uuid) from public, anon;

grant execute on function public.admin_broadcast_notifications(text, text) to authenticated, postgres, service_role;
grant execute on function public.admin_set_subscription_free(uuid) to authenticated, postgres, service_role;
grant execute on function public.admin_delete_user(uuid) to authenticated, postgres, service_role;
