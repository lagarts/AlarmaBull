-- ============================================================
-- 17_security_grants.sql
-- Fase 1 de ciberseguridad (0016): grants cerrados, tope de
-- dispositivos push y bloqueo de reingreso de expulsados.
-- ============================================================

reset role;
reset request.jwt.claims;

-- ------------------------------------------------------------
-- 1) Grants: ningún rol de cliente conserva execute sobre lo sensible
-- ------------------------------------------------------------
do $$
declare
  v_fails text := '';
begin
  if has_function_privilege('anon', 'public.trigger_alert(uuid,text,double precision,double precision,text,text)', 'execute') then
    v_fails := v_fails || 'anon ejecuta trigger_alert; ';
  end if;
  if has_function_privilege('anon', 'public.update_own_profile(text,text,text)', 'execute') then
    v_fails := v_fails || 'anon ejecuta update_own_profile; ';
  end if;
  if has_function_privilege('anon', 'public.is_entitled(uuid)', 'execute') then
    v_fails := v_fails || 'anon ejecuta is_entitled; ';
  end if;
  if has_function_privilege('authenticated', 'public.is_entitled(uuid)', 'execute') then
    v_fails := v_fails || 'authenticated ejecuta is_entitled; ';
  end if;
  if has_function_privilege('authenticated', 'public.refresh_subscription_states()', 'execute') then
    v_fails := v_fails || 'authenticated ejecuta refresh_subscription_states; ';
  end if;
  if has_function_privilege('anon', 'public.handle_new_user()', 'execute') then
    v_fails := v_fails || 'anon ejecuta handle_new_user; ';
  end if;
  if has_function_privilege('anon', 'public.profiles_guard()', 'execute') then
    v_fails := v_fails || 'anon ejecuta profiles_guard; ';
  end if;
  if has_function_privilege('authenticated', 'public.trigger_alert(uuid,text,double precision,double precision,text,text)', 'execute') = false then
    v_fails := v_fails || 'authenticated perdió trigger_alert; ';
  end if;
  if has_function_privilege('authenticated', 'public.update_own_profile(text,text,text)', 'execute') = false then
    v_fails := v_fails || 'authenticated perdió update_own_profile; ';
  end if;
  if has_function_privilege('authenticated', 'public.register_push_subscription(text,jsonb,text)', 'execute') = false then
    v_fails := v_fails || 'authenticated perdió register_push_subscription; ';
  end if;
  if has_function_privilege('service_role', 'public.refresh_subscription_states()', 'execute') = false then
    v_fails := v_fails || 'service_role perdió refresh_subscription_states; ';
  end if;
  if v_fails <> '' then
    raise exception 'FALLO: %', v_fails;
  end if;
  raise notice 'OK: grants de seguridad (anon y authenticated sin execute sensible)';
end
$$;

-- ------------------------------------------------------------
-- 2) register_push_subscription: anti-secuestro + tope de 8
-- ------------------------------------------------------------
do $$
declare
  v_user uuid := '77777777-7777-4777-8777-777777777771';
  v_other uuid := '77777777-7777-4777-8777-777777777772';
  v_sub jsonb := '{"keys":{"p256dh":"dGVzdA","auth":"dGVzdA"}}'::jsonb;
  i int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_user, 'dispositivo17a@ejemplo.com', '{"full_name":"Dispositivo Uno"}'),
    (v_other, 'dispositivo17b@ejemplo.com', '{"full_name":"Dispositivo Dos"}')
  on conflict do nothing;

  set local role authenticated;
  set request.jwt.claims to '{"sub":"77777777-7777-4777-8777-777777777771"}';

  perform public.register_push_subscription(
    'https://fcm.googleapis.com/x/endpoint-17', v_sub, 'test');

  -- Un usuario distinto no puede quedarse con el endpoint ajeno
  set request.jwt.claims to '{"sub":"77777777-7777-4777-8777-777777777772"}';
  begin
    perform public.register_push_subscription(
      'https://fcm.googleapis.com/x/endpoint-17', v_sub, 'test');
    raise exception 'FALLO: se pudo secuestrar el endpoint de otra cuenta';
  exception
    when raise_exception then
      if sqlerrm like 'FALLO%' then raise; end if;
      raise notice 'OK: no se puede secuestrar el endpoint de otra cuenta (%)', sqlerrm;
  end;

  -- Con 8 dispositivos activos, el siguiente se rechaza
  set request.jwt.claims to '{"sub":"77777777-7777-4777-8777-777777777771"}';
  for i in 2..9 loop
    begin
      perform public.register_push_subscription(
        'https://fcm.googleapis.com/x/endpoint-17-' || i, v_sub, 'test');
    exception
      when raise_exception then
        if sqlerrm like 'FALLO%' then raise; end if;
        if i < 9 then
          raise exception 'FALLO: rechazó el dispositivo % antes del tope (%)', i, sqlerrm;
        end if;
        raise notice 'OK: tope de 8 dispositivos aplicado en el intento % (%)', i, sqlerrm;
    end;
  end loop;

  if (select count(*) from public.push_subscriptions where user_id = v_user) <> 8 then
    raise exception 'FALLO: se esperaban 8 endpoints registrados, hay %',
      (select count(*) from public.push_subscriptions where user_id = v_user);
  end if;
  raise notice 'OK: tope de dispositivos push (8 registrados)';

  reset role;
  reset request.jwt.claims;

  delete from public.push_subscriptions where user_id in (v_user, v_other);
  delete from auth.users where id in (v_user, v_other);
end
$$;

-- ------------------------------------------------------------
-- 3) join_community: un miembro expulsado ('removed') no reingresa
-- ------------------------------------------------------------
do $$
declare
  v_user uuid := '77777777-7777-4777-8777-777777777773';
  v_community uuid;
  v_token text := 'token-de-prueba-17-de-largo-suficiente';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_user, 'expulsado17@ejemplo.com', '{"full_name":"Expulsado 17"}')
  on conflict do nothing;

  select c.id into v_community
    from public.community_members m
    join public.communities c on c.id = m.community_id
   where m.membership_status = 'active'
     and m.role = 'admin'
   order by c.created_at
   limit 1;

  if v_community is null then
    raise exception 'FALLO: no hay comunidad de prueba';
  end if;

  -- El admin lo expulsa (la membresía nace y termina como 'removed')
  insert into public.community_members (community_id, user_id, role, membership_status)
  values (v_community, v_user, 'member', 'removed')
  on conflict do nothing;

  -- Link vigente creado antes de la expulsión (token en claro, como en prod)
  insert into public.community_invites (community_id, token, token_hash, created_by, expires_at, max_uses)
  values (v_community, v_token,
          encode(extensions.digest(v_token, 'sha256'), 'hex'),
          v_user, now() + interval '1 day', 500);

  set local role authenticated;
  set request.jwt.claims to '{"sub":"77777777-7777-4777-8777-777777777773"}';

  begin
    perform public.join_community(v_token);
    raise exception 'FALLO: un miembro expulsado pudo reingresar';
  exception
    when raise_exception then
      if sqlerrm like 'FALLO%' then raise; end if;
      if sqlerrm <> 'Fuiste dado de baja de esta comunidad' then
        raise exception 'FALLO: error inesperado al reingresar (%)', sqlerrm;
      end if;
      raise notice 'OK: el miembro expulsado no puede reingresar con el link';
  end;

  reset role;
  reset request.jwt.claims;

  delete from public.community_members where user_id = v_user;
  delete from public.community_invites where created_by = v_user;
  delete from public.user_subscriptions where user_id = v_user;
  delete from auth.users where id = v_user;
end
$$;

select 'OK: 17_security_grants' as result;
