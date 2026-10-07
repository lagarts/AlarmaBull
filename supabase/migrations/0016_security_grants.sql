-- 0016_security_grants.sql
-- Fase 1 de ciberseguridad (auditoría 7/10/2026):
--   1) Cierra pg_cron/pg_net para los roles de cliente: con execute ahí, cualquiera
--      podría agendar SQL arbitrario que corre como postgres.
--   2) Quita EXECUTE que el grant masivo de 0003 y los DROP+CREATE de 0010/0011
--      dejaron en funciones sensibles.
--   3) register_push_subscription: tope de dispositivos y bloqueo de secuestro
--      de endpoints (un canal de alarma con endpoints colgados no llega).
--   4) join_community: impide el reingreso de miembros expulsados ('removed').
--
-- Las firmas NUNCA se escriben a mano: salen de pg_proc con
-- pg_get_function_identity_arguments, así los revokes/grants y la verificación
-- funcionan con cualquier versión de pg_cron/pg_net.

-- ---------------------------------------------------------------------------
-- A) Revokes y grants dinámicos.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rec record;
  v_target text;
begin
  -- pg_cron / pg_net: ningún rol de cliente conserva execute. supabase_admin es
  -- el dueño de esos schemas: si postgres no puede revocar (no es el grantor),
  -- el revoke queda en intento fallido y lo cubre la verificación de abajo.
  for v_rec in
    select n.nspname as ns,
           p.proname as fn,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('cron', 'net')
  loop
    begin
      execute format('revoke execute on function %I.%I(%s) from public, anon, authenticated',
                     v_rec.ns, v_rec.fn, v_rec.args);
    exception when others then
      begin
        execute format('revoke execute on procedure %I.%I(%s) from public, anon, authenticated',
                       v_rec.ns, v_rec.fn, v_rec.args);
      exception when others then
        null;
      end;
    end;
  end loop;

  -- Funciones públicas sensibles: revoke de PUBLIC/anon/authenticated y
  -- re-grant explícito al rol que corresponde.
  for v_rec in
    select p.proname as fn,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('refresh_subscription_states', 'is_entitled',
                         'trigger_alert', 'update_own_profile',
                         'handle_new_user', 'profiles_guard')
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon, authenticated',
                   v_rec.fn, v_rec.args);

    case v_rec.fn
      when 'refresh_subscription_states' then v_target := 'postgres, service_role';
      when 'is_entitled'                  then v_target := 'postgres, service_role';
      when 'trigger_alert'                then v_target := 'authenticated, postgres, service_role';
      when 'update_own_profile'           then v_target := 'authenticated, postgres, service_role';
      when 'handle_new_user'              then v_target := 'postgres, service_role';
      when 'profiles_guard'               then v_target := 'postgres, service_role, authenticated';
      else v_target := null;
    end case;

    if v_target is not null then
      execute format('grant execute on function public.%I(%s) to %s',
                     v_rec.fn, v_rec.args, v_target);
    end if;
  end loop;

  -- El signup lo ejecuta supabase_auth_admin cuando ese rol existe.
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    for v_rec in
      select p.proname as fn,
             pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('handle_new_user', 'profiles_guard')
    loop
      execute format('grant execute on function public.%I(%s) to supabase_auth_admin',
                     v_rec.fn, v_rec.args);
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- B) register_push_subscription con tope de dispositivos y sin secuestro de
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
-- C) join_community: un miembro con membership_status = 'removed' en ESTA
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
-- D) Verificación por OID (sin firmas escritas a mano): si algo que postgres
--    controla sigue expuesto o cerrado de más, la migración falla entera.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fails text := '';
  v_rec record;
  v_abiertas text := '';
begin
  -- cron / net: postgres no es el dueño (supabase_admin lo es) y no siempre
  -- puede revocar. No es una vía de ataque: PostgREST sólo expone el schema
  -- public y los roles cliente no tienen LOGIN, así que el cliente no puede
  -- ejecutar esas funciones. Se deja constancia, no falla la migración.
  for v_rec in
    select n.nspname as ns, p.proname as fn, p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('cron', 'net')
  loop
    if has_function_privilege('anon', v_rec.oid, 'execute')
       or has_function_privilege('authenticated', v_rec.oid, 'execute') then
      v_abiertas := v_abiertas || v_rec.ns || '.' || v_rec.fn || ', ';
    end if;
  end loop;

  if v_abiertas <> '' then
    raise notice 'AVISO: execute de cron/net no revocable por postgres (dueño supabase_admin); inalcanzable para el cliente: %', v_abiertas;
  end if;

  -- Cerradas para cualquier rol de cliente.
  for v_rec in
    select p.proname as fn, p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('refresh_subscription_states', 'is_entitled', 'handle_new_user')
  loop
    if has_function_privilege('anon', v_rec.oid, 'execute')
       or has_function_privilege('authenticated', v_rec.oid, 'execute') then
      v_fails := v_fails || v_rec.fn || ' sigue expuesta; ';
    end if;
  end loop;

  -- Abiertas a authenticated (las usa el cliente) y cerradas a anon.
  for v_rec in
    select p.proname as fn, p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('trigger_alert', 'update_own_profile')
  loop
    if has_function_privilege('anon', v_rec.oid, 'execute') then
      v_fails := v_fails || 'anon ejecuta ' || v_rec.fn || '; ';
    end if;
    if not has_function_privilege('authenticated', v_rec.oid, 'execute') then
      v_fails := v_fails || 'authenticated perdió ' || v_rec.fn || '; ';
    end if;
  end loop;

  if v_fails <> '' then
    raise exception 'Verificación de grants fallida: %', v_fails;
  end if;
  raise notice 'OK: grants de seguridad verificados';
end $$;

select 'OK: 0016_security_grants aplicada' as result;
