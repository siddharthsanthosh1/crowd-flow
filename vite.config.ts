import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  resolve: {
    alias: {
      // See the comment in the stub: Firestore's Pipeline regex support, unused here.
      re2js: fileURLToPath(new URL('./src/lib/re2js-stub.ts', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'CrowdFlow',
        short_name: 'CrowdFlow',
        description: 'Crowd counting for outdoor events',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // The volunteer screen is opened by scanning a QR code at a deep URL.
        // Serve the cached app shell for any navigation so it works with no signal.
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Precache only the scripts and styles index.html loads up front, which is
        // everything the volunteer screen needs. The organizer pages and their
        // charts are lazy chunks; precaching them made every volunteer phone
        // download them in the background on festival signal. Reading the list
        // from index.html rather than naming chunks means a new volunteer
        // dependency is precached automatically.
        manifestTransforms: [
          (entries) => {
            const html = readFileSync(
              fileURLToPath(new URL('./dist/index.html', import.meta.url)),
              'utf8',
            )
            const eager = new Set([...html.matchAll(/(?:src|href)="\/([^"]+)"/g)].map((m) => m[1]))
            const manifest = entries.filter((e) => !/\.(js|css)$/.test(e.url) || eager.has(e.url))
            return { manifest, warnings: [] }
          },
        ],
        // Lazy chunks are cached the first time they load. File names are
        // content-hashed, so a cached chunk never goes stale.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'crowdflow-chunks', expiration: { maxEntries: 60 } },
          },
        ],
      },
    }),
  ],
})
