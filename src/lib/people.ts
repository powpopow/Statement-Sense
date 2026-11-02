/**
 * Whose money a charge or order is.
 *
 * Not every purchase on your card is yours: you buy things for your mum, or
 * for a friend who asked. Each transaction and order can carry an owner, and
 * "Me" — the default — is stored as no owner at all, so data from before this
 * existed, and sheets that have no owner column, keep working untouched.
 */
import { useCallback, useMemo, useState } from 'react'
import type { Order, Transaction } from './types'

/** The default owner: whoever is using the app. */
export const ME = 'Me'

const PEOPLE_KEY = 'statement-sense.people'
/** Suggested on a fresh install; anyone can be added from the owner menu. */
const DEFAULT_EXTRA_PEOPLE = ['Mom']

interface Owned {
  owner?: string
}

export const ownerOf = (item: Owned): string => item.owner?.trim() || ME

/** What to store for a chosen name: "Me" and blanks mean "no owner". */
export function ownerValue(name: string): string | undefined {
  const clean = name.trim()
  return !clean || clean.toLowerCase() === ME.toLowerCase() ? undefined : clean
}

/** Everyone who can be picked: you, anyone already on a row, and saved extras. */
export function peopleFrom(transactions: Owned[], orders: Owned[], extra: string[] = []): string[] {
  const seen = new Map<string, string>() // lower-case -> first spelling seen
  for (const name of [...transactions, ...orders].map((x) => x.owner?.trim() ?? '').concat(extra)) {
    const clean = name.trim()
    if (clean && clean.toLowerCase() !== ME.toLowerCase() && !seen.has(clean.toLowerCase())) {
      seen.set(clean.toLowerCase(), clean)
    }
  }
  return [ME, ...[...seen.values()].sort((a, b) => a.localeCompare(b))]
}

/**
 * Set the owner of an order or a transaction. A matched pair is one purchase,
 * so the partner changes with it.
 */
export function applyOwner(
  transactions: Transaction[],
  orders: Order[],
  target: { kind: 'order' | 'transaction'; id: string },
  name: string,
): { transactions: Transaction[]; orders: Order[] } {
  const owner = ownerValue(name)
  let orderId: string | undefined
  let transactionId: string | undefined

  if (target.kind === 'order') {
    orderId = target.id
    transactionId = orders.find((o) => o.id === target.id)?.matchedTransactionId
  } else {
    transactionId = target.id
    orderId = transactions.find((t) => t.id === target.id)?.matchedOrderId
  }

  return {
    transactions: transactions.map((t) => (t.id === transactionId ? { ...t, owner } : t)),
    orders: orders.map((o) => (o.id === orderId ? { ...o, owner } : o)),
  }
}

/**
 * When an order is matched to a charge they become one purchase with one owner.
 * The order's wins if it has one: it was tagged by someone who knew what it was.
 */
export function sharedOwner(order: Order, transaction: Transaction): string | undefined {
  return order.owner?.trim() || transaction.owner?.trim() || undefined
}

function readExtraPeople(): string[] {
  try {
    const raw = localStorage.getItem(PEOPLE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === 'string')
    }
  } catch {
    // A corrupt list just falls back to the suggestion.
  }
  return DEFAULT_EXTRA_PEOPLE
}

/** The people list for the owner menus, plus a way to add someone new. */
export function usePeople(transactions: Transaction[], orders: Order[]) {
  const [extra, setExtra] = useState<string[]>(readExtraPeople)
  const people = useMemo(() => peopleFrom(transactions, orders, extra), [transactions, orders, extra])

  /** Returns the name as it should be stored, or null if it was empty. */
  const addPerson = useCallback(
    (raw: string): string | null => {
      const clean = raw.trim().replace(/\s+/g, ' ').slice(0, 40)
      if (!clean || clean.toLowerCase() === ME.toLowerCase()) return null
      const existing = people.find((p) => p.toLowerCase() === clean.toLowerCase())
      if (existing) return existing
      const next = [...extra, clean]
      setExtra(next)
      try {
        localStorage.setItem(PEOPLE_KEY, JSON.stringify(next))
      } catch {
        // Not saved for next time, but the name is on the row and will reappear.
      }
      return clean
    },
    [people, extra],
  )

  return { people, addPerson }
}
