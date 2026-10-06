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
sólo el push y la notificación in-app se envían hoy.

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
| 7 | Cargar el precio del plan | por confirmar |
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
| 18 | Pegar `0012_invite_link.sql` (link de invitación siempre copiable + vencimiento/usos en null) | **pendiente — antes de publicar el frontend nuevo** (si no, `listInvites` falla al pedir la columna `token`) |
