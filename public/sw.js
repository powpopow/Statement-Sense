/*
 * Statement Sense service worker.
 *
 * Two jobs: make the app installable on a phone, and keep the OCR runtime
 * (~23 MB of WASM and Thai/English models) on the device after first use, so a
 * screenshot can be read again later without downloading it or being online.
 *
 * It only ever touches same-origin GET requests inside the app's own folder.
 * Google sign-in and the Sheets API are cross-origin and pass straight through.
 */
const APP_CACHE = 'ss-app-v1'   // app shell and hashed build files
const OCR_CACHE = 'ss-ocr-v1'   // bump this when tesseract.js is upgraded
const SCOPE = self.registration.scope // e.g. https://host/Statement-Sense/

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== APP_CACHE && key !== OCR_CACHE) await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return

  const path = url.href.slice(SCOPE.length)
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
  } else if (path.startsWith('tesseract/')) {
    event.respondWith(cacheFirst(request, OCR_CACHE))
  } else if (
    path.startsWith('assets/') ||
    path.startsWith('icons/') ||
    path === 'favicon.svg' ||
    path === 'manifest.webmanifest'
  ) {
    event.respondWith(cacheFirst(request, APP_CACHE))
  }
})

// Build files have content hashes in their names, and OCR files are pinned by
// the lockfile, so a cached copy never goes stale.
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.status === 200) cache.put(request, response.clone()).catch(() => {})
  return response
}

// The page itself is fetched fresh when online, so a new deploy is picked up on
// the next open; the saved copy is only the offline fallback.
async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE)
  try {
    const response = await fetch(request)
    if (response.status === 200) cache.put(SCOPE, response.clone()).catch(() => {})
    return response
  } catch {
    return (await cache.match(SCOPE)) || (await cache.match(request)) || Response.error()
  }
}
