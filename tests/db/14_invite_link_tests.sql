-- ============================================================
-- 14_invite_link_tests.sql
-- Pruebas del link de invitación copiable y con límites en null (0012).
-- Cada bloque lanza una excepción si la regla no se cumple.
-- ============================================================

reset role;
reset request.jwt.claims;

-- Dos vecinos nuevos para probar los usos ilimitados y el tope de usos
insert into auth.users (id, email, raw_user_meta_data) values
  ('55555555-5555-5555-5555-555555555555', 'eva@ejemplo.com',     '{"full_name":"Eva Torres"}'),
  ('66666666-6666-6666-6666-666666666666', 'facundo@ejemplo.com', '{"full_name":"Facundo Rios"}')
on conflict do nothing;

-- ------------------------------------------------------------
-- 1) Link permanente: se guarda para copiar, sin vencimiento ni tope
-- ------------------------------------------------------------
do $$
declare
  v_community uuid;
  v_token text;
  v_row public.community_invites%rowtype;
begin
  -- Cada archivo de pruebas corre en su propia sesión: se busca la
  -- comunidad de Ana (Barrio Norte) en vez de reusar el setting de 10.
  select c.id into v_community
    from public.community_members m
    join public.communities c on c.id = m.community_id
   where m.user_id = '11111111-1111-1111-1111-111111111111'
     and m.membership_status = 'active'
     and m.role = 'admin'
   order by c.created_at
   limit 1;

  if v_community is null then
    raise exception 'FALLO: no hay comunidad de prueba';
  end if;

  perform set_config('test.community_invites', v_community::text, false);

  set role authenticated;
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  v_token := public.generate_invite(v_community, null, null);

  select * into v_row
    from public.community_invites
   where community_id = v_community
     and token = v_token;

  if not found then
    raise exception 'FALLO: no se guardó el link para copiarlo de nuevo';
  end if;

  if v_row.expires_at is not null then
    raise exception 'FALLO: el link debería quedar sin vencimiento (%)', v_row.expires_at;
  end if;

  if v_row.max_uses is not null then
    raise exception 'FALLO: los usos deberían ser ilimitados (%)', v_row.max_uses;
  end if;

  if v_row.token_hash = v_token then
    raise exception 'FALLO: el hash quedó igual al token';
  end if;

  perform set_config('test.token_permanente', v_token, false);

  raise notice 'OK: el link permanente queda guardado (token + hash, sin vencimiento ni tope)';

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- 2) Validaciones: duración y usos siguen acotados cuando no son null
-- ------------------------------------------------------------
do $$
declare
  v_community uuid := current_setting('test.community_invites', true);
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  begin
    perform public.generate_invite(v_community, 30, null);
    raise exception 'FALLO: se aceptó una duración menor a 60 segundos';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: la duración mínima sigue en 60 segundos';
  end;

  begin
    perform public.generate_invite(v_community, null, 0);
    raise exception 'FALLO: se aceptaron 0 usos';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: los usos no admiten valores fuera de rango';
  end;

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- 3) El link sólo lo pueden leer el creador y los administradores
-- ------------------------------------------------------------
do $$
declare
  v_community uuid := current_setting('test.community_invites', true);
  v_visibles integer;
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';

  select count(*) into v_visibles
    from public.community_invites
   where community_id = v_community;

  if v_visibles <> 0 then
    raise exception 'FALLO: un integrante común ve los códigos de invitación (%)', v_visibles;
  end if;

  raise notice 'OK: un integrante común no ve los códigos ni el link';

  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  select count(*) into v_visibles
    from public.community_invites
   where community_id = v_community
     and token is not null;

  if v_visibles < 1 then
    raise exception 'FALLO: el admin no puede volver a leer el link (%)', v_visibles;
  end if;

  raise notice 'OK: el administrador vuelve a leer y copiar el link';

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- 4) El link permanente sigue funcionando después de varios usos
--    y el tope de usos de un código limitado sigue vigente
-- ------------------------------------------------------------
do $$
declare
  v_community uuid := current_setting('test.community_invites', true);
  v_perm text := current_setting('test.token_permanente', true);
  v_limited text;
  v_uses integer;
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  v_limited := public.generate_invite(v_community, 3600, 1);

  -- Eva entra con el código limitado (1 uso)
  set request.jwt.claims to '{"sub":"55555555-5555-5555-5555-555555555555"}';
  perform public.join_community(v_limited);

  if not exists (
    select 1 from public.community_members
     where community_id = v_community
       and user_id = '55555555-5555-5555-5555-555555555555'
       and membership_status = 'active'
  ) then
    raise exception 'FALLO: Eva no quedó activa en la comunidad';
  end if;

  -- Facundo no puede reusar el código limitado…
  set request.jwt.claims to '{"sub":"66666666-6666-6666-6666-666666666666"}';
  begin
    perform public.join_community(v_limited);
    raise exception 'FALLO: se superó el tope de usos de un código limitado';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: el tope de usos de un código limitado sigue vigente';
  end;

  -- …pero sí con el link permanente
  perform public.join_community(v_perm);

  if not exists (
    select 1 from public.community_members
     where community_id = v_community
       and user_id = '66666666-6666-6666-6666-666666666666'
       and membership_status = 'active'
  ) then
    raise exception 'FALLO: Facundo no pudo entrar con el link permanente';
  end if;

  reset role;
  reset request.jwt.claims;

  select use_count into v_uses
    from public.community_invites
   where community_id = v_community and token = v_perm;

  if v_uses is null or v_uses < 1 then
    raise exception 'FALLO: el link permanente no registró el uso (%)', v_uses;
  end if;

  raise notice 'OK: el link permanente sigue vivo tras varios usos';

  select use_count into v_uses
    from public.community_invites
   where community_id = v_community and token = v_limited;

  if v_uses <> 1 then
    raise exception 'FALLO: el código limitado quedó con % usos (esperaba 1)', v_uses;
  end if;

  raise notice 'OK: el link permanente y el limitado conviven con sus contadores';
end
$$;
