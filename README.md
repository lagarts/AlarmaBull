# Alarma Vecinal (AlarmaBull)

SaaS de comunidades vecinales para Argentina: alertas de seguridad compartidas,
contactos de emergencia y suscripción individual con 7 días de prueba.

## Stack

- React 19 + TypeScript + Vite
- Tailwind CSS 4
- Supabase (Auth, PostgreSQL, RLS, Realtime, Edge Functions)
- PWA instalable con Web Push (service worker)
- Mercado Pago (suscripciones individuales en ARS, entorno de pruebas)
- Despliegue en Vercel

## Comandos

```bash
npm install
npm run dev        # desarrollo
npm run build      # typecheck + build de producción
npm run typecheck  # verificación de tipos
npm run lint       # ESLint
npm run test       # pruebas (Vitest)
```

## Configuración

1. Copiá `.env.example` a `.env` y completá `VITE_SUPABASE_URL` y
   `VITE_SUPABASE_ANON_KEY`.
2. Los secretos (service role, Mercado Pago) viven en Supabase Edge Functions,
   nunca en el frontend ni en `.env` del repositorio.

## Documentación

- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) — arquitectura, modelo de datos y seguridad.
- [docs/FASE1.md](docs/FASE1.md) — estado de la FASE 1 y tareas manuales pendientes.
