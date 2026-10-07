# Despliegue — checklist de puesta en producción

Checklist manual en orden. Cada paso indica el comando o la ubicación exacta.
No hay pasos automáticos: hasta que no se completen, la app corre sólo en local.

Referencias del repo: `docs/FASE7_push.md` (Web Push), `docs/FASE9_mercadopago.md`
(Mercado Pago), `docs/ARQUITECTURA.md` (modelo de datos y seguridad).

---

## 0. Previo: subir el trabajo actual a GitHub

El repositorio remoto (`https://github.com/lagarts/AlarmaBull`) tiene **un solo commit**
(el de la FASE 1) y todavía no incluye `vercel.json`, `supabase/`, `tests/`, `scripts/` ni
las pantallas de las fases 2–10. Todo eso está sólo en el working copy.

1. Revisar `git status` y `git diff`.
2. Commitear y pushear a `main` (este paso lo hacés vos; no está automatizado).

> La URL publicada del proyecto es `https://alarma-bull.vercel.app` (verificada).
> Ojo: `.env.example` y `docs/FASE9_mercadopago.md` mencionan
> `https://alarma-vecinal.vercel.app`, que hoy responde 404. Usar siempre la URL real
> de Vercel (Project → Domains).

---

## 1. Proyecto en Supabase + migraciones

1. Crear el proyecto: <https://supabase.com/dashboard> → **New project** (elegir región,
   guardar la contraseña de la base).
2. Aplicar las migraciones **en orden**, desde **SQL Editor → New query** (copiar y pegar
   cada archivo completo, un archivo por consulta):

   | Orden | Archivo | Qué hace |
   | --- | --- | --- |
   | 1 | `supabase/migrations/0001_initial_schema.sql` | Tipos, 15 tablas, índices |
   | 2 | `supabase/migrations/0002_functions.sql` | Funciones `SECURITY DEFINER`, trigger de alta |
   | 3 | `supabase/migrations/0003_rls.sql` | RLS en las 15 tablas + publicación `supabase_realtime` |
   | 4 | `supabase/migrations/0004_seed.sql` | Plan sembrado con `price_ars = 0` (sin precio inventado) |
   | 5 | `supabase/migrations/0005_seed_emergency_contacts.sql` | 911 / 100 / 107 con fuente `argentina.gob.ar` |

3. **Alternativa con CLI** (requiere `supabase` en el PATH y haber hecho `supabase login`):
   el directorio del repo todavía no tiene `supabase/config.toml`, así que primero
   generalo con `supabase init` (crea ese archivo y deja `supabase/migrations/` como
   está; si te preocupa el ruido en el repo, preferí el SQL Editor), después:

   ```bash
   supabase link --project-ref <PROJECT_REF>   # Settings → General → Project ID
   supabase db push                            # aplica supabase/migrations en orden
   ```

4. Verificar en **Table Editor** que existan `profiles`, `communities`,
   `subscription_plans` (con `price_ars = 0`) y `emergency_contacts` (3 filas).

---

## 2. Variables de entorno locales

```powershell
Copy-Item .env.example .env
```

Completar en `.env`:

| Variable | Valor | Dónde se obtiene |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `https://<proyecto>.supabase.co` | Supabase → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | clave anónima pública | Supabase → Settings → API → anon public |
| `VITE_APP_URL` | `https://alarma-bull.vercel.app` (o la URL de Vercel que quieras usar) | Vercel → Project → Domains |
| `VITE_VAPID_PUBLIC_KEY` | clave pública VAPID | paso 6 |

Nunca commitear `.env`. Secretos de servidor (service role, Mercado Pago, clave privada
VAPID) van **sólo** en Supabase, nunca acá.

---

## 3. Auth: proveedor de email y confirmación

En Supabase → **Authentication → Providers → Email**:

1. Proveedor **habilitado** (email/password).
2. Decidir **si se exige confirmación de email** (`Confirm email`):
   - **Sí**: el usuario recibe el link de confirmación antes de poder entrar. Ese link
     apunta a la Site URL, así que hay que dejar bien configurados los ítems del punto 3.
   - **No**: el registro entra directo a la app (más simple para la prueba inicial).
     La app no tiene pantalla propia de confirmación.
3. En **Authentication → URL Configuration**:
   - **Site URL** = `VITE_APP_URL`.
   - Agregar a **Redirect URLs** `https://<tu-dominio>/**` (la recuperación de contraseña
     redirige a `${VITE_APP_URL}/configuracion`; ver `src/pages/RecoverPage.tsx`).

Flujos que tienen que funcionar: registro, login, recuperación de contraseña
(`src/pages/AuthPage.tsx` y `RecoverPage.tsx`).

---

## 4. Primer administrador

La única forma desde la UI no existe a propósito: nadie se autoasigna rol (RLS + trigger
`profiles_guard`). Registrar primero el usuario desde la app, y luego en **SQL Editor**:

```sql
update public.profiles
set role = 'admin_general'
where id = (select id from auth.users where email = 'correo@ejemplo.com');
```

Verificar:

```sql
select u.email, p.full_name, p.role, p.suspended
  from public.profiles p
  join auth.users u on u.id = p.id
 where u.email = 'correo@ejemplo.com';
-- role debe ser admin_general
```

Notas:

- El rol del enum es `admin_general` (no `admin`; `admin` es el rol **de comunidad** en
  `community_members.role`).
- `admin_promote_by_email(p_email)` existe en `0002_functions.sql` pero está **revocada**
  a `anon` y `authenticated` y concedida sólo a `postgres`/`service_role`: sirve para el
  SQL Editor (o service role), no para la app.
- El rol se puede revertir con el mismo update poniendo `role = 'user'`.

---

## 5. Edge Functions: despliegue y secretos

Requiere `supabase login` y `supabase link --project-ref <PROJECT_REF>`.

**Importante:** `--no-verify-jwt` va **sólo** en el webhook de Mercado Pago (MP no manda
JWT). `mercadopago-create` y `trigger-alert` validan el JWT ellos mismos y deben seguir
recibiéndolo; no desplegarlas con el flag.

```bash
supabase functions deploy mercadopago-create
supabase functions deploy mercadopago-webhook --no-verify-jwt
supabase functions deploy trigger-alert
```

Verificado en `docs/FASE9_mercadopago.md` (sección 5) y `docs/FASE7_push.md` (sección 7).

Secretos (Supabase → **Edge Functions → Secrets**, o CLI):

```bash
# Mercado Pago (docs/FASE9_mercadopago.md, sección 5)
supabase secrets set MP_ACCESS_TOKEN="APP_USR-..." MP_WEBHOOK_SECRET="..." APP_URL="https://alarma-bull.vercel.app"

# Web Push (docs/FASE7_push.md, sección 6)
supabase secrets set VAPID_PUBLIC_KEY="<Public Key>" VAPID_PRIVATE_KEY="<Private Key>"
# opcional: contacto VAPID; si falta se usa SUPABASE_URL
supabase secrets set VAPID_SUBJECT="mailto:contacto@dominio.com"
```

| Secreto | Quién lo necesita | Origen |
| --- | --- | --- |
| `MP_ACCESS_TOKEN` | `mercadopago-create`, `mercadopago-webhook` | Mercado Pago → Tu cuenta → Credenciales |
| `MP_WEBHOOK_SECRET` | `mercadopago-webhook` | Mercado Pago → Tu integración → Webhooks → Configurar notificación |
| `APP_URL` | `mercadopago-create` (armado de `back_url`) | URL real de Vercel |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `trigger-alert` | paso 6 |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase.
`MP_ACCESS_TOKEN` jamás con prefijo `VITE_`.

---

## 6. Claves VAPID

Generar el par **una sola vez** (`web-push` lo baja `npx` si no está instalado):

```bash
npx web-push generate-vapid-keys
# → Public Key
# → Private Key
```

1. **Public Key** → secreto `VAPID_PUBLIC_KEY` de Supabase (paso 5).
2. **Private Key** → secreto `VAPID_PRIVATE_KEY` de Supabase (paso 5).
3. **Public Key** → Vercel → Project → **Settings → Environment Variables** →
   `VITE_VAPID_PUBLIC_KEY`, en **Production y Preview**.
4. En local: `VITE_VAPID_PUBLIC_KEY` en `.env`.

Cualquier alta/baja de variable `VITE_*` exige **redeploy** en Vercel.

---

## 7. Precio del plan

El seed crea el plan con `price_ars = 0` a propósito: **nunca hay precios inventados en
el código**. Hasta que no se cargue, la UI muestra:
*"El precio del plan todavía no fue configurado por el administrador."*
(`src/components/subscription/PlanCard.tsx`) y `mercadopago-create` responde 400.

Opción A (recomendada), desde la app: entrar con la cuenta admin → **Administración**
(`/admin`) → panel **Planes** → cargar el importe en ARS → Guardar.

Opción B, desde **SQL Editor**:

```sql
select id, name, price_ars, active from public.subscription_plans;

select public.admin_set_plan_price('<plan_id>', 1500);   -- sólo rol admin_general
```

---

## 8. Vercel

1. <https://vercel.com/new> → **Import Git Repository** → `lagarts/AlarmaBull` (paso 0).
2. Framework detectado como **Vite** gracias a `vercel.json`
   (`installCommand: npm ci`, `buildCommand: npm run build`, `outputDirectory: dist`,
   rewrite de SPA a `index.html` + headers de `/sw.js`).
3. **Settings → Environment Variables**: crear `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, `VITE_APP_URL`, `VITE_VAPID_PUBLIC_KEY` en
   **Production y Preview**.
4. **Deploy**. Verificar que la raíz redirija a `/acceder` (no hay landing) y que
   `/sw.js` responda 200 con `Service-Worker-Allowed: /`.
5. Si usás dominio propio, agregarlo en **Domains** y actualizar `VITE_APP_URL` +
   el Site URL de Supabase (paso 3).

---

## 9. Verificación posterior

En local:

```bash
npm run typecheck && npm run lint && npm run test
powershell -ExecutionPolicy Bypass -File scripts\test-db.ps1
```

Sobre la URL publicada (HTTPS obligatorio para Web Push), con dos cuentas en la misma
comunidad:

1. **Registro** → entra a `/inicio` y ve su suscripción `trial` de 7 días.
2. **Creación de comunidad** → `/comunidad/crear`, copiar el código, que otra cuenta se
   una desde `/comunidad/unirse` y la apruebe desde `/integrantes`.
3. **Alarma** → desde `/inicio`, confirmar; verificar en BD:
   `select id, status, idempotency_key from public.alerts order by created_at desc limit 5;`
   y `select * from public.alert_recipients;`. Reintentar con la misma clave → devuelve la
   misma alerta (`duplicado`), y un disparo inmediato siguiente cae en el cooldown de 10 s.
4. **Push** → `/configuracion` → *Activar notificaciones* → permitir; disparar una alerta
   desde la otra cuenta y verificar `notification_jobs` (`status = 'sent'`). Ver
   `docs/FASE7_push.md` (sección 7) para el detalle.
5. **Suscripción** → con precio cargado, "Suscribirme" debe abrir el `init_point` de MP;
   probar el webhook en sandbox según `docs/FASE9_mercadopago.md` (sección 6).
6. **Contactos de emergencia** → deben aparecer en `/inicio` (911/100/107 con su fuente)
   y ser editables desde `/admin`.
7. **Estoy Bien** → `/estoy-bien` → *Configurar y activar* → aceptar el uso preventivo y
   guardar; verificar en BD:
   `select user_id, enabled, reminder_time from public.estoy_bien_settings;`.
   Confirmar con *ESTOY BIEN HOY* y comprobar `public.estoy_bien_checks`.
   Luego, con el cron activo, avanzar la hora de recordatorio a 1 minuto antes, esperar y
   revisar `public.estoy_bien_alerts` y `public.estoy_bien_reminders`.

---

## 10. Módulo Estoy Bien (FASE 12)

Estado al 4/10/2026:

1. [x] **Migración 0008** aplicada en el SQL Editor (verificado por HTTP: la RPC
   `estoy_bien_get_state` existe y está revocada de `anon`).
2. [x] **Extensiones** `pg_cron` + `pg_net` habilitadas (las usó el paso 5 sin avisos).
3. [x] **Secreto para el cron** → SQL Editor:
   ```sql
   select vault.create_secret('EL_SERVICE_ROLE_KEY', 'estoy_bien_service_key');
   ```
   (Project Settings → API → `service_role`. Se usa sólo para que el cron llame a la
   Edge Function; nunca se expone al navegador.) Verificado el 4/10: prefijo
   `eyJhbGciOiJIUzI1NiIsInR`, largo ≈ 176.
4. [x] **Edge Functions** desplegadas con CLI (`supabase login` +
   `supabase link --project-ref kbzyeiymvlzjyuepujvy`):
   ```bash
   supabase functions deploy trigger-alert
   supabase functions deploy mercadopago-create
   supabase functions deploy mercadopago-webhook --no-verify-jwt
   supabase functions deploy estoy-bien-deliver
   ```
   Secretos VAPID cargados: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
   `MP_ACCESS_TOKEN` sigue sin cargar → `mercadopago-create` responde
   "Configuración incompleta del servidor".
5. [x] **Cron** → `supabase/migrations/0009_cron.sql` aplicado; salió el aviso
   `OK: el cron de Estoy Bien está activo.`
   (job `estoy-bien`, cada minuto: `estoy_bien_tick()` + `estoy-bien-deliver`).
6. [x] **Verificación** (4/10) → en BD:
    ```sql
    select jobid, schedule, command from cron.job where jobname = 'estoy-bien';
    select name from vault.decrypted_secrets where name = 'estoy_bien_service_key';
    select status, count(*) from public.estoy_bien_reminders group by status;
    select jobid, status, return_message, start_time
      from cron.job_run_details
     order by start_time desc limit 5;
    select id, status_code, content from net._http_response order by id desc limit 5;
    ```
    Resultado: job `1` corriendo cada minuto con `status = 'succeeded'` y
    `net._http_response` devolviendo `200` +
    `{"processed":0,"sent":0,"failed":0,"skipped":0}` (0 porque todavía no hay
    avisos push pendientes).

> **Nota:** el cron manda la `service_role` del Vault como `Authorization`. La función
> acepta esa clave **o** cualquier JWT del proyecto con claim `role = "service_role"`
> (`jwtRole()` en `estoy-bien-deliver/index.ts`), porque el valor de
> `SUPABASE_SERVICE_ROLE_KEY` del entorno no siempre coincide con la clave legacy.

Contactos personales (FASE 12): los avisos por **SMS/email** quedan en
`public.estoy_bien_reminders` con `status = 'pending'` y
`last_error = 'sin proveedor de SMS/email configurado'` hasta que se cargue un proveedor;
sólo el push y la notificación in-app se envían hoy. Desde la FASE 15 (ver sección 12) el
contacto que aceptó el link **con una cuenta** no pasa por ese camino: recibe el aviso por
la app (campanita + push) y no se le crean filas de SMS/email.

---

## 11. Aviso de precaución (FASE 13)

El botón amarillo **PRECAUCIÓN** del inicio manda un mensaje de texto libre (1..200
caracteres) a todos los vecinos, con la misma cadena que la alerta roja:
`trigger_alert` → `alert_recipients` → `notification_jobs` → Edge Function `trigger-alert`
→ Web Push (título *"Precaución vecinal"*, cuerpo = mensaje) → historial y detalle.

**Orden importa** (si no, el botón de la app y la Edge Function fallan). Hecho el 5/10/2026:

1. [x] **Migración 0010** → SQL Editor de Supabase → pegar
   `supabase/migrations/0010_precaucion.sql` completo y ejecutar. Crea el tipo
   `alert_severity`, las columnas `alerts.severity`/`alerts.message` y reemplaza
   `trigger_alert` por la versión con `p_severity`/`p_message`. Es compatible con la app
   publicada: verificado por HTTP, la RPC responde `No autenticado` tanto con
   `p_severity` como sin él.
2. [x] **Edge Function** → redesplegada `trigger-alert` (lee `severity` y `message` para
   armar el payload del push):
   ```bash
   supabase functions deploy trigger-alert
   ```
3. [x] **Frontend** → commit + push (Vercel redespliega solo).
4. [ ] **Verificación** → en la app: *PRECAUCIÓN* → escribir el mensaje → enviar; en BD:
   ```sql
   select id, severity, message, created_at from public.alerts order by created_at desc limit 3;
   select status, count(*) from public.notification_jobs group by status;
   ```
   y en el teléfono del vecino debe llegar la notificación *"Precaución vecinal"* con el
   texto. Cooldowns: 10 s para la alerta roja y 15 s para los avisos, **por separado**.

---

## 12. Avisos de Estoy Bien a los contactos por la app (FASE 15)

El contacto que acepta el link de Estoy Bien **con una cuenta** pasa a recibir el aviso de
alerta (y el de resolución) dentro de la app: fila en `public.notifications` (campanita) +
fila `estoy_bien_reminders` con `channel = 'push'` que manda la cola del cron
(`estoy-bien-deliver`). El que acepta **sin cuenta** no existe como usuario, así que sigue
en el camino de SMS/email pendiente; **rechazar** el link sigue pudiendo hacerse sin cuenta.

**Orden importa** (el frontend nuevo lee la columna `account_id`). Hecho el 7/10/2026:

1. [x] **Migración 0013** → SQL Editor de Supabase → pegar
   `supabase/migrations/0013_contact_alerts.sql` completo y ejecutar. Agrega
   `estoy_bien_contacts.account_id`, hace que `estoy_bien_contact_respond` exija sesión al
   aceptar y cambia `estoy_bien_tick` / `estoy_bien_confirm` para avisar a los contactos
   con cuenta.
2. [x] **Edge Function** → redesplegada `estoy-bien-deliver` (manda el push a la cuenta del
   contacto y juzga la confirmación por la persona vigilada, no por el destinatario):
   ```bash
   supabase functions deploy estoy-bien-deliver
   ```
3. [x] **Frontend** → commit + push (Vercel redespliega solo). El link de invitación lleva
   a `/acceder?redirect=...` si no hay sesión y vuelve a la invitación al entrar.
4. [ ] **Verificación** → en la app: *Contactos personales* → copiar el link → abrirlo con
   otra cuenta → **Acepto ser contacto** → aparece el badge **Avisa en la app**; en BD:
   ```sql
   select full_name, status, account_id from public.estoy_bien_contacts order by created_at desc;
   ```
   y al vencer un ciclo, el contacto debe recibir la campanita *"Estoy bien: sin
   confirmación"* y el push en el teléfono (si tiene dispositivo registrado).

---

## 13. Débito automático con Mercado Pago (FASE 16)

La suscripción se cobra sola: `mercadopago-create` da de alta el *preapproval* mensual
(`auto_recurring: 1 mes`), el usuario autoriza su tarjeta en el checkout alojado de MP y
`mercadopago-webhook` activa, renueva y cancela con el estado real que consulta a la API.
La FASE 16 cierra el circuito en la app:

- **Cancelar desde la app** → botón *Cancelar suscripción* en `/suscripcion` (con
  confirmación) → `mercadopago-create` con `{"action":"cancel"}` → `PUT /preapproval/{id}`;
  si el período pagado sigue vigente queda `cancel_at_period_end` y la suscripción corre
  hasta el fin del período.
- **Al volver del checkout** → `/preapproval` sólo admite una `back_url` en *string*:
  MP redirige a `/suscripcion?resultado=checkout` sin distinguir el desenlace y la
  página muestra el aviso según el **estado real** (con `active` dice "recibió tu pago";
  sin él, "todavía no confirmamos" + botón *Actualizar estado*), limpia la URL y
  recarga a los 5 s.
- **Cron horario** → `0014_subscription_cron.sql` agenda `refresh_subscription_states()`
  cada hora (vencimientos y cancelaciones que ninguna webhook cerró).
- **Fix** → `0015_subscription_refresh_fix.sql` corrige `refresh_subscription_states()`:
  el `CASE` del segundo UPDATE no casteaba al enum `subscription_status` y la función
  **siempre fallaba** (nadie lo había visto porque no había ningún cron que la llamara).

Orden (credenciales primero: sin los secretos `mercadopago-create` responde 500):

1. [x] **Credenciales de Mercado Pago** → <https://www.mercadopago.com.ar/developers> →
   *Tu integración > Credenciales* → Access Token (`APP_USR-...`); y
   *Tu integración > Webhooks > Configurar notificación* → clave secreta (firma
   `x-signature`, obligatoria: sin ella la webhook responde 401). Cargadas el 7/10/2026
   (token verificado con `GET /v1/payments/search` → 200, moneda ARS).
2. [x] **Secretos** → desde la raíz del repo:
   ```bash
   supabase secrets set MP_ACCESS_TOKEN="APP_USR-..." MP_WEBHOOK_SECRET="..." APP_URL="https://alarma-bull.vercel.app"
   ```
   Verificado el 7/10/2026: `mercadopago-create` sin JWT responde **401** (no 500), o sea
   que los tres secretos están completos.
3. [x] **Migraciones** → SQL Editor, en este orden (la 0014 agenda la función que arregla
   la 0015): aplicadas por el usuario el 7/10/2026 (verificado: `prosrc` con el cast al
   enum y job `subscriptions-refresh` presente en `cron.job`).
   - `supabase/migrations/0015_subscription_refresh_fix.sql`
   - `supabase/migrations/0014_subscription_cron.sql` → debe salir
     `OK: el cron de suscripciones está activo.`
4. [x] **Edge Function** → redesplegada `mercadopago-create` (agregó `action=cancel`) el
   7/10/2026:
   ```bash
   supabase functions deploy mercadopago-create
   ```
5. [x] **Frontend** → commit + push el 7/10/2026 (bundle `index-jiYy-eKO.js` verificado en
   producción con los strings nuevos).
6. [x] **Fix del 502 en el alta** (7/10/2026) → el primer checkout real falló con
   MP **400 `Parameters passed are invalid`**: `/preapproval` espera `back_url` como
   **string** y la EF mandaba el objeto `{success, failure, pending}` (eso es de
   *checkout preferences*). Verificado contra la API con el payload real → **201 +
   `init_point`**; corregido en la EF (`?resultado=checkout`) y la página quedó con
   aviso según estado real. Dato: el `PUT` de cancelación acepta `cancelled` (doble l);
   la EF ya lo cubre con el retry `canceled` → `cancelled`.
7. [ ] **Prueba end-to-end** (con el precio cargado, paso 7) → *Suscribirme* → `init_point`
   → pagar (tarjeta de prueba de MP si es sandbox) → al volver debe verse el aviso
   *"Mercado Pago recibió tu pago"* y el estado `active` con `Próximo cobro`; verificar
   en BD:
   ```sql
   select status, current_period_start, current_period_end, cancel_at_period_end
     from public.user_subscriptions;
   select event_type, status, amount_ars, processed_at
     from public.payment_events order by created_at desc limit 10;
   ```
   Después *Cancelar suscripción* → debe quedar `cancel_at_period_end = true` con período
   vigente, y al vencer el período el cron lo pasa a `canceled`. El detalle del webhook en
   sandbox está en `docs/FASE9_mercadopago.md` (sección 6).
   > **Progreso 7/10/2026**: el alta ya funciona (la fila quedó
   > `trial/mercadopago` con `provider_subscription_id`), pero `payment_events` sigue en
   > **0**: falta que el cobro se confirme vía webhook y que el estado pase a `active`.

---

## 14. Ciberseguridad — Fase 1 (auditoría 7/10/2026)

Auditoría integral (BD + Edge Functions + frontend + git/dependencias). Resultado: sin
secretos en el repo ni en el historial, `npm audit` 0 vulnerabilidades, RLS total
(21/21 tablas), webhook de MP fail-closed. Fase 1: cierra los grants expuestos, endurece
el alta de MP y agrega cabeceras de seguridad.

1. [ ] **Migración `0016_security_grants.sql`** → SQL Editor → pegar; debe terminar con
   `OK: grants de seguridad verificados` y `OK: 0016_security_grants aplicada`. Cierra:
   - `cron.schedule` / `net.http_*` para `anon`/`authenticated` (el hallazgo más grave:
     con execute ahí se podía agendar SQL arbitrario que corre como `postgres`).
   - `refresh_subscription_states` (grant masivo de 0003), `is_entitled(uuid)` (IDOR),
     `trigger_alert` y `update_own_profile` (los habían reabierto los DROP+CREATE de
     0010/0011 a `anon`), `handle_new_user`/`profiles_guard` (PUBLIC revocado).
   - `register_push_subscription`: tope de 8 dispositivos + bloqueo de secuestro de
     endpoints (DoS del canal de alarma).
   - `join_community`: los miembros `removed` no reingresan con el link.
2. [ ] **Frontend** → commit + push (`vercel.json`: CSP con `frame-ancestors 'none'`,
   HSTS y Permissions-Policy; la sesión vive en `localStorage` y la CSP es su barrera).
3. [ ] **Edge Function** → redesplegar `mercadopago-create` (cuenta suspendida
   *fail-closed* + **409** si ya hay suscripción activa vinculada a MP).
4. [ ] **Verificación** → `curl -I https://alarma-bull.vercel.app/` debe mostrar
   `content-security-policy` y `strict-transport-security`; en BD:
   ```sql
   select has_function_privilege('anon', 'cron.schedule(text,text,text)', 'execute'),
          has_function_privilege('anon', 'public.is_entitled(uuid)', 'execute');
   -- ambos deben dar false
   ```

Pendientes de la Fase 2 (ver auditoría): rate limiting en las 4 EFs, ventana de
frescura del `ts` en la webhook, `source_url` con esquema validado, `supabase/config.toml`
con `verify_jwt`, PII entre vecinos (teléfono/dirección/motivo de suspensión), sesión en
cookies `httpOnly` y rotación de `sbp_`/`service_role`/anon/VAPID.

---

## Resumen de pendientes manuales

| # | Paso | Estado |
| --- | --- | --- |
| 0 | Subir fases 2–10 a GitHub | listo (mínimo `3afea58`, rama `main`) |
| 1 | Proyecto Supabase + migraciones 0001–0009 | listo (0008 y 0009 pegadas el 4/10) |
| 2 | `.env` local | listo |
| 3 | Auth: email y confirmación + URL Configuration | por confirmar |
| 4 | Promover al primer `admin_general` | por confirmar |
| 5 | Desplegar 4 Edge Functions + secretos | listo (VAPID cargados; falta `MP_ACCESS_TOKEN`) |
| 6 | Claves VAPID (Supabase + Vercel) | listo |
| 7 | Cargar el precio del plan | listo (Plan mensual, 3000 ARS) |
| 8 | Importar repo en Vercel + variables + deploy | listo |
| 9 | Verificación final (app + `scripts\test-db.ps1`) | por confirmar |
| 10 | Pegar `0008_estoy_bien.sql` en Supabase | listo |
| 11 | Habilitar `pg_cron` + `pg_net` y guardar `estoy_bien_service_key` | listo (verificado 4/10) |
| 12 | Desplegar `estoy-bien-deliver` | listo (4 funciones desplegadas) |
| 13 | Pegar `0009_cron.sql` y verificar `cron.job` | listo (aviso `OK: ... está activo.`) |
| 14 | Pegar `0010_precaucion.sql` (FASE 13) | listo (5/10/2026) |
| 15 | Redesplegar `trigger-alert` + push del frontend (FASE 13) | listo (5/10/2026); falta la prueba manual en la app |
| 16 | Pegar `0011_profile_address.sql` (dirección en el perfil) | listo (5/10/2026) |
| 17 | Push del frontend con la dirección en el perfil | listo (5/10/2026); falta probarlo en la app |
| 18 | Pegar `0012_invite_link.sql` (link de invitación siempre copiable + vencimiento/usos en null) | listo (5/10/2026) |
| 19 | Pegar `0013_contact_alerts.sql` (FASE 15: avisos a contactos por la app) | listo (7/10/2026; verificado: columna `account_id` presente) |
| 20 | Redesplegar `estoy-bien-deliver` (FASE 15) | listo (7/10/2026) |
| 21 | Push del frontend con la FASE 15 | listo (7/10/2026); falta la prueba manual del link con otra cuenta |
| 22 | Credenciales MP: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `APP_URL` | listo (7/10/2026; token verificado contra la API de MP) |
| 23 | Pegar `0015_subscription_refresh_fix.sql` y después `0014_subscription_cron.sql` (FASE 16) | listo (7/10/2026; job `subscriptions-refresh` verificado en `cron.job`) |
| 24 | Redesplegar `mercadopago-create` (FASE 16: cancelar desde la app) | listo (7/10/2026) |
| 25 | Push del frontend con la FASE 16 (`?resultado=`, cancelar, débito automático) | listo (7/10/2026; bundle `index-jiYy-eKO.js` verificado) |
| 26 | Prueba end-to-end de cobro: checkout + webhook + cancelación (sección 13.6) | progreso (7/10/2026: el alta crea el vínculo `trial/mercadopago`, falta confirmar el cobro: `payment_events` en 0) |
| 27 | Pegar `0016_security_grants.sql` (ciberseguridad fase 1) | pendiente (sección 14) |
| 28 | Push del frontend con CSP + HSTS (sección 14) | pendiente |
| 29 | Redesplegar `mercadopago-create` (409 + cuenta suspendida fail-closed) | pendiente |
