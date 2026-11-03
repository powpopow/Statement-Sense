import { describe, expect, it } from 'vitest'
import { addStatement, chainLinks } from './chain'
import type { StatementRecord } from './types'

const rec = (over: Partial<StatementRecord>): StatementRecord => ({
  id: `${over.periodEnd}|${over.closing}`,
  bank: 'acme',
  last4: '1234',
  periodEnd: '2026-09-14',
  closing: 100,
  net: 100,
  sourceFile: 'a.pdf',
  ...over,
})

describe('chainLinks', () => {
  it('matches when the next opening is the last closing, even if the bank prints no opening', () => {
    // Sep closes at 100. Oct: purchases 80, payment -100, closes at 80: implied opening 100.
    const links = chainLinks([rec({ periodEnd: '2026-09-14', closing: 100 }), rec({ periodEnd: '2026-10-14', closing: 80, net: -20 })])
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ status: 'matches', difference: 0 })
  })

  it('breaks, and says by how much, when a row is wrong', () => {
    const links = chainLinks([rec({ periodEnd: '2026-09-14', closing: 100 }), rec({ periodEnd: '2026-10-14', closing: 80, net: -30 })])
    expect(links[0]).toMatchObject({ status: 'break', difference: 10 })
  })

  it('uses the printed opening when there is one', () => {
    const links = chainLinks([rec({ periodEnd: '2026-09-14', closing: 100 }), rec({ periodEnd: '2026-10-14', opening: 100, closing: 150, net: 50 })])
    expect(links[0].status).toBe('matches')
  })

  it('reports a missing month instead of a break', () => {
    const links = chainLinks([rec({ periodEnd: '2026-08-14' }), rec({ periodEnd: '2026-10-14', closing: 5, net: 5 })])
    expect(links[0].status).toBe('gap')
  })

  it('keeps cards apart and orders by date whatever the import order', () => {
    const links = chainLinks([
      rec({ periodEnd: '2026-10-14', closing: 80, net: -20 }),
      rec({ last4: '9999', periodEnd: '2026-09-14', closing: 7 }),
      rec({ periodEnd: '2026-09-14', closing: 100 }),
    ])
    expect(links).toHaveLength(1)
    expect(links[0].status).toBe('matches')
  })

  it('needs two statements of one card to say anything', () => {
    expect(chainLinks([rec({})])).toEqual([])
  })
})

describe('addStatement', () => {
  it('adds nothing when the same statement is imported again', () => {
    const r = rec({})
    expect(addStatement([r], { ...r })).toHaveLength(1)
  })
})
