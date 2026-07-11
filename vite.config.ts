import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Open-SCRL',
        short_name: 'Open-SCRL',
        description: 'Open-source photo grid + Instagram carousel maker',
        theme_color: '#0b0b0f',
        background_color: '#0b0b0f',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        globIgnores: ['**/heic2any-*.js', '**/export.worker-*.js', '**/zip-*.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/(?:assets\/)?(?:heic2any|export\.worker|zip)[^/]*\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'optional-editor-tools', expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      output: {
        manualChunks(moduleId) {
          if (moduleId.includes('@zip.js/zip.js')) return 'zip';
        },
      },
    },
  },
});
