/**
 * The Apps Script backend (apps-script/Code.gs).
 *
 * When VITE_BACKEND_URL is set, the app never talks to the Sheets API: it sends
 * rows to this script, which checks the person's Google ID token and the
 * sheet's allow-list, and merges rows under a lock.
 */
import { getIdToken, refreshIdToken } from './idAuth'

export const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? '').trim()
export const isBackend = () => BACKEND_URL.length > 0

export class AuthError extends Error {}

export type Row = Record<string, string | number | boolean>
export type TabRows = Record<string, Row[]>

async function call<T extends { ok: boolean }>(action: string, payload: object = {}): Promise<T> {
  const idToken = getIdToken() || (await refreshIdToken())
  if (!idToken) throw new AuthError('Please sign in with Google again.')
  // text/plain keeps this a "simple" request, so the browser sends no preflight.
  const response = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, idToken, ...payload }),
  })
  const data = (await response.json()) as T & { error?: string; reason?: string }
  if (!data.ok) {
    if (data.error === 'unauthorized') throw new AuthError(data.reason ?? 'Not allowed.')
    throw new Error(data.error ?? 'The backend returned an error.')
  }
  return data
}

export async function whoami(): Promise<string> {
  return (await call<{ ok: true; email: string }>('whoami')).email
}

export async function ping(): Promise<number> {
  return (await call<{ ok: true; rev: number }>('ping')).rev
}

export async function pullAll(): Promise<{ rev: number; tabs: TabRows }> {
  const { rev, tabs } = await call<{ ok: true; rev: number; tabs: TabRows }>('pull')
  return { rev, tabs }
}

export async function pushRows(tabs: TabRows): Promise<void> {
  await call<{ ok: true }>('push', { tabs })
}
