# FASE 9 — Suscripciones con Mercado Pago

**Estado: completada** (pendientes manuales listados al final).

## 1. Producto elegido

| Ítem | Decisión |
| --- | --- |
| Producto | **Suscripciones (API de Preapproval) sin plan asociado** |
| Modelo | "Pago pendiente": el usuario autoriza su tarjeta en el checkout **alojado** de MP (`init_point`) y MP cobra automáticamente todos los meses |
| Frecuencia | `auto_recurring: { frequency: 1, frequency_type: "months", currency_id: "ARS" }` |
| Importe | No se envía en el alta: vive en `subscription_plans.price_ars` (seed = `0` hasta que el admin lo carga) |
| Identidad | `external_reference = user_id` (uuid del usuario en Supabase) |
| `preapproval_plan_id` | **No se envía**: los planes de MP obligan a crear el plan en MP con precio propio; el precio autoritativo es el de la BD |
| Estado inicial | `status: "pending"` en MP; en nuestra BD la fila queda como estaba y **solo un pago verificado server-side** la pone en `active` |

Por qué no los alternativos:

- **Checkout Pro de pago único / Payment Links**: cobro manual, no renueva solo.
- **Preapproval con plan asociado**: exige crear el plan en MP (precio duplicado y divergente con `admin_set_plan_price`).
- **Tarjeta guardada (`card_token_id` / `payment_profile_id`)**: requiere tarjeta propia/tokenizada en nuestro frontend; además `payment_profile_id` y `auto_cancel` **no existen** en el body documentado de `POST /preapproval`, así que no se envían.

## 2. Endpoints y documentación oficial usada

| URL oficial | Qué aporta |
| --- | --- |
| https://www.mercadopago.com.ar/developers/es/docs/subscriptions | Vista general del producto Suscripciones |
| https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval/post | `POST /preapproval`: body, `back_url`, `notification_url`, respuesta `init_point` |
| https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/get-preapproval/get | `GET /preapproval/{id}`: `status`, `next_payment_date`, `auto_recurring` |
| https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments | Modelo "sin plan asociado con pago pendiente" (`status: "pending"` + `init_point`) |
| https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management | Estados (`authorized` / `paused` / `cancelled`), cancelaciones |
| https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/your-integrations/credentials | Access Token test vs. producción |
| https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/your-integrations/notifications/webhooks | Webhooks de Suscripciones: no se configuran desde el panel → se envía `notification_url` en la creación; el secreto se obtiene en **Tu integración > Webhooks > Configurar notificación** |
| https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/payment-notifications | Firma `x-signature` (manifest + HMAC-SHA256), respuesta 200/201, reintentos |
| https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/get-payment/get | `GET /v1/payments/{id}`: estado real del cobro (tópico `payment`) |

## 3. Funciones implementadas

### 3.1 `mercadopago-create` — `supabase/functions/mercadopago-create/index.ts`

`POST ${SUPABASE_URL}/functions/v1/mercadopago-create` (Authorization: JWT del navegador).

1. OPTIONS/POST; JWT propio con `auth.getUser()` → **401** sin usuario.
2. `profiles.suspended` (consulta con el JWT; RLS `profiles_select_self_or_admin`) → **403** suspendido.
3. Plan activo con `service role`: si `price_ars <= 0` → **400** "El precio del plan todavía no fue configurado por el administrador".
4. `POST https://api.mercadopago.com/preapproval` con `reason`, `external_reference`, `payer_email`, `back_url` (`${APP_URL}/suscripcion?resultado=exito|fallo|pendiente`), `notification_url` (la webhook), `status: "pending"`, `auto_recurring`.
5. Upsert en `user_subscriptions` (`onConflict: user_id`) guardando `provider = 'mercadopago'` y `provider_subscription_id`; **no se cambia `status`**.
6. Respuesta 200: `{ init_point, preapproval_id, environment }` (`environment`: `test` si el token empieza con `TEST-`, si no `production`). Error de MP → **502** genérico (detalle sólo en el log del servidor).

### 3.2 `mercadopago-webhook` — `supabase/functions/mercadopago-webhook/index.ts`

`POST ${SUPABASE_URL}/functions/v1/mercadopago-webhook` (sin JWT: se despliega con `--no-verify-jwt`).

1. **Firma obligatoria** `x-signature = "ts=<ts>,v1=<v1>"`:
   manifest = `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (pares ausentes se omiten; termina en `;`),
   `v1 = HMAC-SHA256(MP_WEBHOOK_SECRET, manifest)` en hex, comparación en tiempo constante.
   Sin secreto → 500; sin firma o inválida → **401**.
2. Tópico desde query (`type`/`topic`/`data.id`) o body (`type`, `action`, `data.id`).
3. **Estado real consultado a MP server-side** (`GET /v1/payments/{id}` o `GET /preapproval/{id}`): nunca se confía en el payload.
4. **Idempotencia**: `payment_events` con `provider_event_id` único vía `upsert(..., ignoreDuplicates)` (ON CONFLICT DO NOTHING); si ya existía → 200 `duplicate` sin reprocesar.
5. **Verificación de monto**: `transaction_amount` vs `subscription_plans.price_ars` (±0.005) y moneda `ARS`; no coincide → evento `rejected` + warning, **no activa**.
6. **Activación** (sólo un pago `approved` verificado): `status='active'`, `current_period_start = date_approved`, `current_period_end = preapproval.next_payment_date` (o +1 mes si MP no lo informa), `cancel_at_period_end=false`.
7. **Cancelación** respeta el período abonado: con período vigente → `cancel_at_period_end=true`; el cron `refresh_subscription_states()` lo pasa a `canceled` al vencer `current_period_end`.
8. Rechazo sin período vigente → `past_due`; pausada sin período → `past_due`.
9. Si un paso de escritura falla se **borra el evento insertado** y se responde 502 para que MP reintente.

## 4. Flujo de estados

| Estado (`user_subscriptions.status`) | Cuándo | Quién lo escribe |
| --- | --- | --- |
| `trial` | 7 días de prueba (`subscription_plans.trial_days`) | funciones de la FASE anterior |
| `none` / sin fila → fila con `provider='mercadopago'` | usuario toca "Suscribirme" y se crea el preapproval | `mercadopago-create` |
| (MP) `pending` + `init_point` | el usuario todavía no autorizó la tarjeta | Mercado Pago |
| `active` | llega el webhook de un pago **aprobado** y el monto coincide | `mercadopago-webhook` |
| `active` + `cancel_at_period_end` | el usuario cancela con período pagado corriendo | `mercadopago-webhook` |
| `canceled` | termina el período cancelado (cron) o MP informa `cancelled` con fin ya vencido | `refresh_subscription_states()` / webhook |
| `past_due` | cobro rechazado/pausado sin período vigente | `mercadopago-webhook` |

Estados de MP: `payment` = `approved`/`rejected`/`pending`/`refunded`; `preapproval` = `authorized`/`paused`/`cancelled`/`rejected`/`pending`. `authorized` **no** activa por sí mismo: sólo lo hace un cobro verificado.

## 5. Secretos y despliegue

Secretos de Supabase (los tres primeros los inyecta Supabase automáticamente; los últimos tres se setean a mano):

```bash
# Los inyectados: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
supabase secrets set \
  MP_ACCESS_TOKEN="APP_USR-..." \
  MP_WEBHOOK_SECRET="..." \
  APP_URL="https://alarma-vecinal.vercel.app"
```

| Secreto | Valor | Dónde se obtiene |
| --- | --- | --- |
| `MP_ACCESS_TOKEN` | Access Token de la app (test o producción) | https://www.mercadopago.com.ar/developers > Tu cuenta > Administración > Credenciales (o "Credenciales de prueba") |
| `MP_WEBHOOK_SECRET` | Clave secreta de webhooks | Tu integración > Webhooks > Configurar notificación (si se pierde, se regenera y hay que volver a `supabase secrets set`) |
| `APP_URL` | `https://alarma-vecinal.vercel.app` | Dominio de Vercel |

Nunca imprimen tokens ni datos de tarjeta; `MP_ACCESS_TOKEN` jamás con prefijo `VITE_`.

Despliegue (desde la raíz del repo):

```bash
supabase functions deploy mercadopago-create
supabase functions deploy mercadopago-webhook --no-verify-jwt   # MP no manda JWT
```

Nota sobre entornos: la documentación 2026 muestra tokens de prueba también con prefijo `APP_USR` (además del clásico `TEST-`); el código sólo usa el prefijo para etiquetar la respuesta y **no cambia el endpoint** (`api.mercadopago.com` es el mismo host para ambos; se distingue por el token). Verificá en el panel con qué cuenta estás trabajando.

## 6. Cómo probar en sandbox

1. **Precio**: sin precio cargado, `create` responde 400. Cargarlo con `select admin_set_plan_price('<plan_id>', <importe>);` (sólo rol admin) desde el SQL editor.
2. **Desplegar** ambas funciones y setear los 3 secretos (`MP_ACCESS_TOKEN` de prueba).
3. **Alta**: con el JWT de un usuario de prueba:

   ```bash
   curl -sS -X POST "$SUPABASE_URL/functions/v1/mercadopago-create" \
     -H "Authorization: Bearer <USER_JWT>" -H "Content-Type: application/json" -d '{}'
   ```

4. **Checkout**: abrir el `init_point` devuelto, entrar con el **usuario comprador de prueba** y pagar con la tarjeta de prueba de MP. Queda `pending` en MP y sin cambios en nuestra BD.
5. **Webhook en sandbox**: *los pagos de prueba no envían notificaciones reales*; probá de dos formas:
   - desde **Tu integración > Webhooks**, con el simulador de eventos del panel (envía la firma real); o
   - **firma manual** con tu `MP_WEBHOOK_SECRET` usando un `data.id` real (un pago de prueba creado en el paso 4), porque la función consulta el estado a MP y con un id inexistente responde 502:

     ```bash
     # 1) calcular ts, manifest y firma (Node)
     node -e "const c=require('crypto');const id=process.argv[1];const ts=Date.now().toString();const m='id:'+id+';request-id:test-1;ts:'+ts+';';console.log(JSON.stringify({sig:'ts='+ts+',v1:'+c.createHmac('sha256',process.env.MP_WEBHOOK_SECRET).update(m).digest('hex'),url:'?data.id='+id+'&type=payment'}))" 12345678
     # 2) POST con esos headers/query
     curl -sS -X POST "$SUPABASE_URL/functions/v1/mercadopago-webhook<url>" \
       -H "x-signature: <sig>" -H "x-request-id: test-1" \
       -H "Content-Type: application/json" -d '{"action":"payment.updated","type":"payment","data":{"id":"12345678"}}'
     ```

   Esperado: `{"received":true,...}` con `status:"approved"` y la fila en `active`. Reenviar el mismo evento → `{"duplicate":true}` (idempotencia). Firma alterada → **401**.
6. **Verificar en BD**: `select status, current_period_start, current_period_end from user_subscriptions;` y `select event_type, status, amount_ars, processed_at from payment_events order by created_at desc limit 10;`
7. **Producción**: repetir con Access Token de producción y regenerar `MP_WEBHOOK_SECRET` (el secreto de test no sirve en prod).

## 7. Tareas manuales pendientes

1. **Pendiente (bloqueante)**: obtener credenciales de Mercado Pago y setear
   `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `APP_URL` (`supabase secrets set ...`).
   Checklist: sección 13 de `docs/DESPLEGUE.md`.
2. **Hecho**: las cuatro funciones están desplegadas (`mercadopago-webhook` con
   `--no-verify-jwt`). La FASE 16 agregó `{"action":"cancel"}` a `mercadopago-create`:
   hay que redesplegarla cuando se publique esa fase.
3. **Hecho**: el precio está cargado (Plan mensual, 3000 ARS; `admin_set_plan_price`).
4. **Hecho en la FASE 16**: `/suscripcion` lee `?resultado=exito|fallo|pendiente` del
   `back_url` (aviso + limpiezo de la query + recarga) y ofrece *Cancelar suscripción*
   (`PUT /preapproval/{id}`). **Pendiente**: los textos legales (condiciones/precio).
5. **Pendiente**: probar el flujo completo en sandbox (sección 6) y, al publicar,
   repetir con credenciales de producción.

Nota (FASE 16): la red de seguridad de vencimientos es el cron horario
`refresh_subscription_states()` (`0014_subscription_cron.sql`); la función se corrigió en
`0015_subscription_refresh_fix.sql` porque el `CASE` del segundo UPDATE no casteaba al
enum `subscription_status` y fallaba siempre.
