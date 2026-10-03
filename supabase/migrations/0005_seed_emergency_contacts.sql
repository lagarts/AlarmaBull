-- ============================================================
-- 0005_seed_emergency_contacts.sql
-- Números oficiales de emergencia (Argentina).
-- TODOS verificados en fuentes oficiales; jamás se inventan números.
-- Fuente general: https://www.argentina.gob.ar/tema/emergencias
--   - 911  Central de Emergencias Nacional (policía / emergencias)
--   - 100  Bomberos
--   - 107  SAME, emergencias médicas (Ciudad de Buenos Aires y
--          localidades de la provincia de Buenos Aires)
-- Carga desde el panel de administración con su propia fuente.
-- ============================================================

insert into public.emergency_contacts
  (country_code, province, locality, service_type, phone_number, label, source_url, verified_at, active)
values
  ('AR', null, null, 'police',   '911', 'Central de Emergencias Nacional',
   'https://www.argentina.gob.ar/tema/emergencias', now(), true),
  ('AR', null, null, 'fire',     '100', 'Bomberos',
   'https://www.argentina.gob.ar/tema/emergencias', now(), true),
  ('AR', null, null, 'ambulance','107', 'SAME · emergencias médicas',
   'https://www.argentina.gob.ar/tema/emergencias', now(), true)
on conflict (country_code, coalesce(province, ''), coalesce(locality, ''), service_type)
do nothing;
