/**
 * Access gate: sign in with Google, then check the signed-in email against
 * VITE_ALLOWED_EMAILS (comma-separated).
 *
 * This is a soft gate. The site is static and its code is public, so a
 * determined developer can bypass the check in their own browser, and the
 * allowed emails are visible in the built code. It keeps casual visitors out;
 * the data itself is protected by Google (each user's own Drive), not by this
 * check. Leave the variable empty to turn the gate off.
 */

import { googleFetch } from './google'

/** "a@x.com, B@x.com" -> Set { "a@x.com", "b@x.com" }. Blanks and non-emails are ignored. */
export function parseAllowlist(raw: string | undefined): Set<string> {
  const emails = new Set<string>()
  for (const part of (raw ?? '').split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase()
    if (email.includes('@')) emails.add(email)
  }
  return emails
}

const ALLOWED = parseAllowlist(import.meta.env.VITE_ALLOWED_EMAILS)

export function isGateEnabled(): boolean {
  return ALLOWED.size > 0
}

export type AccessResult =
  | { state: 'allowed'; email: string }
  | { state: 'denied'; email: string; reason: string }

async function fetchEmail(): Promise<string> {
  const response = await googleFetch('https://openidconnect.googleapis.com/v1/userinfo')
  const info = (await response.json()) as { email?: string; email_verified?: boolean }
  if (!info.email || info.email_verified === false) {
    throw new Error('Google did not return a verified email for this account.')
  }
  return info.email.trim().toLowerCase()
}

/** Read the signed-in email and check it against the allowed list. Throws on network problems. */
export async function checkAccess(): Promise<AccessResult> {
  const email = await fetchEmail()
  return ALLOWED.has(email)
    ? { state: 'allowed', email }
    : { state: 'denied', email, reason: 'This account is not allowed to use this app.' }
}
