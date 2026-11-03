import { useEffect, useRef, useState, type ReactNode } from 'react'
import { checkAccess, isGateEnabled } from '../lib/access'
import { AuthError, isBackend, whoami } from '../lib/backend'
import { isConfigured, isSignedIn, signIn, signOut } from '../lib/google'
import { clearIdToken, getIdToken, refreshIdToken, renderSignInButton } from '../lib/idAuth'

type Status =
  | { kind: 'signedOut' }
  | { kind: 'checking' }
  | { kind: 'allowed' }
  | { kind: 'denied'; email: string; reason: string }
  | { kind: 'error'; message: string }

/** Shows the app only after Google sign-in and an allowlist check. Does nothing if no access sheet is configured. */
export function AccessGate({ children }: { children: ReactNode }) {
  // With the backend, the server decides who gets in; the list lives in the sheet, not in this code.
  if (isBackend()) return <BackendGate>{children}</BackendGate>
  if (!isGateEnabled()) return <>{children}</>
  return <Gate>{children}</Gate>
}

async function evaluate(): Promise<Status> {
  try {
    const result = await checkAccess()
    return result.state === 'allowed'
      ? { kind: 'allowed' }
      : { kind: 'denied', email: result.email, reason: result.reason }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

function Gate({ children }: { children: ReactNode }) {
  // A still-valid token from this browser session skips the sign-in click.
  const [status, setStatus] = useState<Status>(() =>
    isConfigured() && isSignedIn() ? { kind: 'checking' } : { kind: 'signedOut' },
  )

  useEffect(() => {
    if (status.kind !== 'checking') return
    let live = true
    void evaluate().then((next) => live && setStatus(next))
    return () => {
      live = false
    }
    // Runs once for the initial auto-check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSignIn() {
    setStatus({ kind: 'checking' })
    try {
      await signIn(true)
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      return
    }
    setStatus(await evaluate())
  }

  function handleSwitch() {
    signOut()
    setStatus({ kind: 'signedOut' })
  }

  if (status.kind === 'allowed') return <>{children}</>

  return (
    <div className="gate">
      <h1>Statement Sense</h1>
      <p className="muted">Thai bank statements → categorised spending</p>

      {!isConfigured() ? (
        <p className="banner">Sign-in is not configured for this site, so access is closed.</p>
      ) : status.kind === 'checking' ? (
        <p className="muted">Checking access…</p>
      ) : (
        <>
          {status.kind === 'denied' && (
            <p className="banner">
              {status.reason} Signed in as <span className="mono">{status.email}</span>.
            </p>
          )}
          {status.kind === 'error' && <p className="banner">{status.message}</p>}
          <div className="row" style={{ justifyContent: 'center' }}>
            <button onClick={status.kind === 'denied' ? handleSwitch : handleSignIn}>
              {status.kind === 'denied' ? 'Use a different account' : 'Sign in with Google'}
            </button>
          </div>
          <p className="muted small">Your statements are still read in your browser and are never uploaded.</p>
        </>
      )}
    </div>
  )
}

/** Sign in with Google; the backend then says whether this email is on the sheet's allow-list. */
function BackendGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>({ kind: 'checking' })
  const button = useRef<HTMLDivElement>(null)

  async function verify() {
    setStatus({ kind: 'checking' })
    try {
      await whoami()
      setStatus({ kind: 'allowed' })
    } catch (error) {
      if (error instanceof AuthError) {
        clearIdToken()
        setStatus({ kind: 'denied', email: '', reason: error.message })
      } else {
        setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  // On load: reuse or silently renew a token; if neither works, show the button.
  useEffect(() => {
    let live = true
    void (async () => {
      const token = getIdToken() || (await refreshIdToken())
      if (!live) return
      if (token) await verify()
      else setStatus({ kind: 'signedOut' })
    })()
    return () => {
      live = false
    }
  }, [])

  const showButton = status.kind === 'signedOut' || status.kind === 'denied' || status.kind === 'error'
  useEffect(() => {
    if (showButton && button.current) void renderSignInButton(button.current, () => void verify())
  }, [showButton])

  if (status.kind === 'allowed') return <>{children}</>

  return (
    <div className="gate">
      <h1>Statement Sense</h1>
      <p className="muted">Thai bank statements → categorised spending</p>
      {status.kind === 'checking' && <p className="muted">Checking access…</p>}
      {status.kind === 'denied' && <p className="banner">This account is not allowed to use this app. ({status.reason})</p>}
      {status.kind === 'error' && <p className="banner">{status.message}</p>}
      {showButton && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <div ref={button} />
        </div>
      )}
      <p className="muted small">Your statements are still read in your browser and are never uploaded.</p>
    </div>
  )
}
