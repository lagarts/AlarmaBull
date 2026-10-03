# FASE 7 — Web Push: service worker propio + Edge Function

**Estado: completada** (pendientes manuales listados al final).

## 1. Cómo funciona (flujo completo)

| # | Paso | Dónde |
| --- | --- | --- |
| 1 | El usuario confirma la alarma → RPC `trigger_alert` crea la fila en `alerts`, inserta `alert_recipients` (integrantes activos, sin el disparador) y una fila `notification_jobs` por destinatario (`status='pending'`, `push_subscription_id=null`) | `src/pages/HomePage.tsx` → `src/data/alerts.ts` → `supabase/migrations/0002_functions.sql` |
| 2 | La app pide el envío de los Web Push de esa alerta | `dispatchAlertPush(alertId)` en `src/data/notifications.ts` → `supabase.functions.invoke('trigger-alert', { body: { alert_id } })` |
| 3 | La Edge Function autentica el JWT, verifica que el usuario sea integrante **activo** de la comunidad de la alerta, y recorre destinatarios × suscripciones activas (`push_subscriptions.revoked_at is null`) | `supabase/functions/trigger-alert/index.ts` |
| 4 | Cada envío se registra por destinatario en `notification_jobs` (`status` `sent`/`failed`, `attempts`, `last_error`, `sent_at`, `push_subscription_id`). Si el par (alerta, destinatario, suscripción) ya estaba `sent`, **no se reenvía** | ídem |
| 5 | El navegador recibe el evento `push` y muestra la notificación | `src/sw.ts` → `self.registration.showNotification()` |
| 6 | Al hacer clic se cierra la notificación y se abre/enfoca la pestaña en `data.url` (sólo mismo origen; por defecto `/inicio`) | `src/sw.ts` (`notificationclick`) |

Payload enviado por la Edge Function:

```json
{ "title": "¡Alerta vecinal!", "body": "Un vecino disparó la alarma", "url": "/alertas/<alert_id>" }
```

El SW acepta además un campo opcional `tag` (se pasa a las opciones de la notificación) y
tolera payloads sin JSON (usa el texto plano como cuerpo). Un payload vacío nunca falla:
se usa el título por defecto `¡Alerta vecinal!`.

## 2. Service Worker propio (`injectManifest`)

`vite.config.ts` pasó de `generateSW` a `injectManifest`:

| Opción | Valor |
| --- | --- |
| `strategies` | `'injectManifest'` |
| `srcDir` / `filename` | `'src'` / `'sw.ts'` |
| `injectManifest.globPatterns` | `['**/*.{js,css,html,svg,png,ico,webmanifest}']` |
| `injectManifest.maximumFileSizeToCacheInBytes` | `4 * 1024 * 1024` |
| `injectManifest.rollupFormat` | `'iife'` (script clásico; evita el warning de `inlineDynamicImports` de Vite 8) |
| `registerType` | `'autoUpdate'` (sin cambios) |
| `manifest` | idéntico al anterior (sin cambios) |
| `devOptions.enabled` | `false` (sin cambios) |

`src/sw.ts` (compilado por Vite en el build, sale como `dist/sw.js`):

- `declare let self: ServiceWorkerGlobalScope` + `precacheAndRoute(self.__WB_MANIFEST)`.
- `cleanupOutdatedCaches()` (la intención del viejo `workbox.cleanupOutdatedCaches`).
- `self.skipWaiting()` + `clientsClaim()` (coherente con `registerType: 'autoUpdate'`).
- Fallback de navegación: `NavigationRoute(createHandlerBoundToURL('/index.html'))` con
  `denylist: [/^\/api\//, /^\/functions\//, /^\/webhooks\//]`.
- Handler `push` (ver sección 1) y handler `notificationclick`.

Dependencias nuevas (workbox 7.4.1, misma versión que `workbox-build`/`workbox-window` ya
presentes): `workbox-precaching`, `workbox-routing`, `workbox-core`.

`src/lib/pwa.ts` **no cambió**: en producción sigue registrando el SW con
`registerSW()` de `virtual:pwa-register` (sigue disponible con `injectManifest`).

## 3. Cliente push (`src/lib/push.ts`)

API pública conservada: `isPushSupported()`, `getPushStatus()`, `enablePush()`,
`disablePush()`, `hasActivePush()`, `notifyLocal()`.

Cambios de comportamiento:

- `getRegistration()` (usado por `enablePush`) ya **no** propaga errores crípticos del
  navegador: si no existe `sw.js` lanza `Las notificaciones push están disponibles en la
  versión publicada.`
- `hasActivePush()` y `disablePush()` usan `findRegistration()`: sólo leen el registro
  existente, **nunca** intentan instalar el SW ni lanzan (la pantalla de Configuración no
  muestra un error en desarrollo).
- El flujo sigue siendo: permiso → `pushManager.subscribe` con `applicationServerKey`
  (VAPID pública) → RPC `register_push_subscription`.

Variables nuevas:

- `VITE_VAPID_PUBLIC_KEY` en `.env.example` (sólo la clave **pública**) y en
  `src/vite-env.d.ts` (`readonly VITE_VAPID_PUBLIC_KEY?: string`).

## 4. Despacho desde la app (`src/data/notifications.ts`)

```ts
export async function dispatchAlertPush(alertId: string): Promise<void>
```

Invoca `trigger-alert` con `{ alert_id }`. Nunca lanza (envuelve todo en `try/catch` y sólo
escribe un `console.warn` normalizado con `toAppError`): un fallo de push no puede romper la
pantalla de la alarma.

## 5. Edge Function `supabase/functions/trigger-alert/index.ts` (Deno)

Contrato: `POST { alert_id: uuid }` con el `Authorization: Bearer <JWT>` del usuario.

1. `OPTIONS`/`POST`; JWT propio con `auth.getUser()` → **401** sin usuario.
2. Body inválido o `alert_id` que no es uuid → **400**. Alerta inexistente → **404**.
3. Con `SUPABASE_SERVICE_ROLE_KEY`: alerta → `community_id`; el usuario debe tener
   `community_members.membership_status='active'` en esa comunidad → si no, **403**.
4. `alert_recipients` de la alerta × `push_subscriptions` activas (`revoked_at is null`).
5. Envío con `npm:web-push` (`sendNotification`) usando `VAPID_PUBLIC_KEY` /
   `VAPID_PRIVATE_KEY` y `TTL: 43200` (12 h).
6. **Idempotencia**: verificación previa por par
   (`alert_id + recipient_user_id + push_subscription_id`); si ya hay un job `sent` no se
   reenvía. El resultado se escribe reutilizando la fila placeholder creada por
   `trigger_alert` (la que tiene `push_subscription_id=null`); si no existe, se inserta una
   fila nueva. Estados usados: `sent` | `failed` (más `attempts`, `last_error`, `sent_at`).
7. Respuesta **200** `{ sent, failed }`. Secretos faltantes → **500**
   `{ error: "Faltan secretos de push" }` (sin detalle). Nunca se imprimen claves, tokens ni
   endpoints: los errores se reducen a `web-push <status>` o al nombre de la excepción.

## 6. Secretos y variables a configurar

Generar el par VAPID **una sola vez**:

```bash
npx web-push generate-vapid-keys
# → Public Key  (va al frontend, NO es secreta)
# → Private Key (sólo secreto de Supabase)
```

Supabase (secretos de la Edge Function):

```bash
supabase secrets set VAPID_PUBLIC_KEY=<Public Key> VAPID_PRIVATE_KEY=<Private Key>
# opcional: contacto VAPID (mailto: o https:). Si falta, se usa SUPABASE_URL.
supabase secrets set VAPID_SUBJECT=mailto:contacto@dominio.com
```

Frontend (Vercel → Settings → Environment Variables, en Production **y** Preview):

```bash
VITE_VAPID_PUBLIC_KEY=<Public Key>   # la misma que VAPID_PUBLIC_KEY
```

Después del alta/rebaja de la variable: **redeploy** en Vercel. En local va en `.env`
(igual que `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, ver `.env.example`).

Ya existentes (no se tocan): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (los tres inyectados por Supabase en las funciones).

## 7. Cómo probar

**En desarrollo (`npm run dev`)**

- No hay SW (`devOptions.enabled = false`): el botón de Configuración muestra
  *«Las notificaciones push están disponibles en la versión publicada.»*. Eso es esperado.

**En build local (recomendado para probar el SW)**

```bash
npm run build
npm run preview          # http://localhost:4173
```

1. Abrir `http://localhost:4173/configuracion` → *Activar notificaciones* → permitir.
2. Verificar en DevTools → *Application → Service Workers* que `sw.js` está activo y en
   Supabase que aparece la fila en `push_subscriptions`.
3. Con una segunda cuenta (misma comunidad, membresía activa) disparar la alarma desde
   `/inicio`: el dispositivo suscrito debe recibir la notificación.
4. Verificar `notification_jobs`: `status='sent'`, `attempts=1`, `sent_at` y
   `push_subscription_id` cargado (la fila placeholder se reutiliza).
5. Clic en la notificación → abre/enfoca `/alertas/<id>`.
6. Reinvocar la función con el mismo `alert_id` (por ejemplo con `curl` y el JWT de la
   sesión): debe responder `{ "sent": 0, "failed": 0 }` (idempotencia).

**Despliegue**

```bash
supabase functions deploy trigger-alert
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
# Vercel: VITE_VAPID_PUBLIC_KEY + redeploy
```

Luego repetir el paso 1-4 sobre la URL publicada (HTTPS obligatorio para Web Push).

**Invocación manual (curl)**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/trigger-alert" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"alert_id":"<uuid-de-la-alerta>"}'
# → {"sent":1,"failed":0}
```

## 8. Límites conocidas

- **Push no existe en desarrollo** (`npm run dev`): el SW sólo se genera en build
  (`injectManifest` sobre `dist/`).
- No hay cola ni cron: si nadie invoca `trigger-alert`, no se envía nada. Los jobs
  `failed` sólo se reintentan si se vuelve a invocar la función con el mismo `alert_id`
  (los `sent` nunca se reenvían).
- La idempotencia es por (alerta, destinatario, suscripción): si el dispositivo cambia de
  suscripción (endpoint nuevo) puede recibir un segundo envío de la misma alerta.
- Sólo llega notificación al dispositivo con permiso concedido y suscripción vigente;
  si el navegador bloqueó los permisos hay que reactivarlos en su configuración.
- Un destinatario sin suscripciones activas no genera job nuevo (queda en `pending`).
- El SW sólo precachea los assets listados en `globPatterns`; los iconos se sirven desde
  la caché de precache una vez instalado.

## 9. URLs de la documentación oficial usada

| URL | Uso |
| --- | --- |
| https://developer.mozilla.org/en-US/docs/Web/API/Push_API | API de push vista desde el SW |
| https://developer.mozilla.org/en-US/docs/Web/API/Push_API/Using_the_Push_API | `applicationServerKey` / claves VAPID |
| https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification | Opciones de `showNotification` (`icon`, `badge`, `tag`, `data`) |
| https://github.com/web-push-libs/web-push#readme | `setVapidDetails` / `sendNotification` |
| https://github.com/web-push-libs/web-push#sendnotificationpushsubscription-payload-options | Opciones (`TTL`, headers) y errores `statusCode` |
| https://supabase.com/docs/guides/functions/secrets | `supabase secrets set` |
| https://supabase.com/docs/guides/functions/functions-api | `supabase.functions.invoke` desde el cliente |

## 10. Archivos tocados

| Archivo | Cambio |
| --- | --- |
| `vite.config.ts` | `strategies: 'injectManifest'`, `srcDir`/`filename`, bloque `injectManifest` (reemplaza a `workbox`) |
| `src/sw.ts` | **nuevo**: precache, fallback de navegación, `push` y `notificationclick` |
| `src/lib/pwa.ts` | sin cambios (verificado que compila con `injectManifest`) |
| `src/lib/push.ts` | mensajes claros en español; lectura de registro sin instalar SW en `hasActivePush`/`disablePush` |
| `src/data/notifications.ts` | **nuevo**: `dispatchAlertPush()` |
| `src/vite-env.d.ts` | `VITE_VAPID_PUBLIC_KEY` |
| `.env.example` | `VITE_VAPID_PUBLIC_KEY` (comentario, sin secretos) |
| `supabase/functions/trigger-alert/index.ts` | **nuevo**: Edge Function con web-push + idempotencia |
| `package.json` / `package-lock.json` | `workbox-precaching`, `workbox-routing`, `workbox-core` (7.4.1, devDependencies) |
| `docs/FASE7_push.md` | este documento |

## 11. Verificaciones ejecutadas

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | OK (sin errores) |
| `npm run lint` | OK (sin errores ni warnings) |
| `npm run test` | OK (1 archivo, 4 pruebas en verde) |
| `npm install` | OK (`up to date`, 0 vulnerabilidades) |
| `npx vite build` | El SW se construye bien (`dist/sw.js`, manifest inyectado); el build de la app falla por un archivo ajeno con encoding inválido (ver pendientes) |

## 12. Pendientes (requieren cambios fuera de esta fase)

1. **`src/pages/AlertDetailPage.tsx` está guardado en ANSI/Windows-1252, no en UTF-8.**
   Eso rompe `npm run build` (rolldown: *«stream did not contain valid UTF-8»*).
   Solución: reabrirlo y guardarlo como UTF-8. (No es un archivo de esta fase.)
2. **Conectar el botón de alarma al despacho**: en `src/pages/HomePage.tsx`, después de
   `triggerAlert(...)`, llamar a `dispatchAlertPush(result.alert_id)` (importándolo de
   `src/data/notifications`). Sin eso, los push no se disparan automáticamente.
3. Cargar `VITE_VAPID_PUBLIC_KEY` en Vercel y los secretos VAPID en Supabase (sección 6).
