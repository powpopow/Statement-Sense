import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
const read = (file) => readFileSync(path.join(publicDir, file), 'utf8')

/** Width and height from a PNG's IHDR header. */
function pngSize(file) {
  const bytes = readFileSync(path.join(publicDir, file))
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('web app manifest', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'))

  it('has what an install prompt needs', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.display).toBe('standalone')
    // Relative, so it works under GitHub Pages' /<repo>/ as well as at the root.
    expect(manifest.start_url).toBe('./')
    expect(manifest.scope).toBe('./')
  })

  it('points at icons that exist and are the size they claim', () => {
    for (const icon of manifest.icons) {
      expect(existsSync(path.join(publicDir, icon.src)), icon.src).toBe(true)
      const [w, h] = icon.sizes.split('x').map(Number)
      expect(pngSize(icon.src)).toEqual({ width: w, height: h })
    }
    const sizes = manifest.icons.map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
  })

  it('has an iOS home-screen icon', () => {
    expect(pngSize('icons/apple-touch-icon.png')).toEqual({ width: 180, height: 180 })
  })
})

/** Run sw.js in a sandbox and see which requests it chooses to handle. */
function loadServiceWorker() {
  const listeners = {}
  const self = {
    registration: { scope: 'https://example.github.io/Statement-Sense/' },
    location: { origin: 'https://example.github.io' },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
    addEventListener: (type, fn) => {
      listeners[type] = fn
    },
  }
  const cacheStore = new Map()
  const caches = {
    keys: async () => [...cacheStore.keys()],
    delete: async (name) => cacheStore.delete(name),
    open: async (name) => {
      if (!cacheStore.has(name)) cacheStore.set(name, new Map())
      const store = cacheStore.get(name)
      const keyOf = (r) => (typeof r === 'string' ? r : r.url)
      return {
        match: async (r) => store.get(keyOf(r)),
        put: async (r, res) => void store.set(keyOf(r), res),
      }
    },
  }
  const fetch = async () => ({ status: 200, clone() { return this } })
  vm.runInNewContext(read('sw.js'), { self, caches, URL, Response, fetch })
  return { listeners, cacheStore }
}

function handled(listeners, url, init = {}) {
  let responded = false
  listeners.fetch({
    request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' },
    respondWith: () => {
      responded = true
    },
  })
  return responded
}

describe('service worker routing', () => {
  const base = 'https://example.github.io/Statement-Sense/'

  it('handles the app page, build files and OCR files', () => {
    const { listeners } = loadServiceWorker()
    expect(handled(listeners, base, { mode: 'navigate' })).toBe(true)
    expect(handled(listeners, `${base}assets/index-abc123.js`)).toBe(true)
    expect(handled(listeners, `${base}tesseract/lang/tha.traineddata.gz`)).toBe(true)
    expect(handled(listeners, `${base}manifest.webmanifest`)).toBe(true)
  })

  it('never touches Google sign-in, the Sheets API, or any other origin', () => {
    const { listeners } = loadServiceWorker()
    expect(handled(listeners, 'https://accounts.google.com/gsi/client')).toBe(false)
    expect(handled(listeners, 'https://sheets.googleapis.com/v4/spreadsheets/abc')).toBe(false)
    expect(handled(listeners, 'https://cdn.example.com/x.js')).toBe(false)
  })

  it('ignores non-GET requests and pages outside the app folder', () => {
    const { listeners } = loadServiceWorker()
    expect(handled(listeners, `${base}assets/x.js`, { method: 'POST' })).toBe(false)
    expect(handled(listeners, 'https://example.github.io/other-project/', { mode: 'navigate' })).toBe(false)
  })

  it('removes old caches when a new version takes over', async () => {
    const { listeners, cacheStore } = loadServiceWorker()
    cacheStore.set('ss-app-v0', new Map())
    cacheStore.set('ss-ocr-v1', new Map())
    let done = Promise.resolve()
    listeners.activate({ waitUntil: (p) => (done = p) })
    await done
    expect([...cacheStore.keys()]).toEqual(['ss-ocr-v1'])
  })
})
