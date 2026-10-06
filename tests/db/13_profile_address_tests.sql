-- ============================================================
-- 13_profile_address_tests.sql
-- Pruebas de la dirección en el perfil (0011).
-- Cada bloque lanza una excepción si la regla no se cumple.
-- ============================================================

reset role;
reset request.jwt.claims;

-- ------------------------------------------------------------
-- 1) Dirección válida: se guarda, se limpia y el cliente la puede leer
--    (lectura con rol authenticated = permiso de columna de 0011)
-- ------------------------------------------------------------
do $$
declare
  v_address text;
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  perform public.update_own_profile('Ana Perez', '+54 9 11 5555-5555',
                                    '   Av. Siempreviva 742   ');

  select address into v_address
    from public.profiles
   where id = '11111111-1111-1111-1111-111111111111';

  if v_address is distinct from 'Av. Siempreviva 742' then
    raise exception 'FALLO: no se guardó la dirección con el formato esperado (%)', v_address;
  end if;

  raise notice 'OK: la dirección se guarda, se limpia y es legible desde el cliente';

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- 2) Validaciones: mínimo 3 y máximo 160 caracteres
-- ------------------------------------------------------------
do $$
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

  begin
    perform public.update_own_profile('Ana Perez', '', '  a  ');
    raise exception 'FALLO: se aceptó una dirección de menos de 3 caracteres';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: la dirección exige 3 caracteres';
  end;

  begin
    perform public.update_own_profile('Ana Perez', '', repeat('a', 161));
    raise exception 'FALLO: se aceptó una dirección de más de 160 caracteres';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: la dirección se limita a 160 caracteres';
  end;

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- 3) Campo opcional: vacío o en null deja la dirección sin valor
-- ------------------------------------------------------------
do $$
declare
  v_address text;
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';

  perform public.update_own_profile('Bruno Diaz', '12345678', '  ');
  select address into v_address from public.profiles where id = '22222222-2222-2222-2222-222222222222';
  if v_address is not null then
    raise exception 'FALLO: una dirección vacía no debería guardarse (%)', v_address;
  end if;

  perform public.update_own_profile('Bruno Diaz', '12345678', null);
  select address into v_address from public.profiles where id = '22222222-2222-2222-2222-222222222222';
  if v_address is not null then
    raise exception 'FALLO: la dirección null no debería guardarse (%)', v_address;
  end if;

  raise notice 'OK: la dirección es opcional (vacío o null queda sin valor)';

  reset role;
  reset request.jwt.claims;
end
$$;

-- ------------------------------------------------------------
-- 4) Compatibilidad: la firma vieja de 2 argumentos sigue funcionando
-- ------------------------------------------------------------
do $$
begin
  set role authenticated;
  set request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333"}';

  perform public.update_own_profile('Carla Ruiz', '');

  if (select address from public.profiles where id = '33333333-3333-3333-3333-333333333333') is not null then
    raise exception 'FALLO: la llamada de 2 argumentos alteró la dirección';
  end if;

  raise notice 'OK: update_own_profile sigue aceptando la firma de 2 argumentos';

  reset role;
  reset request.jwt.claims;
end
$$;
