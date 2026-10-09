-- ============================================================
-- 18_leave_community_tests.sql
-- Pruebas de leave_community() (0017): salirse del grupo desde
-- la pantalla Grupos, archivar cuando te vas de último y cierre
-- de permisos.
-- ============================================================

reset role;
reset request.jwt.claims;

-- Tres vecinos nuevos para armar el grupo de prueba
insert into auth.users (id, email, raw_user_meta_data) values
  ('77777777-7777-7777-7777-777777777777', 'lena@ejemplo.com',  '{"full_name":"Lena Quiroga"}'),
  ('88888888-8888-8888-8888-888888888888', 'mateo@ejemplo.com', '{"full_name":"Mateo Sosa"}'),
  ('99999999-9999-9999-9999-999999999999', 'sol@ejemplo.com',   '{"full_name":"Sol Vera"}')
on conflict do nothing;

-- ------------------------------------------------------------
-- 0) Armado del grupo: Lena admin, Mateo integrante, Sol pendiente
-- ------------------------------------------------------------
do $$
declare
  v_community uuid;
begin
  insert into public.communities (name, join_policy, created_by)
  values ('Grupo de Prueba', 'open', '77777777-7777-7777-7777-777777777777')
  returning id into v_community;

  insert into public.community_members (community_id, user_id, role, membership_status) values
    (v_community, '77777777-7777-7777-7777-777777777777', 'admin', 'active'),
    (v_community, '88888888-8888-8888-8888-888888888888', 'member', 'active'),
    (v_community, '99999999-9999-9999-9999-999999999999', 'member', 'pending');

  perform set_config('test.leave_community', v_community::text, false);

  raise notice 'OK: grupo de prueba armado (admin activo, integrante activo, pendiente)';
end
$$;

-- ------------------------------------------------------------
-- 1) Un integrante común se da de baja: queda en "left" y el
--    grupo sigue activo para los demás
-- ------------------------------------------------------------
do $$
declare
  v_community uuid := current_setting('test.leave_community', true);
  v_status text;
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"88888888-8888-8888-8888-888888888888"}';

  perform public.leave_community();

  select membership_status::text into v_status
    from public.community_members
   where community_id = v_community
     and user_id = '88888888-8888-8888-8888-888888888888';

  if v_status is distinct from 'left' then
    raise exception 'FALLO: el integrante no quedó en left (%)', v_status;
  end if;

  reset role;
  reset request.jwt.claims;

  if not exists (
    select 1 from public.community_logs
     where community_id = v_community
       and action = 'member_left'
       and actor_user_id = '88888888-8888-8888-8888-888888888888'
  ) then
    raise exception 'FALLO: no se registró member_left en el log';
  end if;

  if (select status from public.communities where id = v_community) <> 'active' then
    raise exception 'FALLO: el grupo dejó de estar activo cuando se fue un integrante';
  end if;

  raise notice 'OK: un integrante común se da de baja (left) y el grupo sigue activo';
end
$$;

-- ------------------------------------------------------------
-- 2) El único admin no puede salir mientras queden integrantes
-- ------------------------------------------------------------
do $$
declare
  v_community uuid := current_setting('test.leave_community', true);
begin
  -- Mateo vuelve a estar activo para tener compañía en el grupo
  update public.community_members
     set membership_status = 'active'
   where community_id = v_community
     and user_id = '88888888-8888-8888-8888-888888888888';

  set role authenticated;
  set request.jwt.claims to '{"sub":"77777777-7777-7777-7777-777777777777"}';

  begin
    perform public.leave_community();
    raise exception 'FALLO: el único admin salió dejando integrantes atrás';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      if sqlerrm not like '%administrador%' then
        raise exception 'FALLO: error inesperado (%)', sqlerrm;
      end if;
      raise notice 'OK: el único admin no puede salir mientras queden integrantes';
  end;

  reset role;
  reset request.jwt.claims;

  if (select membership_status from public.community_members
       where community_id = v_community
         and user_id = '77777777-7777-7777-7777-777777777777') <> 'active' then
    raise exception 'FALLO: el admin que no pudo salir quedó en otro estado';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 3) Un pendiente se da de baja sin aprobarse, y no puede
--    "salirse" dos veces
-- ------------------------------------------------------------
do $$
declare
  v_community uuid := current_setting('test.leave_community', true);
  v_status text;
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999999"}';

  perform public.leave_community();

  select membership_status::text into v_status
    from public.community_members
   where community_id = v_community
     and user_id = '99999999-9999-9999-9999-999999999999';

  if v_status is distinct from 'left' then
    raise exception 'FALLO: el pendiente no quedó en left (%)', v_status;
  end if;

  raise notice 'OK: un pendiente se da de baja sin aprobarse';

  begin
    perform public.leave_community();
    raise exception 'FALLO: se pudo salir dos veces';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      if sqlerrm not like '%pertenec%' then
        raise exception 'FALLO: error inesperado (%)', sqlerrm;
      end if;
      raise notice 'OK: salir dos veces no deja pasar';
  end;

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- 4) El último en salir archiva el grupo y revoca las invitaciones
-- ------------------------------------------------------------
do $$
declare
  v_community uuid := current_setting('test.leave_community', true);
  v_status text;
  v_vivas integer;
  v_ocupados integer;
  v_my jsonb;
begin
  insert into public.community_invites (community_id, token_hash, created_by)
  values (v_community, 'hash-de-prueba-18', '77777777-7777-7777-7777-777777777777');

  set role authenticated;

  -- Mateo se va: queda sólo Lena
  set request.jwt.claims to '{"sub":"88888888-8888-8888-8888-888888888888"}';
  perform public.leave_community();

  -- Lena, la última, se va: archiva + revoca invitaciones
  set request.jwt.claims to '{"sub":"77777777-7777-7777-7777-777777777777"}';
  perform public.leave_community();

  v_my := public.get_my_community();

  reset role;
  reset request.jwt.claims;

  select status::text into v_status
    from public.communities
   where id = v_community;

  if v_status is distinct from 'archived' then
    raise exception 'FALLO: el grupo no quedó archivado (%)', v_status;
  end if;

  select count(*) into v_vivas
    from public.community_invites
   where community_id = v_community
     and revoked_at is null;

  if v_vivas <> 0 then
    raise exception 'FALLO: quedaron invitaciones vivas (%)', v_vivas;
  end if;

  select count(*) into v_ocupados
    from public.community_members
   where community_id = v_community
     and membership_status in ('pending', 'active');

  if v_ocupados <> 0 then
    raise exception 'FALLO: quedaron integrantes en el grupo (%)', v_ocupados;
  end if;

  if v_my is not null then
    raise exception 'FALLO: get_my_community devolvió algo después de salir (%)', v_my;
  end if;

  raise notice 'OK: el último en salir archiva el grupo, revoca invitaciones y no queda grupo que mostrar';
end
$$;

-- ------------------------------------------------------------
-- 5) Permisos: sólo authenticated (igual que el resto de mutaciones)
-- ------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.leave_community()', 'execute') then
    raise exception 'FALLO: anon puede ejecutar leave_community';
  end if;

  if has_function_privilege('public', 'public.leave_community()', 'execute') then
    raise exception 'FALLO: PUBLIC conserva execute en leave_community';
  end if;

  if not has_function_privilege('authenticated', 'public.leave_community()', 'execute') then
    raise exception 'FALLO: authenticated perdió leave_community';
  end if;

  raise notice 'OK: leave_community sólo para authenticated (ni anon ni PUBLIC)';
end
$$;

reset role;
reset request.jwt.claims;

do $$ begin raise notice '=== TODAS LAS PRUEBAS DE BASE DE DATOS PASARON ==='; end $$;
