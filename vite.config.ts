import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react({ compiler: false }),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Open-SCRL',
        short_name: 'Open-SCRL',
        description: 'Open-source photo grid + Instagram carousel maker',
        theme_color: '#0f0f12',
        background_color: '#0f0f12',
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
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/(?:assets\/)?(?:heic2any|export\.worker|zip)[^/]*\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'optional-editor-tools', expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  worker: { format: 'es' },
  experimental: { bundledDev: false },
  // Prebundle the optional HEIC adapter before the first import so a cold dev
  // server does not discover another dependency and reload an open editor.
  optimizeDeps: { include: ['heic2any'] },
  build: {
    // Preserve Vite 6's browser syntax support when changing build tools.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'zip', test: /[\\/]node_modules[\\/]@zip\.js[\\/]zip\.js[\\/]/ }],
        },
      },
    },
  },
});
