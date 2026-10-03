# Estado del proyecto — por fase

Revisión del código del repositorio (3 de octubre de 2026). "Hecha" significa que la
funcionalidad está implementada y verificada en el código; lo que sólo requiere
configuración, credenciales o despliegue queda aclarado en la columna "Qué falta"
(checklist completo en [`DESPLEGUE.md`](DESPLEGUE.md)).

| Fase | Estado | Dónde está el código | Qué falta |
| --- | --- | --- | --- |
| **FASE 1** — scaffold, diseño base, PWA, arquitectura | Hecha | `vite.config.ts`, `tsconfig.*`, `eslint.config.js`, `index.html`, `public/icons/`, `src/styles/index.css`, `src/components/{layout,ui}/`, `src/routes/`, `docs/ARQUITECTURA.md`, `docs/FASE1.md` | Sólo cosmético: ícono maskable definitivo con la marca real (los actuales son provisorios: azul oscuro + "AV"). Lo demás de la lista manual de la FASE 1 (Supabase, GitHub, Vercel, precio) pasó a `docs/DESPLEGUE.md` |
| **FASE 2** — sin landing, raíz a la app | Hecha | `src/App.tsx` (`/` → `/acceder` si no hay sesión, `/inicio` si la hay), `src/routes/guards.tsx` (`PublicOnly`/`RequireAuth`), `src/components/layout/AppShell.tsx`, `src/pages/NotFoundPage.tsx` | Nada. Quedó código muerto: `src/pages/PageStub.tsx` ya no se usa en ninguna ruta (se puede borrar) |
| **FASE 3** — auth con Supabase | Hecha | `src/pages/{AuthPage,RecoverPage,ProfilePage,ProfileSettingsPage,SettingsPage}.tsx`, `src/context/AuthProvider.tsx`, `src/lib/supabase.ts` (PKCE + `detectSessionInUrl`) | Configuración del lado de Supabase: proveedor email, decidir confirmación de email y URL Configuration (Site URL + Redirect URLs). No hay pantalla propia de confirmación de email |
| **FASE 4** — comunidades | Hecha | `src/pages/{CreateCommunityPage,JoinCommunityPage,MembersPage,InvitesPage}.tsx`, `src/components/community/`, `src/data/community.ts`, RPC en `supabase/migrations/0002_functions.sql` (`create_community`, `generate_invite`, `join_community`, `approve_member`, `remove_member`, `revoke_invites`) | Nada |
| **FASE 5** — suscripción (prueba de 7 días + checkout) | **Parcial** | Trigger `handle_new_user` (crea perfil + trial) en `0002_functions.sql`; `get_my_subscription`, `refresh_subscription_states`; `src/pages/SubscriptionPage.tsx`, `src/data/subscription.ts`, `src/components/subscription/`, seed en `0004_seed.sql` | 1) Cargar el precio real (manual, paso 7 de `docs/DESPLEGUE.md`; hasta entonces la UI avisa "precio todavía no configurado"). 2) `/suscripcion` **no lee** el `?resultado=exito\|fallo\|pendiente` del `back_url` de Mercado Pago: sólo recarga el estado real de la BD. 3) Textos legales (condiciones/precio) — no hay link a condiciones en la app |
| **FASE 6** — alarma server-side, historial, detalle, Realtime | Hecha | `supabase/migrations/0002_functions.sql` (`trigger_alert`: idempotencia por `idempotency_key` + cooldown de 10 s + `is_entitled`), `src/pages/{HomePage,AlertsHistoryPage,AlertDetailPage}.tsx`, `src/data/alerts.ts`, `src/components/alarm/`, `src/components/alarm/useAlertsRealtime.ts` (canal `alerts-realtime-<comunidad>`) | Nada |
| **FASE 7** — Web Push | Hecha (código) | `src/sw.ts` (`injectManifest` → `dist/sw.js`, handlers `push` y `notificationclick`), `src/lib/push.ts`, `src/data/notifications.ts` (`dispatchAlertPush`, llamado desde `HomePage`), `supabase/functions/trigger-alert/index.ts`, `docs/FASE7_push.md` | Despliegue y secretos: `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` en Supabase y `VITE_VAPID_PUBLIC_KEY` en Vercel (pasos 5 y 6 de `docs/DESPLEGUE.md`). Sin eso, en producción no hay notificaciones |
| **FASE 8** — contactos de emergencia | Hecha | `src/components/alarm/EmergencyContactsCard.tsx` (pantalla de inicio), `src/data/emergency.ts`, `supabase/migrations/0005_seed_emergency_contacts.sql` (911/100/107, fuente `https://www.argentina.gob.ar/tema/emergencias`), edición desde el admin: `src/components/admin/AdminContactsPanel.tsx` + `emergencyContactsAdmin.ts` + RPC `admin_upsert_emergency_contact` / `admin_set_emergency_contact_active` | Ampliar y verificar contactos por provincia/localidad con fuentes oficiales antes de publicar (el seed trae sólo los 3 números nacionales) |
| **FASE 9** — Mercado Pago | **Parcial** | `supabase/functions/mercadopago-create/index.ts`, `supabase/functions/mercadopago-webhook/index.ts` (firma `x-signature`, idempotencia, verificación de monto), `docs/FASE9_mercadopago.md` | 1) Credenciales y secretos (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `APP_URL`) + despliegue de las dos funciones. 2) Leer el resultado del `back_url` en `/suscripcion` (ver FASE 5). 3) Textos legales. 4) Prueba end-to-end en sandbox y, después, en producción |
| **FASE 10** — panel admin, pruebas, Vercel | **Parcial** | `src/pages/AdminPage.tsx` + `src/components/admin/*` (métricas, usuarios, planes, contactos, pagos), `src/data/admin.ts`, RPC `admin_*` en `0002_functions.sql`; pruebas unitarias (`src/lib/datetime.test.ts`) y SQL (`tests/db/00_mock_supabase.sql`, `tests/db/10_tests.sql`, `scripts/test-db.ps1`); `vercel.json` | Despliegue: importar el repo en Vercel y cargar las variables de entorno (paso 8 de `docs/DESPLEGUE.md`). Además, el repositorio remoto sólo tiene el commit de la FASE 1: hay que subir las fases 2–10 |

Resumen: **la implementación de las 10 fases está completa en el código**; lo que falta es
puesta en producción (Supabase, secretos, Vercel) más tres huecos concretos de producto:
el manejo del resultado de Mercado Pago al volver del checkout, los textos legales y la
ampliación de contactos de emergencia por localidad. No hay pantallas pendientes.

## Verificación ejecutada en esta revisión

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | OK (sin errores) |
| `npm run lint` | OK (sin errores ni warnings) |
| `npm run test` | OK: 1 archivo, 4 pruebas (`src/lib/datetime.test.ts`) |
| `npm run build` | OK: `dist/` + `dist/sw.js` (PWA `injectManifest`, 15 entradas de precache) |
| `powershell -ExecutionPolicy Bypass -File scripts\test-db.ps1` | OK: aplicó `00_mock_supabase.sql` + migraciones 0001–0005 + `10_tests.sql` sobre un PostgreSQL efímero; 16 aserciones `OK:` en 12 bloques `DO` (más el aviso final de cierre) |

## Discrepancias encontradas entre docs y código

1. **`docs/FASE1.md` §3**: dice "2 archivos, 7 pruebas". Hoy `npm run test` corre
   **1 archivo con 4 pruebas**: se eliminaron `src/pages/WelcomePage.tsx` y
   `WelcomePage.test.tsx` en la FASE 2 (no hay landing). El resto de la tabla sigue en verde.
2. **`docs/ARQUITECTURA.md` §4**: la tabla de rutas todavía figura `/` = "Bienvenida" (Fase 1)
   y `/admin` = "Fase 12". Hoy `/` redirige a la app (`src/App.tsx`) y el panel admin es
   **FASE 10** (no existe una FASE 12). Aclarado en la sección
   "Actualización (fases 2–10)" de ese documento.
3. **`docs/ARQUITECTURA.md` §12**: apuntaba a un "listado obligatorio del proyecto (§14)"
   que no existe en el documento; el enlace se redirigió a `docs/ESTADO.md`.
4. **`docs/FASE7_push.md` §12**: marcaba dos pendientes que **ya están resueltos** en el
   código actual — `AlertDetailPage.tsx` ya compila en UTF-8 (el build pasa) y
   `HomePage.tsx` sí llama a `dispatchAlertPush(...)` después de `triggerAlert`.
   Queda sólo el pendiente 3 (secretos VAPID en Supabase/Vercel).
5. **URL de producción**: `.env.example` y `docs/FASE9_mercadopago.md` usan
   `https://alarma-vecinal.vercel.app`, que responde **404**. La URL publicada y verificada
   es `https://alarma-bull.vercel.app` (misma que figura como homepage del repo en GitHub).
6. **`supabase/migrations/0004_seed.sql`** (última línea) remite a
   `docs/FASE8_emergencias.md`, archivo que **no existe** en `docs/`.
7. **Conteo de pruebas SQL**: se piden/indicaban "17 pruebas"; `10_tests.sql` emite
   **16 aserciones `OK:`** agrupadas en 12 bloques `DO` (el total de avisos NOTICE es 17
   si se cuenta el cierre `=== TODAS LAS PRUEBAS DE BASE DE DATOS PASARON ===`).
8. **Repositorio remoto desactualizado**: `origin` tiene un único commit (FASE 1) y 43
   archivos rastreados; `vercel.json`, `supabase/`, `scripts/`, `tests/` y las páginas de
   las fases 2–10 están sólo en el working copy, sin commitear.
