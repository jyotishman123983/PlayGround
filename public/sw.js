/* ViralYantra AI service worker — offline-capable PWA shell.
 *
 * Strategy:
 *  - Navigations: network first, fall back to the cached app shell.
 *  - Static assets (same origin, GET): stale-while-revalidate.
 *  - Demo videos/fonts/images are cached so demo mode works offline.
 *  - API calls (other origins, /api/*) are never cached.
 *
 * Requires a secure context (https:// or http://localhost). On a plain LAN IP
 * the browser will skip registration — the app still works, just without
 * offline caching.
 */
const CACHE = 'viralyantra-v1'
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/logo.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => undefined)
          return response
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/')))
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined)
          }
          return response
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
