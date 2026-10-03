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

---

## Resumen de pendientes manuales

| # | Paso | Estado |
| --- | --- | --- |
| 0 | Subir fases 2–10 a GitHub | pendiente (remoto sólo tiene la FASE 1) |
| 1 | Proyecto Supabase + migraciones 0001–0005 | pendiente |
| 2 | `.env` local | pendiente |
| 3 | Auth: email y confirmación + URL Configuration | pendiente |
| 4 | Promover al primer `admin_general` | pendiente |
| 5 | Desplegar 3 Edge Functions + 5 secretos | pendiente |
| 6 | Claves VAPID (Supabase + Vercel) | pendiente |
| 7 | Cargar el precio del plan | pendiente |
| 8 | Importar repo en Vercel + variables + deploy | pendiente |
| 9 | Verificación final (app + `scripts\test-db.ps1`) | pendiente |
