-- ============================================================
-- 0007_profile_grant.sql
-- Corrige el error 403 al cargar el perfil de usuario.
-- La política de columnas de profiles no incluía suspended_reason.
-- Pegar completo en el SQL Editor de Supabase y ejecutar.
-- ============================================================

grant select (suspended_reason) on public.profiles to authenticated;
