import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg', 'logo.png', 'icons/icon-192.png', 'icons/icon-maskable-512.png'],
      manifest: {
        name: 'Alarma Vecinal',
        short_name: 'AlarmaVecinal',
        description:
          'Comunidades de vecinos con alertas de seguridad, contactos de emergencia y suscripción individual.',
        lang: 'es-AR',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        id: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#0b2545',
        categories: ['security', 'social', 'utilities'],
        icons: [
          { src: '/logo.png', sizes: '500x500', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        rollupFormat: 'iife',
      },
      devOptions: {
        enabled: false,
        suppressWarnings: true,
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
  },
})
