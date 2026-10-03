# Alarma Vecinal (AlarmaBull)

SaaS argentino de alarma vecinal: los vecinos de una comunidad comparten alertas de
seguridad en tiempo real, ven contactos de emergencia oficiales y reciben notificaciones
push en cada dispositivo. Cada vecino se suscribe de forma individual (prueba de 7 días,
precios en pesos configurados por el administrador, cobro con Mercado Pago). Es una PWA
instalable y no tiene landing: la raíz `/` lleva directo a la aplicación.

## Stack

- React 19 + TypeScript + Vite 8
- Tailwind CSS 4
- React Router 7
- Supabase (Auth, PostgreSQL + RLS, Realtime, Edge Functions)
- PWA instalable con Web Push (service worker propio, `injectManifest`)
- Mercado Pago (suscripciones individuales en ARS)
- Vitest + Testing Library, ESLint 10
- Despliegue en Vercel (`vercel.json` incluido)

## Requisitos

- **Node 24+** y **npm 11+** (el proyecto se verificó con Node 24.13 y npm 11.6;
  Vite 8 acepta `^20.19.0 || >=22.12.0`, pero se recomienda Node 24).
- Cuenta en [Supabase](https://supabase.com/dashboard) y en [Vercel](https://vercel.com/new)
  para desplegar.
- **Opcional:** PostgreSQL local con `psql` e `initdb` en el PATH, para correr las pruebas
  de base de datos (`scripts\test-db.ps1` crea un clúster efímero en el puerto 55432).

## Comandos

```bash
npm install                                 # dependencias
npm run dev                                 # desarrollo (Vite)
npm run build                               # typecheck + build de producción (PWA)
npm run preview                             # sirve dist/ (http://localhost:4173)
npm run typecheck                           # verificación de tipos (tsc -b)
npm run lint                                # ESLint sobre todo el repo
npm run test                                # pruebas unitarias (Vitest, jsdom)
npm run test:watch                          # pruebas en modo watch

# Pruebas de seguridad/RLS sobre PostgreSQL local (requiere psql/initdb en el PATH)
powershell -ExecutionPolicy Bypass -File scripts\test-db.ps1
```

Estado de la rama actual: los cinco comandos de verificación
(`typecheck`, `lint`, `test`, `build` y `scripts\test-db.ps1`) terminan en verde:
4 pruebas unitarias, y el script de BD aplica las migraciones reales sobre un
PostgreSQL efímero antes de correr las pruebas de `tests/db/`.

## Configuración

1. Copiá `.env.example` a `.env` y completá `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY` y `VITE_APP_URL`.
2. Para Web Push agregá `VITE_VAPID_PUBLIC_KEY` (sólo la clave pública VAPID).
3. Los secretos (service role, `MP_ACCESS_TOKEN`, clave privada VAPID) viven en los
   secretos de las Edge Functions de Supabase: nunca en el frontend ni en `.env`.

Para poner el producto en producción seguí la checklist de
[`docs/DESPLEGUE.md`](docs/DESPLEGUE.md).

## Estructura

```
/
├── docs/                  # Arquitectura, estado por fase, push, Mercado Pago, despliegue
├── public/                # favicon e iconos PWA (192/512/maskable/apple)
├── scripts/test-db.ps1    # PostgreSQL efímero + migraciones + pruebas SQL
├── src/
│   ├── components/        # ui/, layout/, alarm/, community/, subscription/, admin/, icons
│   ├── config/            # env.ts (variables VITE_* validadas)
│   ├── context/           # AuthProvider (sesión Supabase)
│   ├── data/              # acceso a datos por dominio (RPC y queries)
│   ├── hooks/             # useAsync / useCommunity
│   ├── lib/               # supabase, datetime, pwa, push
│   ├── pages/             # pantallas (Auth, Home, Alertas, Comunidad, Suscripción, Admin…)
│   ├── routes/            # guardas (RequireAuth/PublicOnly) y navegación
│   ├── styles/            # tokens de diseño Tailwind v4
│   ├── sw.ts              # service worker propio (injectManifest → dist/sw.js)
│   └── App.tsx / main.tsx # tabla de rutas y arranque
├── supabase/
│   ├── migrations/        # 0001…0005: esquema, funciones, RLS, seeds
│   └── functions/         # mercadopago-create, mercadopago-webhook, trigger-alert
├── tests/db/              # pruebas SQL de seguridad/RLS
├── .env.example           # plantilla sin secretos
├── vercel.json            # SPA + headers de la PWA
└── vite.config.ts         # React + Tailwind + PWA (injectManifest)
```

## Documentación

| Documento | Contenido |
| --- | --- |
| [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) | Arquitectura, modelo de datos, seguridad y actualización de las fases 2–10 |
| [`docs/ESTADO.md`](docs/ESTADO.md) | Estado por fase: qué está hecho y qué falta |
| [`docs/DESPLEGUE.md`](docs/DESPLEGUE.md) | Checklist de puesta en producción (Supabase, secretos, Vercel) |
| [`docs/FASE1.md`](docs/FASE1.md) | FASE 1: inspección del repositorio y arquitectura base |
| [`docs/FASE7_push.md`](docs/FASE7_push.md) | FASE 7: Web Push, service worker y Edge Function `trigger-alert` |
| [`docs/FASE9_mercadopago.md`](docs/FASE9_mercadopago.md) | FASE 9: suscripciones con Mercado Pago (creación, webhook, pruebas) |
