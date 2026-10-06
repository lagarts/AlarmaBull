-- ============================================================
-- 0011_profile_address.sql
-- Dirección en el perfil del usuario.
-- Pegar completo en el SQL Editor de Supabase y ejecutar.
-- ============================================================

-- 1) Columna en profiles (opcional, 3 a 160 caracteres)
alter table public.profiles
  add column if not exists address text;

alter table public.profiles drop constraint if exists profiles_address_check;
alter table public.profiles add constraint profiles_address_check
  check (address is null or char_length(address) between 3 and 160);

-- 2) Permisos: sin esto el frontend recibe 403 al leer la columna (igual que 0007)
grant select (address) on public.profiles to authenticated;
grant update (address) on public.profiles to authenticated;

-- 3) update_own_profile con dirección (misma lógica que 0010: drop + create;
--    la firma vieja de 2 argumentos sigue funcionando por el default)
drop function if exists public.update_own_profile(text, text);

create or replace function public.update_own_profile(
  p_full_name text,
  p_phone text,
  p_address text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
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

  if v_address is not null and char_length(v_address) < 3 then
    raise exception 'Dirección inválida: mínimo 3 caracteres';
  end if;

  if v_address is not null and char_length(v_address) > 160 then
    raise exception 'La dirección no puede superar los 160 caracteres';
  end if;

  update public.profiles
     set full_name = v_name, phone = v_phone, address = v_address
   where id = auth.uid();

  insert into public.audit_logs (actor_user_id, action, resource_type, resource_id)
    values (auth.uid(), 'profile.update', 'profile', auth.uid()::text);
end;
$$;
