import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'T-Walk',
        short_name: 'T-Walk',
        description: 'Live MBTA departures near you, sorted by walking time.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f1214',
        theme_color: '#0f1214',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // The app shell works offline. Live data is never cached by the service
        // worker: a stale arrival time served as if fresh is exactly what this app
        // must not do. (Offline schedules come in Phase 4.)
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,mjs}'],
        // The map is ~300 KB: fetched the first time someone opens it, not at install.
        globIgnores: ['**/MapScreen-*', '**/maplibre-gl-worker*'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === self.location.origin && /\/assets\/(MapScreen-|maplibre-gl-worker)/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'map-code', expiration: { maxEntries: 10 } },
          },
          {
            // Basemap tiles, styles and fonts: they change rarely, and caching them saves data.
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'basemap', expiration: { maxEntries: 1500, maxAgeSeconds: 14 * 86400 } },
          },
        ],
        navigateFallback: '/index.html',
        // Push messages for leave-now notifications (public/push-sw.js).
        importScripts: ['/push-sw.js'],
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  build: { target: 'es2022', sourcemap: true },
});
