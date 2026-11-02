/**
 * Duplicate detection, in two layers.
 *
 * 1. At import, drop rows that are already stored (`dedupeTransactions`,
 *    `dedupeOrders`). These only drop what is *certainly* the same row.
 * 2. After import, flag rows that look like the same row read twice with
 *    slightly different text (`lookAlike…`). These never delete anything: a
 *    person decides, because two real purchases can look alike too.
 *
 * Counting matters. Two ฿45 7-Eleven purchases on one day are two rows, not a
 * duplicate, so identical rows are matched one-for-one against what is already
 * stored rather than collapsed into a single row.
 */
import type { Order, Transaction } from './types'

/** Upper-case letters, marks and digits only, so spacing and punctuation noise never matters. */
export function normalizeText(text: string): string {
  // \p{M} keeps Thai vowel and tone marks, which are separate code points.
  return text.toUpperCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '')
}

/** How alike two descriptions are, 0 to 1 (Dice coefficient over letter pairs). Works for Thai, which has no spaces. */
export function similarity(a: string, b: string): number {
  const x = normalizeText(a)
  const y = normalizeText(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return 0

  const pairs = (s: string) => {
    const counts = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const pair = s.slice(i, i + 2)
      counts.set(pair, (counts.get(pair) ?? 0) + 1)
    }
    return counts
  }
  const left = pairs(x)
  const right = pairs(y)
  let shared = 0
  for (const [pair, count] of left) shared += Math.min(count, right.get(pair) ?? 0)
  return (2 * shared) / (x.length - 1 + (y.length - 1))
}

/** Descriptions at least this alike, on the same day for the same amount, are probably one row read twice. */
export const LOOK_ALIKE_THRESHOLD = 0.8

// ── at import ────────────────────────────────────────────────────────────────

const transactionKey = (t: Transaction) =>
  `${t.date}|${t.amount.toFixed(2)}|${t.description.slice(0, 40).toUpperCase()}`

/**
 * Drop incoming rows that are already stored, one-for-one. If a purchase
 * appears twice in a file and once in your data, one of them is new.
 */
export function dedupeTransactions(existing: Transaction[], incoming: Transaction[]): Transaction[] {
  const stock = new Map<string, number>()
  for (const t of existing) {
    const key = transactionKey(t)
    stock.set(key, (stock.get(key) ?? 0) + 1)
  }
  return incoming.filter((t) => {
    const key = transactionKey(t)
    const left = stock.get(key) ?? 0
    if (left > 0) {
      stock.set(key, left - 1)
      return false
    }
    return true
  })
}

/** Without an order number, what was bought tells two same-priced orders apart. */
const orderKey = (o: Order) =>
  `${o.date}|${o.amount.toFixed(2)}|${o.platform}|${normalizeText(o.description).slice(0, 30)}`

export function dedupeOrders(existing: Order[], incoming: Order[]): Order[] {
  // An order number is unique, so it is a set: the same number is the same order.
  const refs = new Set(existing.map((o) => o.orderRef).filter((r): r is string => Boolean(r)))
  // Everything else is counted, like transactions.
  const stock = new Map<string, number>()
  for (const o of existing) {
    if (o.orderRef) continue
    const key = orderKey(o)
    stock.set(key, (stock.get(key) ?? 0) + 1)
  }

  return incoming.filter((o) => {
    if (o.orderRef) {
      if (refs.has(o.orderRef)) return false
      refs.add(o.orderRef)
      return true
    }
    const key = orderKey(o)
    const left = stock.get(key) ?? 0
    if (left > 0) {
      stock.set(key, left - 1)
      return false
    }
    return true
  })
}

// ── after import ─────────────────────────────────────────────────────────────

/** Group items sharing a key, then compare only within each group. */
function lookAlikes<T extends { id: string; sourceFile: string; description: string }>(
  items: T[],
  groupKey: (item: T) => string,
  compatible: (a: T, b: T) => boolean,
): Map<string, T> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = groupKey(item)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  const found = new Map<string, T>() // id -> the row it resembles
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]
        // The same file twice over is a real repeat purchase, not a re-read.
        if (a.sourceFile === b.sourceFile) continue
        if (!compatible(a, b)) continue
        if (similarity(a.description, b.description) < LOOK_ALIKE_THRESHOLD) continue
        if (!found.has(a.id)) found.set(a.id, b)
        if (!found.has(b.id)) found.set(b.id, a)
      }
    }
  }
  return found
}

/** Rows that look like another row from a different file: same day, same amount, similar text. */
export function lookAlikeTransactions(transactions: Transaction[]): Map<string, Transaction> {
  return lookAlikes(transactions, (t) => `${t.date}|${t.amount.toFixed(2)}`, () => true)
}

/**
 * Orders that look like another order from a different file. Shopee lists often
 * carry no date, so a missing date on either side still counts as compatible.
 */
export function lookAlikeOrders(orders: Order[]): Map<string, Order> {
  return lookAlikes(
    orders,
    (o) => `${o.platform}|${o.amount.toFixed(2)}`,
    (a, b) => !a.date || !b.date || a.date === b.date,
  )
}
