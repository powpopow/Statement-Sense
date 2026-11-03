/**
 * The signed-in person's Google ID token.
 *
 * The backend checks this token on every request (it proves who is asking and
 * that it was issued for this app). It lasts about an hour, so it is renewed
 * silently when it runs low; if Google needs the person to sign in again, the
 * sign-in button is shown.
 */
import { CLIENT_ID, loadGis } from './google'

const KEY = 'statement-sense.idtoken'

function expiry(token: string): number {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return (JSON.parse(atob(payload)) as { exp?: number }).exp ?? 0
  } catch {
    return 0
  }
}

/** The stored token if it has more than 30 seconds left, otherwise ''. */
export function getIdToken(): string {
  try {
    const token = localStorage.getItem(KEY) ?? ''
    return token && expiry(token) > Date.now() / 1000 + 30 ? token : ''
  } catch {
    return ''
  }
}

function store(token: string) {
  try {
    localStorage.setItem(KEY, token)
  } catch {
    // Private browsing: the token just will not survive a reload.
  }
}

export function clearIdToken() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
  window.google?.accounts.id?.initialize({ client_id: CLIENT_ID, callback: () => {}, auto_select: false })
}

/** Ask Google for a fresh token without showing anything. Resolves '' if the person must sign in. */
export async function refreshIdToken(): Promise<string> {
  await loadGis()
  const id = window.google?.accounts.id
  if (!id) return ''
  return new Promise((resolve) => {
    let done = false
    const finish = (token: string) => {
      if (!done) {
        done = true
        resolve(token)
      }
    }
    id.initialize({
      client_id: CLIENT_ID,
      auto_select: true,
      callback: (response) => {
        if (response.credential) store(response.credential)
        finish(response.credential ?? '')
      },
    })
    id.prompt((n) => {
      if (n.isNotDisplayed?.() || n.isSkippedMoment?.()) finish('')
    })
    setTimeout(() => finish(''), 6000)
  })
}

/** Draw Google's sign-in button into `parent`; `onToken` runs once the person signs in. */
export async function renderSignInButton(parent: HTMLElement, onToken: (token: string) => void) {
  await loadGis()
  const id = window.google?.accounts.id
  if (!id) return
  id.initialize({
    client_id: CLIENT_ID,
    callback: (response) => {
      if (response.credential) {
        store(response.credential)
        onToken(response.credential)
      }
    },
  })
  id.renderButton(parent, { theme: 'outline', size: 'large', text: 'signin_with' })
}
