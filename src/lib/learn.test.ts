import { describe, expect, it } from 'vitest'
import { applyRules, categorizeOne, defaultRules } from './categorize'
import { learnPattern, learnedRule, proposeRule, withLearnedRule } from './learn'
import type { Transaction } from './types'

let n = 0
const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  date: '2026-10-05',
  description: 'SOME LITTLE CAFE SILOM BANGKOK',
  amount: 100,
  currency: 'THB',
  category: 'Uncategorized',
  categoryLocked: false,
  source: 'UOB Thailand — credit card',
  sourceFile: 'a.pdf',
  confidence: 1,
  ...over,
})

describe('learnPattern', () => {
  it('finds the merchant without its city', () => {
    expect(learnPattern('WWW.GRAB.COM BANGKOK')).toBe('WWW.GRAB.COM')
    expect(learnPattern('SHOPEEFOOD BANGKOK')).toBe('SHOPEEFOOD')
  })

  it('offers nothing when the cleaned name is no longer in the statement line', () => {
    // The cleaned name "OMISE DTAC AUTOPA" does not appear literally, so a rule from it would never fire.
    expect(learnPattern('OMISE*OMISE *DTAC AUTOPABANGKOK')).toBeNull()
  })
})

describe('proposeRule', () => {
  const rules = defaultRules()

  it('counts the other rows it would fix, skipping locked and already-correct ones', () => {
    const changed = tx({ description: 'NOVEL BISTRO ZZZ BANGKOK', category: 'Food & Drink', categoryLocked: true })
    const rows = [
      changed,
      tx({ description: 'NOVEL BISTRO ZZZ BANGKOK' }),
      tx({ description: 'NOVEL BISTRO ZZZ BANGKOK' }),
      tx({ description: 'NOVEL BISTRO ZZZ BANGKOK', categoryLocked: true, category: 'Shopping' }),
      tx({ description: 'NOVEL BISTRO ZZZ BANGKOK', category: 'Food & Drink' }),
      tx({ description: 'UNRELATED SHOP BANGKOK' }),
    ]
    const proposal = proposeRule(rows, changed, 'Food & Drink', rules)!
    expect(proposal.rule.pattern).toBe('NOVEL BISTRO ZZZ')
    expect(proposal.affects).toBe(2)
  })

  it('offers nothing when that rule already exists', () => {
    const changed = tx({ description: 'NOVEL BISTRO ZZZ BANGKOK', category: 'Food & Drink' })
    const withRule = withLearnedRule(rules, learnedRule('NOVEL BISTRO ZZZ', 'Food & Drink'))
    expect(proposeRule([changed], changed, 'Food & Drink', withRule)).toBeNull()
  })

  it('offers nothing when no safe pattern exists', () => {
    const changed = tx({ description: 'OMISE*OMISE *DTAC AUTOPABANGKOK' })
    expect(proposeRule([changed], changed, 'Bills & Utilities', rules)).toBeNull()
  })
})

describe('a learned rule', () => {
  it('beats the built-in rules, so a correction wins over the seed list', () => {
    // Seeds file CENTRAL under Shopping; the person says this one is a restaurant.
    const description = 'ZZ PLACE CENTRAL PARK BANGKOK'
    expect(categorizeOne(description, 120, defaultRules())).toBe('Shopping')
    const rules = withLearnedRule(defaultRules(), learnedRule('ZZ PLACE', 'Food & Drink'))
    expect(categorizeOne(description, 120, rules)).toBe('Food & Drink')
  })

  it('re-files the other rows but never a row the person fixed by hand', () => {
    const fixed = tx({ description: 'NOVEL BISTRO ZZZ BANGKOK', category: 'Entertainment', categoryLocked: true })
    const other = tx({ description: 'NOVEL BISTRO ZZZ BANGKOK' })
    const rules = withLearnedRule(defaultRules(), learnedRule('NOVEL BISTRO ZZZ', 'Food & Drink'))
    const [a, b] = applyRules([fixed, other], rules)
    expect(a.category).toBe('Entertainment')
    expect(b.category).toBe('Food & Drink')
  })

  it('replaces an earlier learned rule for the same merchant instead of stacking', () => {
    const first = learnedRule('NOVEL BISTRO ZZZ', 'Shopping')
    const second = learnedRule('NOVEL BISTRO ZZZ', 'Food & Drink')
    const rules = withLearnedRule(withLearnedRule(defaultRules(), first), second)
    expect(rules.filter((r) => r.id === second.id)).toEqual([second])
  })
})

describe('the wider rule list', () => {
  const rules = defaultRules()
  const file = (d: string) => categorizeOne(d, 100, rules, { card: true })

  it('files food by its wording, not by the mall it is in', () => {
    expect(file('SIAM PARAGON FOOD HALL BANGKOK')).toBe('Food & Drink')
    expect(file('GRILL EXAMPLE CENTRAL PARK BANGKOK')).toBe('Food & Drink')
  })

  it('files digital purchases, games, donations and chain restaurants', () => {
    expect(file('APPLE.COM/BILL CORK IE THB')).toBe('Entertainment')
    expect(file('EXAMPLE GAMES SINGAPORE SG THB')).toBe('Entertainment')
    expect(file('EXAMPLE CHILDREN FOUNDATIO BANGKOK')).toBe('Gifts & Donations')
    expect(file('SUSHIRO GH(TH) C.RAMA 9 BANGKOK')).toBe('Food & Drink')
    expect(file('TMN*FAST FOOD BANGKOK TH THB')).toBe('Food & Drink')
    expect(file('TMN*TMN 7-11 BANGKOK TH THB')).toBe('Groceries')
    expect(file('AMZ_SC2644 SINGHA COMPLEXBANGKOK')).toBe('Food & Drink')
  })

  it('does not over-reach: a "tea" or "grill" inside another word is left alone', () => {
    expect(file('STEAMBOAT PLAZA')).not.toBe('Food & Drink') // contains TEA inside STEAMBOAT
    expect(file('ANYTHING UNKNOWN BANGKOK')).toBe('Uncategorized')
  })
})
