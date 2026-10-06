# Arquitectura — Alarma Vecinal

Documento de referencia de la arquitectura. Se actualiza en cada fase.

## 1. Visión general

SaaS multiusuario (modelo individual) para comunidades vecinales en Argentina:

- Cada vecino tiene su **propia** suscripción con prueba gratuita de 7 días.
- Las comunidades son agrupaciones de vecinos; el creador administra la comunidad,
  **no** los pagos de los demás.
- La elegibilidad de acceso se calcula y valida **siempre en el backend**.
- La alarma se **registra** en el servidor; la entrega de notificaciones es un proceso
  aparte con su propio estado (nunca se promete entrega total).

## 2. Stack y versiones

| Capa | Tecnología | Versión |
| --- | --- | --- |
| Frontend | React + TypeScript | 19.3 / ~6.0 |
| Build | Vite | 8.x |
| Estilos | Tailwind CSS (v4, `@theme`) | 4.x |
| Rutas | React Router | 7.x |
| Backend/BaaS | Supabase (Auth, Postgres, RLS, Realtime, Edge Functions) | `@supabase/supabase-js` 2.x |
| PWA | `vite-plugin-pwa` + Workbox | 1.x / 7.x |
| Lint | ESLint 10 + typescript-eslint + eslint-plugin-react-hooks | — |
| Pruebas | Vitest + Testing Library (jsdom) | 5.x |
| Pagos | Mercado Pago (solo servidor) | — |
| Despliegue | Vercel + GitHub | — |

## 3. Estructura del repositorio

```
/
├── docs/                    # Arquitectura y estado por fase
├── public/
│   ├── favicon.svg
│   └── icons/               # Iconos PWA (192, 512, maskable, apple)
├── src/
│   ├── components/
│   │   ├── layout/          # AppShell (sidebar + bottom nav), AuthLayout
│   │   ├── ui/              # Button, Card, Feedback, StatusBadge
│   │   └── icons.tsx        # Iconos SVG inline
│   ├── config/env.ts        # Variables VITE_* validadas
│   ├── context/             # AuthProvider (sesión Supabase)
│   ├── lib/                 # supabase.ts, datetime.ts, pwa.ts
│   ├── pages/               # Pantallas (placeholders hasta su fase)
│   ├── routes/              # guards.tsx, nav.ts
│   ├── styles/index.css     # Tokens de diseño Tailwind v4
│   ├── test/setup.ts
│   ├── App.tsx              # Tabla de rutas
│   └── main.tsx
├── supabase/                # Migraciones SQL y Edge Functions (FASE 3+)
├── .env.example             # Sin secretos reales
├── vite.config.ts           # React + Tailwind + PWA/manifest
├── vitest.config.ts
└── eslint.config.js
```

## 4. Mapa de rutas y páginas

| Ruta | Pantalla | Fase |
| --- | --- | --- |
| `/` | Bienvenida | 1 |
| `/acceder` | Registro e inicio de sesión | 3 |
| `/recuperar` | Recuperación de contraseña | 3 |
| `/inicio` | Inicio con botón de alarma | 2 / 6 |
| `/alertas` | Historial de alertas | 6 |
| `/alertas/:alertId` | Detalle de alerta | 6 |
| `/integrantes` | Integrantes de la comunidad | 4 |
| `/invitaciones` | Gestión de invitaciones | 4 |
| `/comunidad/crear` | Crear comunidad | 4 |
| `/comunidad/unirse` | Unirse a una comunidad | 4 |
| `/suscripcion` | Suscripción y pagos | 5 |
| `/perfil` | Perfil y preferencias | 3 |
| `/perfil/editar` | Configuración del perfil | 3 |
| `/configuracion` | Configuración | 2 |
| `/admin` | Panel de administración (solo server-side admin) | 12 |

Guías: `PublicOnly` (no autenticados) y `RequireAuth` (sesión obligatoria, aviso si falta
configurar Supabase).

## 5. Modelo de datos (Postgres)

Migraciones versionadas en `supabase/migrations/`.

### Identidad y comunidades

- `profiles` → `auth.users.id` (nombre, teléfono, timestamps).
- `communities` → `created_by`, `name`, `status`.
- `community_members` → `community_id` + `user_id` únicos, `role`
  (`admin` | `member`), `membership_status` (`pending` | `active` | `removed`).
- `community_invites` → `token_hash` (valida el ingreso) + `token` (link en
  claro para que el admin lo copie cuando quiera; RLS: sólo admin/creador),
  `expires_at` (null = sin vencimiento), `revoked_at`, `max_uses`
  (null = usos ilimitados), `use_count`.

### Comercial

- `subscription_plans` → `price_ars` configurable (nada de precios fijos en código),
  `billing_interval`, `trial_days`, `features`, `active`.
- `user_subscriptions` → 1 fila por usuario (única por `user_id`), `status`,
  `trial_started_at`, `trial_ends_at`, `current_period_start/end`,
  `cancel_at_period_end`, `provider`, `provider_subscription_id`.
- `payment_events` → historial con `provider_event_id` **único** (idempotencia).

### Alertas y notificaciones

- `alerts` → `community_id`, `triggered_by`, `created_at`, ubicación opcional,
  `status`, `idempotency_key` **único** (evita duplicados por doble clic/reintento).
- `alert_recipients` → destinatarios validados al momento de crear la alerta.
- `push_subscriptions` → por dispositivo, `endpoint` único, datos cifrados,
  `revoked_at` para limpieza.

### Operación

- `emergency_contacts` → `country_code`, `province`, `locality`, `service_type`,
  `phone_number`, `source_url`, `verified_at`, `active`.
- `audit_logs` → `actor_user_id`, `action`, `resource_type`, `resource_id`,
  `metadata` limitado y sin secretos.

## 6. Estados de suscripción y acceso

```
(trial) ──vence──► (expired) ──pago aprobado──► (active) ──fin período sin renovar──► (expired)
   │                    ▲                              │
   │                    └── pago rechazado/pago pendiente (past_due) ──┘
   └── cancelada en periodo de prueba ──► (canceled)
```

- `trial`: 7 días desde `trial_started_at` (UTC), calculado **en el servidor**.
- `past_due`: no otorga acceso premium hasta verificar el pago con el proveedor.
- `canceled`: acceso hasta `current_period_end` cuando ya abonó.
- Siempre disponibles: llamadas de emergencia, acceso a la cuenta y renovación.

## 7. Seguridad

1. **RLS activo en todas las tablas** expuestas; sin `anon`/`authenticated` writes a
   tablas de pago.
2. Los estados de pago solo cambian en Edge Functions (service role) o por webhook
   verificado contra Mercado Pago.
3. Nadie puede cambiar su propio `role` ni el de otros; el admin de comunidad no toca
   suscripciones ajenas.
4. Invitaciones: token aleatorio de 256 bits, se persiste solo el hash, con expiración
   y revocación.
5. Validación de pertenencia a comunidad **antes** de crear destinatarios de alerta.
6. Secretos (`SERVICE_ROLE_KEY`, access token de Mercado Pago) solo en secretos de
   Supabase/Vercel: nunca en GitHub, frontend ni `.env` público.
7. Idempotencia en webhooks (`provider_event_id` único) y en alertas
   (`idempotency_key` único).

## 8. Flujo de alarma

```
Cliente                     Supabase                        Destinatarios
  │ confirmación                 │                                │
  │──POST trigger──────────────►│ valida auth + membresía         │
  │                             │ + elegibilidad + idempotencia   │
  │                             │──insert alerts + recipients────►│
  │◄──202 "alerta registrada"───│                                 │
  │                             │──Realtime (pantalla abierta)───►│
  │                             │──Web Push (background)─────────►│
  │                             │   errores → log + reintentos    │
```

El cliente recibe **"alerta registrada"**, nunca "todos recibieron la notificación".

## 9. Notificaciones

- **Realtime** para pantallas abiertas (suscripción por comunidad).
- **Web Push** con service worker para segundo plano; una suscripción por dispositivo
  en `push_subscriptions`, con limpieza de endpoints inválidos.
- Limitaciones documentadas: iOS requiere PWA instalada, Android puede aplazar
  notificaciones, Safari puede no mostrar notificaciones en segundo plano.

## 10. Pagos (Mercado Pago)

- Suscripción creada **solo** desde Edge Function con el usuario autenticado.
- Estados tomados de la verificación server-side contra la API (no del navegador).
- Webhook firmado + consulta de estado real antes de activar.
- Pruebas con credenciales de sandbox hasta autorización explícita.

## 11. PWA y despliegue

- Manifest y service worker generados por `vite-plugin-pwa` (precaching + navegación).
- `start_url` y `scope` `/`, instalable en Android/iOS/escritorio.
- Vercel: SPA con rewrite de rutas a `index.html` (agregar `vercel.json` en la fase de
  despliegue). Variables `VITE_*` en el entorno de Vercel; secretos del backend en
  Supabase.

## 12. Calidad

- `npm run typecheck` · `npm run lint` · `npm run test` · `npm run build`.
- Pruebas por fase; ver `docs/ESTADO.md` (estado por fase) y el checklist de
  `docs/FASE1.md`.
- Pruebas de base de datos (seguridad/RLS): `scripts/test-db.ps1` sobre un
  PostgreSQL efímero con las migraciones reales (`tests/db/`).

---

# Actualización (fases 2–10)

Las secciones 1 a 12 describen el diseño definido en la FASE 1 y siguen vigentes salvo
las aclaraciones de la subsección 13.1. Este bloque documenta lo incorporado entre la
FASE 2 y la FASE 10. Estado detallado por fase: `docs/ESTADO.md`.

## 13.1. Aclaraciones sobre la sección 4 (mapa de rutas)

- **No hay landing**: la tabla de la sección 4 sigue listando `/` como "Bienvenida";
  desde la FASE 2 la raíz redirige a la aplicación (`src/App.tsx`): a `/acceder` si no hay
  sesión y a `/inicio` si la hay. `WelcomePage.tsx` y `makePlaceholder.tsx` se eliminaron.
- `/admin` es **FASE 10**. La **FASE 12** existe desde el 4/10/2026 y es el módulo
  *Estoy Bien* (`/estoy-bien`), no el panel admin.
- Todas las rutas de la tabla tienen pantalla real (no quedan placeholders). Sobra
  `src/pages/PageStub.tsx`: componente de relleno sin uso.
- Ruta comodín `*` → `src/pages/NotFoundPage.tsx`.
- Guardas sin cambios: `PublicOnly` (no autenticados) y `RequireAuth` (sesión obligatoria,
  aviso si falta configurar Supabase), ambas en `src/routes/guards.tsx`.

## 13.2. Módulos nuevos en `src/`

| Ruta | Contenido | Fase |
| --- | --- | --- |
| `src/data/` | Acceso a datos por dominio, todo el puente hacia Supabase: `client.ts`, `community.ts`, `alerts.ts`, `subscription.ts`, `profile.ts`, `emergency.ts`, `admin.ts`, `notifications.ts` (`dispatchAlertPush`), `types.ts`, `index.ts` (re-export) | 3–8 |
| `src/hooks/` | `useAsync.ts` (`useAsync` / `useAction`: carga, acción pendiente, error, recarga) y `useCommunity.ts` (comunidad y suscripción del usuario) | 3–6 |
| `src/components/alarm/` | `ConfirmDialog`, `EmergencyContactsCard`, `NoCommunityState`, `AlertListItem`, `AlertStatusPill`, `SubscriptionChip`, `geolocation.ts`, `relativeTime.ts`, `useAlertsRealtime.ts` (Realtime por comunidad) | 6–8 |
| `src/components/community/` | `MemberAvatar`, `AlreadyMemberNotice`, `badges.tsx`, `fields.ts` | 4 |
| `src/components/subscription/` | `CurrentStatusCard`, `PlanCard` (avisa cuando `price_ars = 0`), `PaymentHistoryCard`, `labels.ts` | 5 |
| `src/components/admin/` | `AdminMetricsPanel`, `AdminUsersPanel`, `AdminPlansPanel`, `AdminContactsPanel`, `AdminPaymentsPanel`, `SuspendUserDialog`, `emergencyContactsAdmin.ts` | 8–10 |
| `src/lib/push.ts` | Cliente Web Push: `isPushSupported`, `getPushStatus`, `enablePush`, `disablePush`, `hasActivePush`, `notifyLocal` | 7 |
| `src/sw.ts` | Service worker propio (compilado por Vite a `dist/sw.js`) | 7 |
| `src/pages/` | 15 pantallas reales: `AuthPage`, `RecoverPage`, `HomePage`, `AlertsHistoryPage`, `AlertDetailPage`, `MembersPage`, `InvitesPage`, `CreateCommunityPage`, `JoinCommunityPage`, `SubscriptionPage`, `ProfilePage`, `ProfileSettingsPage`, `SettingsPage`, `AdminPage`, `NotFoundPage` | 2–10 |

## 13.3. Migraciones y Edge Functions

Migraciones versionadas en `supabase/migrations/` (se aplican en orden):

| Archivo | Contenido |
| --- | --- |
| `0001_initial_schema.sql` | Tipos, 15 tablas, índices y restricciones |
| `0002_functions.sql` | Funciones `SECURITY DEFINER`: perfiles, comunidades e invitaciones, suscripciones, `trigger_alert` (idempotencia + cooldown de 10 s), suscripción a push, RPC de administración (`admin_*`) y triggers (`handle_new_user` crea perfil + prueba de 7 días; `profiles_guard` impide autoasignar rol) |
| `0003_rls.sql` | Row Level Security en las 15 tablas + alta de `alerts`, `alert_recipients` y `community_members` en la publicación `supabase_realtime` |
| `0004_seed.sql` | Plan mensual con `price_ars = 0` (precio sin configurar, a propósito) |
| `0005_seed_emergency_contacts.sql` | 911 / 100 / 107 con fuente oficial `argentina.gob.ar` (FASE 8) |

Edge Functions en `supabase/functions/` (Deno, secretos sólo en Supabase):

| Función | Rol | JWT |
| --- | --- | --- |
| `trigger-alert` | Envía los Web Push de una alerta a los destinatarios, con idempotencia por (alerta, destinatario, suscripción); escribe `notification_jobs` | requerido (se despliega sin flag) |
| `mercadopago-create` | Crea el preapproval de Mercado Pago y devuelve `init_point` | requerido (se despliega sin flag) |
| `mercadopago-webhook` | Firma `x-signature`, consulta el estado real a MP, idempotencia en `payment_events`, activa/cancela la suscripción | sin JWT → `--no-verify-jwt` |

## 13.4. Tablas nuevas respecto de la sección 5

Además de las tablas listadas en la sección 5, el esquema final tiene:

- `notification_jobs` → una fila por (alerta, destinatario) con `status`
  (`pending`/`sent`/`failed`), `attempts`, `last_error`, `sent_at`,
  `push_subscription_id`; base de la idempotencia del Web Push.
- `community_logs` → historial de acciones de la comunidad.
- `signup_attempts` → control de intentos de registro.

Total: **15 tablas, todas con RLS activado** (`0003_rls.sql`).

## 13.5. Cambios de configuración respecto de la sección 11

- `vite.config.ts` pasó a `strategies: 'injectManifest'` con `srcDir: 'src'` y
  `filename: 'sw.ts'` (ver `docs/FASE7_push.md`); el SW propio agrega handlers `push` y
  `notificationclick` más fallback de navegación.
- Se agregó `vercel.json`: framework `vite`, `npm ci`, `npm run build`, salida `dist/`,
  rewrite de SPA a `index.html` y headers de `/sw.js` (`no-cache`, `Service-Worker-Allowed`)
  y de seguridad (`nosniff`, `Referrer-Policy`, `X-Frame-Options`).
- `.env.example` suma `VITE_APP_URL` y `VITE_VAPID_PUBLIC_KEY` (sólo la clave pública).
- Secretos de backend: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `APP_URL`,
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (y opcional `VAPID_SUBJECT`).

## 13.6. Verificación y documentación por fase

- Verdes: `npm run typecheck`, `npm run lint`, `npm run test` (4 pruebas),
  `npm run build` (`dist/sw.js`, 15 entradas de precache) y
  `powershell -ExecutionPolicy Bypass -File scripts\test-db.ps1` (pruebas SQL de
  seguridad/RLS sobre PostgreSQL efímero; requiere `psql`/`initdb` en el PATH).
- Documentación: `docs/FASE1.md` (fase 1), `docs/FASE7_push.md` (Web Push),
  `docs/FASE9_mercadopago.md` (Mercado Pago), `docs/ESTADO.md` (estado por fase) y
  `docs/DESPLEGUE.md` (checklist de puesta en producción).
