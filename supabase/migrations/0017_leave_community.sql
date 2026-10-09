-- ============================================================
-- 0017_leave_community.sql
-- Fase: pantalla "Grupos" (botón en el menú lateral).
--
-- Antes no había forma de salirse de una comunidad desde la app:
-- remove_member sólo servía para el admin (y bloqueaba al único admin,
-- que nunca podía irse). leave_community() es la baja propia:
--
--   1) Si sos el último integrante (no queda nadie pending/active):
--      la comunidad queda 'archived' y sus invitaciones revocadas.
--      No se borra la fila para no perder el historial de alertas
--      (alerts.community_id es ON DELETE CASCADE), y sin invitaciones
--      vivas nadie puede entrar con un link viejo a un grupo vacío.
--      join_community ya exige status = 'active'.
--   2) Si quedan otros integrantes y sos el único admin: error.
--      Salida posible: primero quitás a los demás o dejás admin a
--      otra persona, después te vas.
--   3) Si no: membership_status = 'left' (igual que remove_member
--      cuando el objetivo sos vos). 'left' no bloquea re-entrar a
--      otro grupo (el índice único sólo cubre pending/active).
-- ============================================================

create or replace function public.leave_community()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_member public.community_members%rowtype;
  v_others integer;
  v_active_admins integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid() and suspended) then
    raise exception 'Cuenta suspendida';
  end if;

  select * into v_member
    from public.community_members
   where user_id = auth.uid()
     and membership_status in ('pending', 'active')
   for update;

  if not found then
    raise exception 'No pertenecés a ningún grupo';
  end if;

  select count(*) into v_others
    from public.community_members
   where community_id = v_member.community_id
     and user_id <> auth.uid()
     and membership_status in ('pending', 'active');

  if v_others = 0 then
    update public.communities
       set status = 'archived'
     where id = v_member.community_id;

    update public.community_invites
       set revoked_at = now()
     where community_id = v_member.community_id
       and revoked_at is null;
  elsif v_member.role = 'admin' then
    select count(*) into v_active_admins
      from public.community_members
     where community_id = v_member.community_id
       and role = 'admin'
       and membership_status = 'active';

    if v_active_admins <= 1 then
      raise exception 'Sos el único administrador del grupo: antes de salir, quitá a los demás integrantes';
    end if;
  end if;

  update public.community_members
     set membership_status = 'left'
   where id = v_member.id;

  insert into public.community_logs (community_id, actor_user_id, action, target_user_id)
  values (v_member.community_id, auth.uid(), 'member_left', auth.uid());

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), 'community.leave', 'community', v_member.community_id::text,
          jsonb_build_object('archived', v_others = 0, 'was_admin', v_member.role = 'admin'));
end;
$$;

-- Permisos: igual que el resto de las mutaciones (0016).
revoke execute on function public.leave_community() from public, anon, authenticated;

grant execute on function public.leave_community() to authenticated, postgres, service_role;

select 'OK: leave_community creada' as result;
