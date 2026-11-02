import { useEffect, useState, type ReactNode } from 'react'
import { checkAccess, isGateEnabled } from '../lib/access'
import { isConfigured, isSignedIn, signIn, signOut } from '../lib/google'

type Status =
  | { kind: 'signedOut' }
  | { kind: 'checking' }
  | { kind: 'allowed' }
  | { kind: 'denied'; email: string; reason: string }
  | { kind: 'error'; message: string }

/** Shows the app only after Google sign-in and an allowlist check. Does nothing if no access sheet is configured. */
export function AccessGate({ children }: { children: ReactNode }) {
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
