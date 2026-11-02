import { describe, expect, it } from 'vitest'
import { backlogAsMarkdown, merchantKey, unmatchedMerchants } from './suggest'
import type { Transaction } from './types'

describe('merchant normalisation', () => {
  it('drops the city glued to the end', () => {
    expect(merchantKey('MRT-BEM Bangkok')).toBe('MRT-BEM')
    expect(merchantKey('TONCHIN BANGKOK')).toBe('TONCHIN')
    expect(merchantKey('U.A.S.T. CO.,LTD. NONTHABURI')).toBe('U.A.S.T. CO. LTD.')
  })

  it('keeps the merchant behind a payment processor prefix', () => {
    // The processor is not the shop; "DTAC" is what deserves a rule.
    expect(merchantKey('OMISE*OMISE *DTAC AUTOPABANGKOK')).toContain('DTAC')
    expect(merchantKey('LINEPAY*LP_BTS BANGKOK')).toBe('LP_BTS')
  })

  it('strips terminal and store codes', () => {
    expect(merchantKey('PZ2124-SAMYAN MITRTOWN BANGKOK')).toBe('SAMYAN MITRTOWN')
    expect(merchantKey('AMZ_SC2644 SINGHA COMPLEXBANGKOK')).toContain('SINGHA COMPLEX')
  })

  it('groups the same shop written two ways', () => {
    expect(merchantKey('SUSHIRO GH(TH) C.RAMA 9 BANGKOK')).toBe(
      merchantKey('SUSHIRO GH(TH) C.RAMA 9'),
    )
  })

  it('never returns something too short to be a usable rule', () => {
    expect(merchantKey('A1 BANGKOK').length).toBeGreaterThanOrEqual(3)
  })
})

const tx = (over: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36),
  date: '2026-09-20',
  description: 'SOMETHING',
  amount: 100,
  currency: 'THB',
  category: 'Uncategorized',
  categoryLocked: false,
  source: 'test',
  sourceFile: 'test.pdf',
  confidence: 0.9,
  ...over,
})

describe('unmatched merchant backlog', () => {
  it('groups variants of one merchant and sums the spend', () => {
    const groups = unmatchedMerchants([
      tx({ description: 'AMZ_SC2644 SINGHA COMPLEXBANGKOK', amount: 70, date: '2026-09-22' }),
      tx({ description: 'AMZ_SC2644 SINGHA COMPLEXBANGKOK', amount: 50, date: '2026-09-28' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(2)
    expect(groups[0].total).toBe(120)
    expect(groups[0].lastSeen).toBe('2026-09-28')
  })

  it('ranks by total spend, so the worth-doing rules come first', () => {
    const groups = unmatchedMerchants([
      tx({ description: 'SMALL SHOP BANGKOK', amount: 50 }),
      tx({ description: 'BIG SPEND BANGKOK', amount: 5000 }),
    ])
    expect(groups.map((g) => g.merchant)).toEqual(['BIG SPEND', 'SMALL SHOP'])
  })

  it('ignores rows that already have a category, and credits', () => {
    const groups = unmatchedMerchants([
      tx({ description: 'KNOWN SHOP', category: 'Groceries' }),
      tx({ description: 'A REFUND', amount: -500 }),
    ])
    expect(groups).toHaveLength(0)
  })

  it('renders a Markdown table that can be pasted elsewhere', () => {
    const md = backlogAsMarkdown(unmatchedMerchants([tx({ description: 'TONCHIN BANGKOK', amount: 410 })]))
    expect(md).toContain('| Merchant |')
    expect(md).toContain('TONCHIN')
    expect(md).toContain('410.00')
  })

  it('says so plainly when there is no backlog', () => {
    expect(backlogAsMarkdown([])).toMatch(/everything is categorised/i)
  })
})
