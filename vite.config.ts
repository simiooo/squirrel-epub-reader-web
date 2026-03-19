import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'logo.png'],
      manifest: {
        name: '松鼠EPUB阅读器',
        short_name: '松鼠阅读',
        description: '一个优雅的EPUB电子书阅读器',
        theme_color: '#1890ff',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        orientation: 'portrait-primary',
        icons: [
          {
            src: '/icon-72x72.png',
            sizes: '72x72',
            type: 'image/png',
            purpose: 'maskable any',
          },
          {
            src: '/icon-96x96.png',
            sizes: '96x96',
            type: 'image/png',
            purpose: 'maskable any',
          },
          {
            src: '/icon-128x128.png',
            sizes: '128x128',
            type: 'image/png',
            purpose: 'maskable any',
          },
          {
            src: '/icon-144x144.png',
            sizes: '144x144',
            type: 'image/png',
            purpose: 'maskable any',
          },
          {
            src: '/icon-152x152.png',
            sizes: '152x152',
            type: 'image/png',
            purpose: 'maskable any',
          },
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable any',
          },
          {
            src: '/icon-384x384.png',
            sizes: '384x384',
            type: 'image/png',
            purpose: 'maskable any',
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB limit for highlight.js bundle
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 365 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 365 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],

});