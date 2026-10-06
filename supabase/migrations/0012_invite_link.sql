-- ============================================================
-- 0012_invite_link.sql
-- Link de invitación siempre visible para copiar.
-- * generate_invite guarda además el token en claro en la columna
--   `token` (sólo lo pueden leer el creador y los administradores
--   de esa comunidad, vía RLS), así el admin vuelve a copiar el
--   link cuando quiera en vez de generarlo de nuevo.
-- * Acepta vencimiento y usos ilimitados: p_ttl_seconds null =
--   sin vencimiento, p_max_uses null = usos ilimitados.
-- Pegar completo en el SQL Editor de Supabase y ejecutar.
-- ============================================================

-- 1) Link copiable (el token_hash sigue siendo el que valida join_community)
alter table public.community_invites add column if not exists token text;
create unique index if not exists community_invites_token_key
  on public.community_invites (token);

-- 2) Vencimiento y usos opcionales
alter table public.community_invites alter column max_uses drop not null;
alter table public.community_invites drop constraint if exists community_invites_max_uses_check;
alter table public.community_invites add constraint community_invites_max_uses_check
  check (max_uses is null or max_uses between 1 and 500);

-- 3) generate_invite: guarda el token y admite límites en null
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

  if p_ttl_seconds is not null and (p_ttl_seconds < 60 or p_ttl_seconds > 2592000) then
    raise exception 'Duración inválida';
  end if;

  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 500) then
    raise exception 'Usos máximos inválido';
  end if;

  -- 256 bits de entropía. Se guarda el hash para validar el ingreso y,
  -- en la columna `token`, el link para que el admin pueda copiarlo
  -- siempre (lectura restringida por RLS a admin/creador).
  v_token := gen_random_uuid()::text || gen_random_uuid()::text;
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.community_invites
    (community_id, token_hash, token, created_by, expires_at, max_uses)
  values
    (p_community_id, v_hash, v_token, auth.uid(),
     case when p_ttl_seconds is null
          then null
          else now() + make_interval(secs => p_ttl_seconds)
     end,
     p_max_uses);

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'invite.create', 'community', p_community_id::text,
          jsonb_build_object('ttl_seconds', p_ttl_seconds, 'max_uses', p_max_uses));

  return v_token;
end;
$$;

-- 4) join_community: usos ilimitados cuando max_uses es null
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
