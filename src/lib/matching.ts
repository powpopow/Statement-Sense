/**
 * Matching marketplace orders to card transactions.
 *
 * A Shopee order and its card charge rarely agree on anything except the
 * amount: the merchant name on the statement is the payment processor, and the
 * charge posts a day or three after the order. So amount does the heavy lifting,
 * date proximity breaks ties, and a merchant-name hit is a bonus.
 */
import type { MatchCandidate, Order, Transaction } from './types'

/** Charges post late, and sometimes a day early for timezone reasons. */
const MAX_DAY_GAP = 7

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(a) - Date.parse(b))
  return Math.round(ms / 86_400_000)
}

function platformAppearsIn(order: Order, description: string): boolean {
  const d = description.toUpperCase()
  const aliases: Record<Order['platform'], string[]> = {
    Shopee: ['SHOPEE', 'SPX', 'AIRPAY', 'SEA MONEY', 'SEAMONEY'],
    Grab: ['GRAB', 'GRABPAY'],
    Lazada: ['LAZADA', 'LAZ', 'ALIPAY'],
    'LINE MAN': ['LINE MAN', 'LINEMAN', 'LINE PAY', 'WONGNAI'],
    Foodpanda: ['FOODPANDA', 'PANDA', 'DELIVERY HERO'],
    Other: [],
  }
  return aliases[order.platform].some((a) => d.includes(a))
}

function scorePair(transaction: Transaction, order: Order): MatchCandidate | null {
  // Only outgoing money can pay for an order.
  if (transaction.amount <= 0) return null

  // Shopee's purchases list shows no order date, so those orders arrive
  // dateless. Rejecting them would lose the match entirely; instead they pair
  // on amount alone and score lower, so they surface for confirmation.
  const dateKnown = Boolean(order.date)
  const amountDiff = Math.abs(transaction.amount - order.amount)
  const dayGap = dateKnown ? daysBetween(transaction.date, order.date) : 0
  if (dateKnown && dayGap > MAX_DAY_GAP) return null

  const reasons: string[] = []
  let score = 0

  if (amountDiff < 0.01) {
    score += 0.6
    reasons.push('Exact amount match')
  } else if (amountDiff <= Math.max(1, order.amount * 0.02)) {
    // Small gaps happen when a coupon or coin redemption is applied late.
    score += 0.35
    reasons.push(`Amount differs by ${amountDiff.toFixed(2)} THB`)
  } else {
    return null
  }

  if (!dateKnown) {
    reasons.push('Order date not shown, matched on amount')
  } else if (dayGap === 0) {
    score += 0.25
    reasons.push('Same day')
  } else if (dayGap <= 3) {
    score += 0.18
    reasons.push(`Posted ${dayGap} day${dayGap === 1 ? '' : 's'} later`)
  } else {
    score += 0.05
    reasons.push(`Posted ${dayGap} days later`)
  }

  if (platformAppearsIn(order, transaction.description)) {
    score += 0.2
    reasons.push(`${order.platform} appears in the statement description`)
  }

  return { transaction, order, score: Math.min(1, score), reasons }
}

/**
 * Greedy one-to-one assignment: take the best-scoring pair, remove both sides,
 * repeat. Good enough here, and it never double-books a transaction.
 */
export function findMatches(transactions: Transaction[], orders: Order[]): MatchCandidate[] {
  const pairs: MatchCandidate[] = []
  for (const t of transactions) {
    for (const o of orders) {
      const candidate = scorePair(t, o)
      if (candidate) pairs.push(candidate)
    }
  }

  pairs.sort((a, b) => b.score - a.score)

  const usedTransactions = new Set<string>()
  const usedOrders = new Set<string>()
  const accepted: MatchCandidate[] = []

  for (const pair of pairs) {
    if (usedTransactions.has(pair.transaction.id) || usedOrders.has(pair.order.id)) continue
    usedTransactions.add(pair.transaction.id)
    usedOrders.add(pair.order.id)
    accepted.push(pair)
  }

  return accepted
}

/** Matches at or above this score are applied without asking. */
export const AUTO_MATCH_THRESHOLD = 0.8
