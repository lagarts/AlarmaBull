# FASE 1 — Inspección del repositorio y arquitectura

**Estado: completada** (pendientes manuales listados al final).

## 1. Inspección inicial

| Ítem | Resultado |
| --- | --- |
| Repositorio | `git` inicializado en `master`, **sin commits** y sin contenido |
| Archivos previos | Ninguno (solo `.git`) |
| Remoto | No configurado → `origin = https://github.com/lagarts/AlarmaBull.git` |
| Rama principal | Renombrada a `main` |
| Entorno local | Node 24.13, npm 11.6, git 2.52 (Windows) |

Conclusión: no había arquitectura previa que respetar; se definió la estructura base
(documentada en `docs/ARQUITECTURA.md`).

## 2. Trabajo realizado

- Stack fijado y versiones verificadas contra el registro de npm antes de instalar:
  Vite 8 + React 19 + TypeScript 6 + Tailwind 4 + React Router 7 + Supabase JS 2 +
  vite-plugin-pwa 1 + ESLint 10 + Vitest 5.
  (`typescript-eslint` limita TypeScript a `<6.1`, por eso no se usó TS 7.)
- Scaffold del proyecto: `package.json`, `tsconfig.*`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `index.html`, `.gitignore`,
  `.env.example` (sin secretos).
- PWA: manifest en español (es-AR), iconos PNG generados (192/512/maskable/apple) y
  service worker con precaching verificado en el build.
- Sistema de diseño inicial (tokens Tailwind v4): fondo blanco/gris claro, azul
  oscuro de navegación, rojo de alarma, naranja bomberos, verde ambulancia, tarjetas
  redondeadas con sombras suaves.
- Navegación: `AppShell` con menú lateral en escritorio y navegación compacta
  inferior + menú superior en móvil; rutas de las 15 pantallas del proyecto.
- Acceso: `AuthProvider` (sesión Supabase), guardas `RequireAuth`/`PublicOnly`,
  aviso claro si falta configurar Supabase.
- Utilidades reutilizables: formato de fechas en UTC→zona horaria del usuario,
  importes en ARS, días restantes; cliente Supabase perezoso y validado.

## 3. Verificaciones ejecutadas

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | OK: sin errores |
| `npm run lint` | OK: sin errores ni warnings |
| `npm run test` | OK: 2 archivos, 7 pruebas en verde |
| `npm run build` | OK: build + `dist/sw.js` (15 entradas de precache) |

Pruebas incluidas: formato de fechas/hora con zona horaria, días restantes de la
prueba, importes ARS, y la pantalla de bienvenida (incluye la regla de no afirmar
llamadas automáticas a emergencias).

## 4. Tareas manuales pendientes

1. Crear el proyecto en Supabase y copiar URL + clave anónima a `.env`
   (usar `.env.example` como plantilla).
2. Generar el ícono maskable definitivo con la marca real (los actuales son
   provisionales: fondo azul oscuro + "AV").
3. Publicar el repositorio en GitHub (`main`) y conectar Vercel al repo.
4. Definir con el cliente el precio mensual en ARS y el texto de condiciones
   (no se usan precios inventados: va en `subscription_plans`).
5. Verificar números de emergencia por localidad con fuentes oficiales antes de
   publicarlos (FASE 8).

## 5. Siguiente fase

**FASE 2** — Diseño y navegación: pantallas reales de bienvenida, acceso, inicio con
botón de alarma, estados de carga/vacío/error y navegación completa.

## 6. Actualización posterior (2026-10-03)

Documento conservado como registro de la FASE 1. Aclaraciones sobre su contenido:

- Las tareas manuales de la sección 4 hoy están agrupadas en `docs/DESPLEGUE.md`
  (Supabase, GitHub/Vercel, precio del plan). La verificación de números de emergencia
  se hizo en la FASE 8 (`supabase/migrations/0005_seed_emergency_contacts.sql`).
- La tabla de la sección 3 refleja ese momento: hoy `npm run test` corre **1 archivo con
  4 pruebas** (`src/lib/datetime.test.ts`); la prueba de la pantalla de bienvenida se
  eliminó en la FASE 2 al quitar la landing (`WelcomePage.tsx`).
- El repositorio dejó de estar "sin commits": hay un commit de la FASE 1 en
  `origin`; el detalle de lo pendiente de subir está en `docs/ESTADO.md`.
- Estado actual por fase y verificaciones: `docs/ESTADO.md`.
