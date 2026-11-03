/**
 * Google sign-in for a static site.
 *
 * Uses Google Identity Services' token flow, which is the right one for a
 * browser app with no backend: we get a short-lived access token directly and
 * never hold a refresh token or a client secret.
 *
 * The `drive.file` scope is deliberately narrow — it grants access only to the
 * spreadsheet this app creates, not to the rest of the user's Drive.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  // Lets the access gate read the signed-in email. Non-sensitive scope.
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

export const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void
  callback: (response: TokenResponse) => void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id?: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential?: string }) => void
            auto_select?: boolean
          }) => void
          prompt: (listener?: (n: { isNotDisplayed?: () => boolean; isSkippedMoment?: () => boolean }) => void) => void
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
        }
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (response: TokenResponse) => void
            error_callback?: (error: { type: string }) => void
          }) => TokenClient
          revoke: (token: string, done: () => void) => void
        }
      }
    }
  }
}

let scriptPromise: Promise<void> | null = null

export function loadGis(): Promise<void> {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load Google sign-in. Check your network or ad blocker.'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

interface StoredToken {
  token: string
  expiresAt: number
}

// Bump the suffix when SCOPES change so a stored token from before is ignored.
const TOKEN_KEY = 'statement-sense.token.v2'

function readStoredToken(): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredToken
    // Treat a token as expired a minute early to avoid racing the clock.
    return parsed.expiresAt - 60_000 > Date.now() ? parsed : null
  } catch {
    return null
  }
}

function writeStoredToken(token: StoredToken | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token))
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Private browsing can block sessionStorage; the in-memory token still works.
  }
}

let current: StoredToken | null = readStoredToken()
let tokenClient: TokenClient | null = null

export function isConfigured(): boolean {
  return CLIENT_ID.length > 0
}

export function isSignedIn(): boolean {
  return current !== null && current.expiresAt - 60_000 > Date.now()
}

async function getTokenClient(): Promise<TokenClient> {
  if (tokenClient) return tokenClient
  await loadGis()
  if (!window.google?.accounts?.oauth2) throw new Error('Google sign-in did not initialise.')
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: () => {},
  })
  return tokenClient
}

/**
 * Request an access token. `prompt: ''` lets Google reuse an existing grant
 * silently, so a returning user is not asked to approve on every reload.
 */
export async function signIn(interactive = true): Promise<string> {
  if (!isConfigured()) {
    throw new Error('No Google client ID is set. Add VITE_GOOGLE_CLIENT_ID to your .env file.')
  }
  if (current && isSignedIn()) return current.token

  const client = await getTokenClient()
  return new Promise((resolve, reject) => {
    client.callback = (response) => {
      if (response.error || !response.access_token) {
        reject(new Error(response.error_description ?? response.error ?? 'Sign-in was cancelled.'))
        return
      }
      current = {
        token: response.access_token,
        expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
      }
      writeStoredToken(current)
      resolve(current.token)
    }
    client.requestAccessToken({ prompt: interactive ? 'consent' : '' })
  })
}

export function signOut() {
  const token = current?.token
  current = null
  writeStoredToken(null)
  if (token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token, () => {})
  }
}

/** Fetch against a Google API, refreshing the token once on a 401. */
export async function googleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await signIn(false).catch(() => signIn(true))
  const send = (bearer: string) =>
    fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
    })

  let response = await send(token)
  if (response.status === 401) {
    current = null
    writeStoredToken(null)
    response = await send(await signIn(true))
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Google API error ${response.status}: ${body.slice(0, 300)}`)
  }
  return response
}
