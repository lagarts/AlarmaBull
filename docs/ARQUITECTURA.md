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
- `community_invites` → `token_hash` (nunca el token en claro), `expires_at`,
  `revoked_at`, `max_uses`, `use_count`.

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
- Pruebas por fase; ver checklist en `docs/FASE1.md` y el listado obligatorio del
  proyecto (§14).
