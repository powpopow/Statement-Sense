/**
 * Cash spending: one stated figure per month.
 *
 * Bank accounts are not tracked. Instead the user says, at month end, how much
 * went to their cash account, and that is taken to be personal spending.
 */
import type { CashEntry } from './types'

const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/
export const isMonth = (value: string) => MONTH_RE.test(value)

const round2 = (n: number) => Math.round(n * 100) / 100
const byMonthDescending = (a: CashEntry, b: CashEntry) => b.month.localeCompare(a.month)

/** The current month as YYYY-MM, in local time. */
export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Set one month's cash, replacing what was there. Zero, blank or nonsense
 * clears it: "nothing stated" is not the same as a guess of zero, and there is
 * no use in storing it.
 */
export function setCashEntry(cash: CashEntry[], month: string, amount: number | null, note?: string): CashEntry[] {
  if (!isMonth(month)) return cash
  const rest = cash.filter((c) => c.month !== month)
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return rest.sort(byMonthDescending)
  return [...rest, { month, amount: round2(amount), ...(note?.trim() ? { note: note.trim() } : {}) }].sort(byMonthDescending)
}

/** Total cash for one month, or for every month with `'all'`. */
export function cashFor(cash: CashEntry[], month: string): number {
  return round2(cash.filter((c) => month === 'all' || c.month === month).reduce((sum, c) => sum + c.amount, 0))
}

/** Cash by month, as a lookup. */
export function cashByMonth(cash: CashEntry[]): Map<string, number> {
  return new Map(cash.map((c) => [c.month, c.amount]))
}
