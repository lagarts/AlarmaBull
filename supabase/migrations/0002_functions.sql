-- ============================================================
-- 0002_functions.sql
-- Funciones del servidor (SECURITY DEFINER).
-- Todas las operaciones sensibles pasan por acá: el cliente nunca
-- modifica estados de pago, roles ni membresías directamente.
-- ============================================================

-- ------------------------------------------------------------
-- Utilidades de acceso
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.profiles
     where id = auth.uid()
       and role = 'admin_general'
       and suspended = false
  );
$$;

create or replace function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Permisos insuficientes';
  end if;
end;
$$;

-- Elegibilidad comercial: ¿puede usar las funciones pagas?
create or replace function public.is_entitled(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce((
    select case
      when s.status = 'active'
        and (s.current_period_end is null or s.current_period_end > now())
        then true
      when s.status = 'trial'
        and s.trial_ends_at is not null
        and s.trial_ends_at > now()
        then true
      when s.status = 'canceled'
        and s.current_period_end is not null
        and s.current_period_end > now()
        then true
      else false
    end
      from public.user_subscriptions s
     where s.user_id = p_user_id
  ), false);
$$;

create or replace function public.get_my_subscription()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'subscription_id', s.id,
    'status', case
      when s.status = 'trial' and s.trial_ends_at is not null and s.trial_ends_at <= now() then 'expired'
      when s.status = 'active' and s.current_period_end is not null and s.current_period_end <= now() then 'expired'
      else s.status
    end,
    'raw_status', s.status,
    'trial_started_at', s.trial_started_at,
    'trial_ends_at', s.trial_ends_at,
    'trial_days_left', case
      when s.trial_ends_at is null then null
      else greatest(0, ceil(extract(epoch from (s.trial_ends_at - now())) / 86400))::int
    end,
    'current_period_start', s.current_period_start,
    'current_period_end', s.current_period_end,
    'cancel_at_period_end', s.cancel_at_period_end,
    'provider', s.provider,
    'plan', jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'price_ars', p.price_ars,
      'trial_days', p.trial_days,
      'features', p.features
    ),
    'entitled', public.is_entitled(auth.uid())
  )
  from public.user_subscriptions s
  join public.subscription_plans p on p.id = s.plan_id
  where s.user_id = auth.uid();
$$;

-- Mantenimiento: vence pruebas y períodos pagos no renovados.
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
     set status = 'expired', updated_at = now()
   where status = 'trial'
     and trial_ends_at is not null
     and trial_ends_at <= now();
  get diagnostics v_count = row_count;

  update public.user_subscriptions
     set status = case when cancel_at_period_end then 'canceled' else 'past_due' end,
         updated_at = now()
   where status = 'active'
     and current_period_end is not null
     and current_period_end <= now();
  get diagnostics v_aux = row_count;

  return v_count + v_aux;
end;
$$;

-- ------------------------------------------------------------
-- Alta de usuario: perfil + prueba (7 días) calculada en el servidor
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_plan_id uuid;
  v_trial_days integer;
  v_name text;
begin
  v_name := nullif(
    case
      when char_length(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''))) >= 2
        then btrim(new.raw_user_meta_data ->> 'full_name')
    end,
    ''
  );

  insert into public.profiles (id, full_name)
  values (new.id, v_name);

  select id, trial_days
    into v_plan_id, v_trial_days
    from public.subscription_plans
   where active = true
   order by created_at
   limit 1;

  if v_plan_id is not null then
    insert into public.user_subscriptions
      (user_id, plan_id, status, trial_started_at, trial_ends_at)
    values
      (new.id, v_plan_id, 'trial', now(), now() + make_interval(days => v_trial_days));
  end if;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (new.id, 'auth.signup', 'user', new.id::text,
          jsonb_build_object('trial_days', coalesce(v_trial_days, 0)));

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- Guardas de profiles: nadie se autoasigna rol ni se autolevanta la suspensión
-- ------------------------------------------------------------
create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- Escrituras del servidor (service role / postgres): auth.uid() es null.
  if auth.uid() is null then
    return new;
  end if;

  if new.id <> auth.uid() and not public.is_admin() then
    raise exception 'No autorizado a modificar este perfil';
  end if;

  if new.id = auth.uid() then
    if new.role is distinct from old.role
       or new.suspended is distinct from old.suspended
       or new.suspended_reason is distinct from old.suspended_reason
       or new.created_at is distinct from old.created_at then
      raise exception 'No podés modificar tu rol ni el estado de tu cuenta';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists t_profiles_guard on public.profiles;
create trigger t_profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- ------------------------------------------------------------
-- Perfil
-- ------------------------------------------------------------
create or replace function public.update_own_profile(p_full_name text, p_phone text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Nombre inválido';
  end if;

  if v_phone is not null and v_phone !~ '^[0-9+() -]{6,20}$' then
    raise exception 'Teléfono inválido';
  end if;

  update public.profiles
     set full_name = v_name, phone = v_phone
   where id = auth.uid();

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id)
  values (auth.uid(), 'profile.update', 'profile', auth.uid()::text);
end;
$$;

-- ------------------------------------------------------------
-- Comunidades
-- ------------------------------------------------------------
create or replace function public.create_community(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if v_name is null or char_length(v_name) < 3 or char_length(v_name) > 80 then
    raise exception 'El nombre debe tener entre 3 y 80 caracteres';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid() and suspended) then
    raise exception 'Cuenta suspendida';
  end if;

  if not public.is_entitled(auth.uid()) then
    raise exception 'Se requiere una suscripción vigente para crear una comunidad';
  end if;

  if exists (
    select 1 from public.community_members
     where user_id = auth.uid() and membership_status in ('pending', 'active')
  ) then
    raise exception 'Ya pertenecés a una comunidad';
  end if;

  insert into public.communities (name, created_by)
  values (v_name, auth.uid())
  returning id into v_id;

  insert into public.community_members (community_id, user_id, role, membership_status)
  values (v_id, auth.uid(), 'admin', 'active');

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'community.create', 'community', v_id::text,
          jsonb_build_object('name', v_name));

  return v_id;
end;
$$;

create or replace function public.get_my_community()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'community_id', c.id,
    'name', c.name,
    'status', c.status,
    'join_policy', c.join_policy,
    'created_at', c.created_at,
    'created_by', c.created_by,
    'member_count', (
      select count(*) from public.community_members m2
       where m2.community_id = c.id and m2.membership_status = 'active'
    ),
    'pending_count', (
      select count(*) from public.community_members m2
       where m2.community_id = c.id and m2.membership_status = 'pending'
    ),
    'my_member_id', m.id,
    'my_role', m.role,
    'my_status', m.membership_status
  )
  from public.community_members m
  join public.communities c on c.id = m.community_id
  where m.user_id = auth.uid()
    and m.membership_status in ('pending', 'active')
  limit 1;
$$;

create or replace function public.generate_invite(
  p_community_id uuid,
  p_ttl_seconds integer default 604800,
  p_max_uses integer default 25
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if not exists (
    select 1 from public.community_members
     where community_id = p_community_id
       and user_id = auth.uid()
       and role = 'admin'
       and membership_status = 'active'
  ) then
    raise exception 'Sólo el administrador de la comunidad puede generar invitaciones';
  end if;

  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 2592000 then
    raise exception 'Duración inválida';
  end if;

  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 500 then
    raise exception 'Usos máximos inválido';
  end if;

  -- 256 bits de entropía; nunca se guarda el token en claro.
  v_token := gen_random_uuid()::text || gen_random_uuid()::text;
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.community_invites (community_id, token_hash, created_by, expires_at, max_uses)
  values (p_community_id, v_hash, auth.uid(), now() + make_interval(secs => p_ttl_seconds), p_max_uses);

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'invite.create', 'community', p_community_id::text,
          jsonb_build_object('ttl_seconds', p_ttl_seconds, 'max_uses', p_max_uses));

  return v_token;
end;
$$;

create or replace function public.revoke_invites(p_community_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if not exists (
    select 1 from public.community_members
     where community_id = p_community_id and user_id = auth.uid()
       and role = 'admin' and membership_status = 'active'
  ) then
    raise exception 'Sólo el administrador puede revocar invitaciones';
  end if;

  update public.community_invites
     set revoked_at = now()
   where community_id = p_community_id
     and revoked_at is null;
  get diagnostics v_count = row_count;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'invite.revoke', 'community', p_community_id::text,
          jsonb_build_object('revoked', v_count));

  return v_count;
end;
$$;

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

  if v_invite.use_count >= v_invite.max_uses then
    raise exception 'La invitación ya alcanzó su máximo de usos';
  end if;

  if not exists (
    select 1 from public.communities
     where id = v_invite.community_id and status = 'active'
  ) then
    raise exception 'La comunidad no está activa';
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

create or replace function public.approve_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_community_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select community_id into v_community_id
    from public.community_members
   where id = p_member_id;

  if v_community_id is null then
    raise exception 'Integrante no encontrado';
  end if;

  if not exists (
    select 1 from public.community_members
     where community_id = v_community_id and user_id = auth.uid()
       and role = 'admin' and membership_status = 'active'
  ) then
    raise exception 'Sólo el administrador puede aprobar integrantes';
  end if;

  update public.community_members
     set membership_status = 'active'
   where id = p_member_id
     and membership_status = 'pending';

  insert into public.community_logs (community_id, actor_user_id, action, target_user_id)
  values (v_community_id, auth.uid(), 'member_approved',
          (select user_id from public.community_members where id = p_member_id));
end;
$$;

create or replace function public.remove_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_community_id uuid;
  v_target_user uuid;
  v_target_role public.community_role;
  v_active_admins integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select community_id, user_id, role
    into v_community_id, v_target_user, v_target_role
    from public.community_members
   where id = p_member_id;

  if v_community_id is null then
    raise exception 'Integrante no encontrado';
  end if;

  if not exists (
    select 1 from public.community_members
     where community_id = v_community_id and user_id = auth.uid()
       and role = 'admin' and membership_status = 'active'
  ) and v_target_user <> auth.uid() then
    raise exception 'No autorizado para quitar integrantes';
  end if;

  if v_target_role = 'admin' then
    select count(*) into v_active_admins
      from public.community_members
     where community_id = v_community_id
       and role = 'admin'
       and membership_status = 'active';

    if v_active_admins <= 1 then
      raise exception 'No se puede quitar al único administrador de la comunidad';
    end if;
  end if;

  update public.community_members
     set membership_status = case when user_id = auth.uid() then 'left' else 'removed' end
   where id = p_member_id;

  insert into public.community_logs (community_id, actor_user_id, action, target_user_id)
  values (v_community_id, auth.uid(),
          case when v_target_user = auth.uid() then 'member_left' else 'member_removed' end,
          v_target_user);

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(),
          case when v_target_user = auth.uid() then 'community.leave' else 'member.remove' end,
          'community', v_community_id::text,
          jsonb_build_object('target_user_id', v_target_user));
end;
$$;

-- ------------------------------------------------------------
-- Alarma (registro idempotente + destinatarios autorizados)
-- ------------------------------------------------------------
create or replace function public.trigger_alert(
  p_community_id uuid,
  p_idempotency_key text,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_alert_id uuid;
  v_duplicate boolean := false;
  v_recipients integer := 0;
  v_last timestamptz;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    raise exception 'Clave de idempotencia inválida';
  end if;

  -- Reintento / doble clic con la misma clave: devolvemos la alerta existente.
  select id into v_alert_id
    from public.alerts
   where idempotency_key = p_idempotency_key;

  if v_alert_id is not null then
    v_duplicate := true;
  else
    if exists (select 1 from public.profiles where id = auth.uid() and suspended) then
      raise exception 'Cuenta suspendida';
    end if;

    if not public.is_entitled(auth.uid()) then
      raise exception 'Suscripción vencida: renová tu plan para activar alertas';
    end if;

    if not exists (
      select 1 from public.community_members m
        join public.communities c on c.id = m.community_id
       where m.community_id = p_community_id
         and m.user_id = auth.uid()
         and m.membership_status = 'active'
         and c.status = 'active'
    ) then
      raise exception 'No sos integrante activo de esta comunidad';
    end if;

    select max(created_at) into v_last
      from public.alerts
     where community_id = p_community_id
       and triggered_by = auth.uid();

    if v_last is not null and v_last > now() - interval '10 seconds' then
      raise exception 'Esperá unos segundos antes de crear otra alerta';
    end if;

    if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then
      raise exception 'Latitud inválida';
    end if;

    if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
      raise exception 'Longitud inválida';
    end if;

    insert into public.alerts
      (community_id, triggered_by, location_latitude, location_longitude, idempotency_key)
    values
      (p_community_id, auth.uid(), p_latitude, p_longitude, p_idempotency_key)
    on conflict (idempotency_key) do nothing
    returning id into v_alert_id;

    if v_alert_id is null then
      -- Otra petición concurrente ganó: devolvemos su alerta.
      select id into v_alert_id
        from public.alerts
       where idempotency_key = p_idempotency_key;
      v_duplicate := true;
    else
      -- Destinatarios: sólo integrantes activos de esa comunidad, en este momento.
      insert into public.alert_recipients (alert_id, recipient_user_id)
      select v_alert_id, m.user_id
        from public.community_members m
       where m.community_id = p_community_id
         and m.membership_status = 'active'
         and m.user_id <> auth.uid();

      get diagnostics v_recipients = row_count;

      insert into public.notification_jobs (alert_id, recipient_user_id)
      select v_alert_id, recipient_user_id
        from public.alert_recipients
       where alert_id = v_alert_id;

      insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
      values (auth.uid(), 'alert.trigger', 'alert', v_alert_id::text,
              jsonb_build_object(
                'community_id', p_community_id,
                'recipients', v_recipients,
                'has_location', p_latitude is not null
              ));
    end if;
  end if;

  select count(*) into v_recipients
    from public.alert_recipients
   where alert_id = v_alert_id;

  return jsonb_build_object(
    'alert_id', v_alert_id,
    'duplicate', v_duplicate,
    'recipients', v_recipients,
    'registered_at', (select created_at from public.alerts where id = v_alert_id)
  );
end;
$$;

-- ------------------------------------------------------------
-- Dispositivos / Web Push
-- ------------------------------------------------------------
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

  insert into public.push_subscriptions (user_id, endpoint, subscription_data, user_agent, revoked_at)
  values (auth.uid(), p_endpoint, p_subscription, left(p_user_agent, 300), null)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        subscription_data = excluded.subscription_data,
        user_agent = excluded.user_agent,
        revoked_at = null,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.revoke_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  update public.push_subscriptions
     set revoked_at = now()
   where endpoint = p_endpoint
     and user_id = auth.uid()
     and revoked_at is null;
end;
$$;

-- ------------------------------------------------------------
-- Panel de administración (verificación de permisos en el servidor)
-- ------------------------------------------------------------
create or replace function public.admin_set_plan_price(p_plan_id uuid, p_price_ars numeric)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_admin();

  if p_price_ars is null or p_price_ars < 0 or p_price_ars > 10000000 then
    raise exception 'Precio inválido';
  end if;

  update public.subscription_plans
     set price_ars = p_price_ars, updated_at = now()
   where id = p_plan_id;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'plan.price.update', 'subscription_plan', p_plan_id::text,
          jsonb_build_object('price_ars', p_price_ars));
end;
$$;

create or replace function public.admin_set_plan(p_plan_id uuid, p_trial_days integer, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_admin();

  if p_trial_days is null or p_trial_days < 0 or p_trial_days > 60 then
    raise exception 'Días de prueba inválidos';
  end if;

  update public.subscription_plans
     set trial_days = p_trial_days, active = coalesce(p_active, active), updated_at = now()
   where id = p_plan_id;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'plan.update', 'subscription_plan', p_plan_id::text,
          jsonb_build_object('trial_days', p_trial_days, 'active', p_active));
end;
$$;

create or replace function public.admin_set_user_suspended(
  p_user_id uuid,
  p_suspended boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_admin();

  if p_user_id = auth.uid() then
    raise exception 'No podés suspender tu propia cuenta';
  end if;

  update public.profiles
     set suspended = p_suspended,
         suspended_reason = case when p_suspended then left(coalesce(p_reason, 'Sin motivo'), 300) else null end
   where id = p_user_id;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), case when p_suspended then 'user.suspend' else 'user.reinstate' end,
          'user', p_user_id::text, jsonb_build_object('reason', coalesce(p_reason, '')));
end;
$$;

create or replace function public.admin_upsert_emergency_contact(
  p_service_type public.service_type,
  p_phone_number text,
  p_province text default null,
  p_locality text default null,
  p_label text default null,
  p_source_url text default null,
  p_country_code text default 'AR'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  perform public.assert_admin();

  if p_phone_number is null or p_phone_number !~ '^[0-9+() -]{3,20}$' then
    raise exception 'Número inválido';
  end if;

  insert into public.emergency_contacts
    (country_code, province, locality, service_type, phone_number, label, source_url, verified_at, active)
  values
    (upper(p_country_code), nullif(btrim(coalesce(p_province, '')), ''),
     nullif(btrim(coalesce(p_locality, '')), ''), p_service_type,
     btrim(p_phone_number), nullif(btrim(coalesce(p_label, '')), ''),
     nullif(btrim(coalesce(p_source_url, '')), ''), now(), true)
  on conflict (country_code, coalesce(province, ''), coalesce(locality, ''), service_type) do update
    set phone_number = excluded.phone_number,
        label = excluded.label,
        source_url = excluded.source_url,
        verified_at = now(),
        active = true,
        updated_at = now()
  returning id into v_id;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'emergency_contact.upsert', 'emergency_contact', v_id::text,
          jsonb_build_object('service_type', p_service_type, 'locality', p_locality));

  return v_id;
end;
$$;

create or replace function public.admin_set_emergency_contact_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_admin();

  update public.emergency_contacts
     set active = p_active, updated_at = now()
   where id = p_id;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'emergency_contact.toggle', 'emergency_contact', p_id::text,
          jsonb_build_object('active', p_active));
end;
$$;

create or replace function public.admin_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_result jsonb;
begin
  perform public.assert_admin();

  select jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_suspended', (select count(*) from public.profiles where suspended),
    'communities_total', (select count(*) from public.communities),
    'members_active', (select count(*) from public.community_members where membership_status = 'active'),
    'alerts_last_30d', (select count(*) from public.alerts where created_at > now() - interval '30 days'),
    'revenue_month_ars', coalesce((select sum(amount_ars) from public.payment_events
                                    where status = 'approved'
                                      and created_at >= date_trunc('month', now())), 0),
    'subscriptions_trial', (select count(*) from public.user_subscriptions
                             where status = 'trial' and trial_ends_at > now()),
    'subscriptions_trial_expired', (select count(*) from public.user_subscriptions
                                     where status = 'trial' and trial_ends_at <= now()),
    'subscriptions_active', (select count(*) from public.user_subscriptions where status = 'active'),
    'subscriptions_past_due', (select count(*) from public.user_subscriptions where status = 'past_due'),
    'subscriptions_expired', (select count(*) from public.user_subscriptions where status = 'expired'),
    'subscriptions_canceled', (select count(*) from public.user_subscriptions where status = 'canceled'),
    'alerts_total', (select count(*) from public.alerts),
    'alerts_last_7d', (select count(*) from public.alerts where created_at > now() - interval '7 days'),
    'payment_events', (select count(*) from public.payment_events),
    'notification_failures', (select count(*) from public.notification_jobs where status = 'failed')
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_users(p_limit integer default 50, p_offset integer default 0)
returns table (
  user_id uuid,
  full_name text,
  email text,
  suspended boolean,
  role public.app_role,
  subscription_status text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_admin();

  return query
  select
    p.id,
    p.full_name,
    u.email::text,
    p.suspended,
    p.role,
    coalesce(s.status::text, 'none'),
    s.trial_ends_at,
    s.current_period_end,
    p.created_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join public.user_subscriptions s on s.user_id = p.id
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create or replace function public.admin_payment_events(p_limit integer default 50)
returns table (
  id uuid,
  provider text,
  provider_payment_id text,
  event_type text,
  amount_ars numeric,
  status public.payment_status,
  provider_event_id text,
  created_at timestamptz,
  user_id uuid
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_admin();

  return query
  select e.id, e.provider, e.provider_payment_id, e.event_type, e.amount_ars,
         e.status, e.provider_event_id, e.created_at, s.user_id
    from public.payment_events e
    join public.user_subscriptions s on s.id = e.user_subscription_id
   order by e.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

-- Promoción a administrador general: sólo desde el SQL editor (service role).
create or replace function public.admin_promote_by_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
begin
  if auth.uid() is not null then
    raise exception 'Esta operación sólo puede ejecutarse desde el SQL editor';
  end if;

  select id into v_user_id from auth.users where lower(email) = lower(p_email) limit 1;

  if v_user_id is null then
    raise exception 'No existe un usuario con ese email';
  end if;

  update public.profiles
     set role = 'admin_general'
   where id = v_user_id;

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (v_user_id, 'admin.promote', 'user', v_user_id::text, jsonb_build_object('by', 'sql_editor'));
end;
$$;

revoke execute on function public.admin_promote_by_email(text) from public, anon, authenticated;
grant execute on function public.admin_promote_by_email(text) to postgres, service_role;
