import { describe, expect, it } from 'vitest'
import { applyOwner, ME, ownerOf, ownerValue, peopleFrom, sharedOwner } from './people'
import type { Order, Transaction } from './types'

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 't1',
  date: '2026-10-01',
  description: 'SHOPEE THAILAND',
  amount: 500,
  currency: 'THB',
  category: 'Shopping',
  categoryLocked: false,
  source: 'test',
  sourceFile: 'a.pdf',
  confidence: 1,
  ...over,
})

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1',
  platform: 'Shopee',
  date: '2026-10-01',
  description: 'Face cream',
  amount: 500,
  currency: 'THB',
  sourceFile: 'a.png',
  confidence: 1,
  ...over,
})

describe('owners', () => {
  it('treats a missing or blank owner as you', () => {
    expect(ownerOf(tx())).toBe(ME)
    expect(ownerOf(tx({ owner: '  ' }))).toBe(ME)
    expect(ownerOf(tx({ owner: 'Mom' }))).toBe('Mom')
  })

  it('stores "Me" as no owner, so old data and sheets stay valid', () => {
    expect(ownerValue('Me')).toBeUndefined()
    expect(ownerValue(' me ')).toBeUndefined()
    expect(ownerValue('')).toBeUndefined()
    expect(ownerValue(' Mom ')).toBe('Mom')
  })

  it('lists you first, then everyone else once, ignoring case', () => {
    const people = peopleFrom([tx({ owner: 'mom' })], [order({ owner: 'Mom' }), order({ id: 'o2', owner: 'Pat' })], ['Aunt'])
    expect(people).toEqual(['Me', 'Aunt', 'mom', 'Pat'])
  })
})

describe('setting an owner', () => {
  it('changes an unmatched order on its own', () => {
    const result = applyOwner([tx()], [order()], { kind: 'order', id: 'o1' }, 'Mom')
    expect(result.orders[0].owner).toBe('Mom')
    expect(result.transactions[0].owner).toBeUndefined()
  })

  it('carries a matched pair together, from the order side', () => {
    const t = tx({ matchedOrderId: 'o1' })
    const o = order({ matchedTransactionId: 't1' })
    const result = applyOwner([t], [o], { kind: 'order', id: 'o1' }, 'Mom')
    expect(result.orders[0].owner).toBe('Mom')
    expect(result.transactions[0].owner).toBe('Mom')
  })

  it('carries a matched pair together, from the charge side', () => {
    const t = tx({ matchedOrderId: 'o1' })
    const o = order({ matchedTransactionId: 't1' })
    const result = applyOwner([t], [o], { kind: 'transaction', id: 't1' }, 'Pat')
    expect(result.orders[0].owner).toBe('Pat')
    expect(result.transactions[0].owner).toBe('Pat')
  })

  it('leaves other rows alone, and setting Me clears the owner', () => {
    const rows = [tx({ id: 't1', owner: 'Mom' }), tx({ id: 't2', owner: 'Mom' })]
    const result = applyOwner(rows, [], { kind: 'transaction', id: 't1' }, 'Me')
    expect(result.transactions[0].owner).toBeUndefined()
    expect(result.transactions[1].owner).toBe('Mom')
  })
})

describe('matching an order to a charge', () => {
  it("uses the order's owner when it has one", () => {
    expect(sharedOwner(order({ owner: 'Mom' }), tx({ owner: 'Pat' }))).toBe('Mom')
  })

  it("falls back to the charge's owner, then to you", () => {
    expect(sharedOwner(order(), tx({ owner: 'Pat' }))).toBe('Pat')
    expect(sharedOwner(order(), tx())).toBeUndefined()
  })
})
