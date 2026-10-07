-- 0016_security_grants.sql
-- Fase 1 de ciberseguridad (auditoría 7/10/2026):
--   1) Cierra pg_cron/pg_net para los roles de cliente: con execute ahí, cualquiera
--      podría agendar SQL arbitrario que corre como postgres.
--   2) Quita EXECUTE que el grant masivo de 0003 y los DROP+CREATE de 0010/0011
--      dejaron en funciones sensibles.
--   3) register_push_subscription: tope de dispositivos y bloqueo de secuestro
--      de endpoints (un canal de alarma con endpoints colgados no llega).
--   4) join_community: impide el reingreso de miembros expulsados ('removed').

-- ---------------------------------------------------------------------------
-- 1) pg_cron / pg_net. En producción existen (los usa el cron); en el clúster
--    local de pruebas no, por eso el bloque condicional.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute 'revoke execute on all functions in schema cron from public, anon, authenticated';
  end if;
  if exists (select 1 from pg_namespace where nspname = 'net') then
    execute 'revoke execute on all functions in schema net from public, anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Funciones con EXECUTE de más.
-- ---------------------------------------------------------------------------

-- Escritura global sobre user_subscriptions: sólo el cron (postgres) y el
-- service role. El grant masivo de 0003_rls.sql se la había dado a todos.
revoke execute on function public.refresh_subscription_states() from public, anon, authenticated;
grant execute on function public.refresh_subscription_states() to postgres, service_role;

-- IDOR: con cualquier UUID se consultaba si otro usuario estaba al día.
revoke execute on function public.is_entitled(uuid) from public, anon, authenticated;
grant execute on function public.is_entitled(uuid) to postgres, service_role;

-- El DROP+CREATE de 0010/0011 restituyó EXECUTE a PUBLIC (= anon). El cliente
-- sólo entra con sesión; se conserva el grant explícito a authenticated.
revoke execute on function public.trigger_alert(uuid, text, double precision, double precision, text, text) from public, anon;
grant execute on function public.trigger_alert(uuid, text, double precision, double precision, text, text) to authenticated, postgres, service_role;

revoke execute on function public.update_own_profile(text, text, text) from public, anon;
grant execute on function public.update_own_profile(text, text, text) to authenticated, postgres, service_role;

-- Funciones-trigger: se revoca PUBLIC (si no, anon/authenticated siguen
-- heredando el execute) y se reotorga sólo al rol que las necesita: el signup
-- lo ejecuta supabase_auth_admin y los updates de profiles pasan por
-- postgres/service_role (o authenticated en el caso de profiles_guard, que
-- necesita el trigger para cualquier UPDATE a profiles con RLS activo).
do $$
begin
  revoke execute on function public.handle_new_user() from public, anon, authenticated;
  revoke execute on function public.profiles_guard() from public, anon, authenticated;
  grant execute on function public.handle_new_user() to postgres, service_role;
  grant execute on function public.profiles_guard() to postgres, service_role, authenticated;
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.handle_new_user() to supabase_auth_admin;
    grant execute on function public.profiles_guard() to supabase_auth_admin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) register_push_subscription con tope de dispositivos y sin secuestro de
--    endpoints ajenos.
-- ---------------------------------------------------------------------------
create or replace function public.register_push_subscription(
  p_endpoint text,
  p_subscription jsonb,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_owned boolean;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if p_endpoint is null or p_endpoint !~ '^https://' then
    raise exception 'Endpoint inválido';
  end if;

  if p_subscription is null
     or p_subscription -> 'keys' ->> 'p256dh' is null
     or p_subscription -> 'keys' ->> 'auth' is null then
    raise exception 'Suscripción push incompleta';
  end if;

  if exists (
    select 1 from public.push_subscriptions
     where endpoint = p_endpoint and user_id <> auth.uid()
  ) then
    raise exception 'Este dispositivo ya está registrado en otra cuenta';
  end if;

  select user_id = auth.uid() into v_owned
    from public.push_subscriptions
   where endpoint = p_endpoint;

  -- Renovar un endpoint propio no consume cupo; registrar uno nuevo sí.
  if not coalesce(v_owned, false)
     and (select count(*) from public.push_subscriptions
           where user_id = auth.uid() and revoked_at is null) >= 8 then
    raise exception 'Alcanzaste el máximo de dispositivos (8)';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, subscription_data, user_agent, revoked_at)
  values (auth.uid(), p_endpoint, p_subscription, left(p_user_agent, 300), null)
  on conflict (endpoint) do update
    set subscription_data = excluded.subscription_data,
        user_agent = excluded.user_agent,
        revoked_at = null,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) join_community: un miembro con membership_status = 'removed' en ESTA
--    comunidad no puede volver a entrar con el mismo link.
-- ---------------------------------------------------------------------------
create or replace function public.join_community(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invite public.community_invites%rowtype;
  v_status public.membership_status;
  v_member_id uuid;
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if p_token is null or char_length(btrim(p_token)) < 32 then
    raise exception 'Código de invitación inválido';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid() and suspended) then
    raise exception 'Cuenta suspendida';
  end if;

  if not public.is_entitled(auth.uid()) then
    raise exception 'Se requiere una suscripción vigente para unirse a una comunidad';
  end if;

  if exists (
    select 1 from public.community_members
     where user_id = auth.uid() and membership_status in ('pending', 'active')
  ) then
    raise exception 'Ya pertenecés a una comunidad';
  end if;

  v_hash := encode(extensions.digest(btrim(p_token), 'sha256'), 'hex');

  select * into v_invite
    from public.community_invites
   where token_hash = v_hash
   for update;

  if not found then
    raise exception 'Código de invitación inválido';
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'La invitación fue revocada';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'La invitación expiró';
  end if;

  if v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses then
    raise exception 'La invitación ya alcanzó su máximo de usos';
  end if;

  if not exists (
    select 1 from public.communities
     where id = v_invite.community_id and status = 'active'
  ) then
    raise exception 'La comunidad no está activa';
  end if;

  if exists (
    select 1 from public.community_members
     where community_id = v_invite.community_id
       and user_id = auth.uid()
       and membership_status = 'removed'
  ) then
    raise exception 'Fuiste dado de baja de esta comunidad';
  end if;

  select case when join_policy = 'approval' then 'pending' else 'active' end
    into v_status
    from public.communities
   where id = v_invite.community_id;

  if exists (
    select 1 from public.community_members
     where community_id = v_invite.community_id and user_id = auth.uid()
  ) then
    update public.community_members
       set membership_status = v_status,
           role = 'member',
           joined_at = now()
     where community_id = v_invite.community_id
       and user_id = auth.uid()
    returning id into v_member_id;
  else
    insert into public.community_members (community_id, user_id, role, membership_status)
    values (v_invite.community_id, auth.uid(), 'member', v_status)
    returning id into v_member_id;
  end if;

  update public.community_invites
     set use_count = use_count + 1
   where id = v_invite.id;

  insert into public.community_logs (community_id, actor_user_id, action, target_user_id)
  values (v_invite.community_id, auth.uid(), 'invite_used', auth.uid());

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'community.join', 'community', v_invite.community_id::text,
          jsonb_build_object('membership_status', v_status));

  return v_invite.community_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Verificación: si alguno de los grants sigue abierto, la migración falla.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fails text := '';
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and has_function_privilege('anon', 'cron.schedule(text,text,text)', 'execute') then
    v_fails := v_fails || 'anon ejecuta cron.schedule; ';
  end if;
  if exists (select 1 from pg_namespace where nspname = 'net')
     and has_function_privilege('authenticated', 'net.http_post(text,jsonb,jsonb,integer)', 'execute') then
    v_fails := v_fails || 'authenticated ejecuta net.http_post; ';
  end if;
  if has_function_privilege('anon', 'public.trigger_alert(uuid,text,double precision,double precision,text,text)', 'execute') then
    v_fails := v_fails || 'anon ejecuta trigger_alert; ';
  end if;
  if has_function_privilege('authenticated', 'public.refresh_subscription_states()', 'execute') then
    v_fails := v_fails || 'authenticated ejecuta refresh_subscription_states; ';
  end if;
  if has_function_privilege('anon', 'public.is_entitled(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.is_entitled(uuid)', 'execute') then
    v_fails := v_fails || 'is_entitled sigue expuesta; ';
  end if;
  if has_function_privilege('anon', 'public.update_own_profile(text,text,text)', 'execute') then
    v_fails := v_fails || 'anon ejecuta update_own_profile; ';
  end if;
  if has_function_privilege('anon', 'public.handle_new_user()', 'execute')
     or has_function_privilege('authenticated', 'public.handle_new_user()', 'execute') then
    v_fails := v_fails || 'handle_new_user sigue expuesta; ';
  end if;
  if has_function_privilege('authenticated', 'public.trigger_alert(uuid,text,double precision,double precision,text,text)', 'execute') = false then
    v_fails := v_fails || 'authenticated perdió trigger_alert; ';
  end if;
  if v_fails <> '' then
    raise exception 'Verificación de grants fallida: %', v_fails;
  end if;
  raise notice 'OK: grants de seguridad verificados';
end $$;

select 'OK: 0016_security_grants aplicada' as result;
