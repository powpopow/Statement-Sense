/**
 * The numbers behind the Summary screen, kept out of React so they can be tested.
 *
 * Spending is purchases less refunds. Rewards are shown beside it, not netted
 * in, and card payments are neither spending nor income — they just move money
 * to the card.
 */
import { kindOf } from './categorize'
import { merchantKey } from './suggest'
import type { Transaction } from './types'

export interface Totals {
  purchases: number
  purchaseCount: number
  refunded: number
  refundCount: number
  rewards: number
  rewardCount: number
  payments: number
  paymentCount: number
  /** Purchases less refunds. */
  net: number
}

export function totalsOf(rows: Transaction[]): Totals {
  const t: Totals = {
    purchases: 0, purchaseCount: 0, refunded: 0, refundCount: 0,
    rewards: 0, rewardCount: 0, payments: 0, paymentCount: 0, net: 0,
  }
  for (const row of rows) {
    switch (kindOf(row)) {
      case 'spend': t.purchases += row.amount; t.purchaseCount++; break
      case 'refund': t.refunded -= row.amount; t.refundCount++; break
      case 'cashback': t.rewards -= row.amount; t.rewardCount++; break
      case 'payment': t.payments -= row.amount; t.paymentCount++; break
    }
  }
  t.net = t.purchases - t.refunded
  return t
}

export interface NetGroup {
  key: string
  /** Purchases less refunds in this group. */
  value: number
  /** Number of purchases (refunds reduce the value, not the count). */
  count: number
}

/** Net spending per group, biggest first. Rewards and card payments are left out; groups that net to zero or less are dropped. */
export function netBy(rows: Transaction[], key: (t: Transaction) => string): NetGroup[] {
  const groups = new Map<string, NetGroup>()
  for (const row of rows) {
    const kind = kindOf(row)
    if (kind !== 'spend' && kind !== 'refund') continue
    const k = key(row)
    const group = groups.get(k) ?? { key: k, value: 0, count: 0 }
    group.value += row.amount
    if (kind === 'spend') group.count++
    groups.set(k, group)
  }
  return [...groups.values()].filter((g) => g.value > 0.005).sort((a, b) => b.value - a.value)
}

/**
 * The merchant a row belongs to, the same way the Rules tab groups them: no
 * processor prefix, store code, city or trailing reference. A points refund is
 * labelled "PWP: WWW.GRAB.COM" and its charges "WWW.GRAB.COM BANGKOK"; they
 * must land in one group for the refund to net against the spending.
 */
export function merchantLabel(description: string): string {
  return merchantKey(description.replace(/^\s*PWP:\s*/i, ''))
}

/**
 * The groups with the stated cash added in. Cash is one group of its own, so it
 * appears beside the categories, and a month's total includes that month's cash.
 */
export function withCashGroup(groups: NetGroup[], cash: number, months: number): NetGroup[] {
  if (cash <= 0) return groups
  return [...groups, { key: 'Cash', value: cash, count: months }].sort((a, b) => b.value - a.value)
}

export function withCashByMonth(groups: NetGroup[], cash: Map<string, number>): NetGroup[] {
  const merged = new Map(groups.map((g) => [g.key, { ...g }]))
  for (const [month, amount] of cash) {
    const group = merged.get(month) ?? { key: month, value: 0, count: 0 }
    group.value += amount
    merged.set(month, group)
  }
  return [...merged.values()]
}
