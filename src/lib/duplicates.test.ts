import { describe, expect, it } from 'vitest'
import {
  dedupeOrders,
  dedupeTransactions,
  lookAlikeOrders,
  lookAlikeTransactions,
  similarity,
} from './duplicates'
import type { Order, Transaction } from './types'

let n = 0
const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  date: '2026-10-05',
  description: '7-ELEVEN SUKHUMVIT 21',
  amount: 45,
  currency: 'THB',
  category: 'Groceries',
  categoryLocked: false,
  source: 'test',
  sourceFile: 'a.pdf',
  confidence: 1,
  ...over,
})

const order = (over: Partial<Order> = {}): Order => ({
  id: `o${++n}`,
  platform: 'Shopee',
  date: '',
  description: 'Glow Store Vitamin C serum 30ml',
  amount: 199,
  currency: 'THB',
  sourceFile: 'a.png',
  confidence: 1,
  ...over,
})

describe('dedupeTransactions', () => {
  it('keeps two identical purchases that are both really in the file', () => {
    // Two ฿45 7-Eleven buys on one day: two rows, not a duplicate.
    expect(dedupeTransactions([], [tx(), tx()])).toHaveLength(2)
  })

  it('drops everything when the same file is imported again', () => {
    const stored = [tx(), tx(), tx({ amount: 80 })]
    const again = [tx(), tx(), tx({ amount: 80 })]
    expect(dedupeTransactions(stored, again)).toHaveLength(0)
  })

  it('keeps only the extra when an overlapping import has one more of the same row', () => {
    // One stored; the overlapping screenshot shows it plus a genuine second.
    expect(dedupeTransactions([tx()], [tx(), tx()])).toHaveLength(1)
  })

  it('ignores case and anything after the first 40 characters', () => {
    const stored = [tx({ description: '7-eleven sukhumvit 21' })]
    expect(dedupeTransactions(stored, [tx({ description: '7-ELEVEN SUKHUMVIT 21' })])).toHaveLength(0)
  })

  it('keeps rows that differ in date or amount', () => {
    expect(dedupeTransactions([tx()], [tx({ date: '2026-10-06' }), tx({ amount: 46 })])).toHaveLength(2)
  })
})

describe('dedupeOrders', () => {
  it('treats the same order number as the same order, even twice in one batch', () => {
    const stored = [order({ orderRef: 'SP123' })]
    const incoming = [order({ orderRef: 'SP123' }), order({ orderRef: 'SP999' }), order({ orderRef: 'SP999' })]
    expect(dedupeOrders(stored, incoming)).toHaveLength(1)
  })

  it('does not merge two undated orders of the same price that are different items', () => {
    const incoming = [order(), order({ description: 'Pet Planet cat food 1kg' })]
    expect(dedupeOrders([], incoming)).toHaveLength(2)
  })

  it('does drop an undated order that is the same item already stored', () => {
    expect(dedupeOrders([order()], [order()])).toHaveLength(0)
  })
})

describe('similarity', () => {
  it('scores OCR noise as very alike', () => {
    expect(similarity('7-ELEVEN SUKHUMVIT 21', '7-ELEVEN SUKHUM VIT 21')).toBeGreaterThan(0.9)
    expect(similarity('Glow Store Vitamin C serum', 'Glow St0re Vitamin C seram')).toBeGreaterThan(0.8)
  })

  it('scores different merchants as unlike', () => {
    expect(similarity('7-ELEVEN SUKHUMVIT 21', 'GRAB*A-1234 BANGKOK')).toBeLessThan(0.4)
  })

  it('works on Thai text, which has no spaces to split on', () => {
    expect(similarity('เซเว่น อีเลฟเว่น สุขุมวิท', 'เซเว่น อีเลฟเว่น สุขมวิท')).toBeGreaterThan(0.8)
    expect(similarity('เซเว่น อีเลฟเว่น', 'การไฟฟ้านครหลวง')).toBeLessThan(0.4)
  })

  it('is 0 for empty text', () => {
    expect(similarity('', 'x')).toBe(0)
  })
})

describe('lookAlikeTransactions', () => {
  it('flags the same row read from two different files with different text', () => {
    const a = tx({ sourceFile: 'statement.pdf' })
    const b = tx({ sourceFile: 'screenshot.png', description: '7-ELEVEN SUKHUM VIT 21' })
    const found = lookAlikeTransactions([a, b])
    expect(found.get(a.id)).toBe(b)
    expect(found.get(b.id)).toBe(a)
  })

  it('does not flag repeat purchases that come from the same file', () => {
    expect(lookAlikeTransactions([tx(), tx()]).size).toBe(0)
  })

  it('does not flag different amounts, different days, or unlike merchants', () => {
    const base = tx({ sourceFile: 'a.pdf' })
    const others = [
      tx({ sourceFile: 'b.png', amount: 46 }),
      tx({ sourceFile: 'b.png', date: '2026-10-06' }),
      tx({ sourceFile: 'b.png', description: 'GRAB*A-1234 BANGKOK' }),
    ]
    expect(lookAlikeTransactions([base, ...others]).size).toBe(0)
  })
})

describe('lookAlikeOrders', () => {
  it('flags the same undated order read from two screenshots', () => {
    const a = order({ sourceFile: 'one.png' })
    const b = order({ sourceFile: 'two.png', description: 'Glow Store Vitamin C serum 30 ml' })
    expect(lookAlikeOrders([a, b]).size).toBe(2)
  })

  it('does not flag two different items that happen to cost the same', () => {
    const a = order({ sourceFile: 'one.png' })
    const b = order({ sourceFile: 'two.png', description: 'Pet Planet cat food 1kg' })
    expect(lookAlikeOrders([a, b]).size).toBe(0)
  })

  it('does not flag orders on different known dates', () => {
    const a = order({ sourceFile: 'one.png', date: '2026-10-01' })
    const b = order({ sourceFile: 'two.png', date: '2026-10-09' })
    expect(lookAlikeOrders([a, b]).size).toBe(0)
  })
})
