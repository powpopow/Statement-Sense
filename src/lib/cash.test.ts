import { describe, expect, it } from 'vitest'
import { cashByMonth, cashFor, currentMonth, isMonth, setCashEntry } from './cash'
import { withCashByMonth, withCashGroup, type NetGroup } from './summary'
import type { CashEntry } from './types'

describe('cash entries', () => {
  it('accepts only real months', () => {
    expect(isMonth('2026-10')).toBe(true)
    expect(isMonth('2026-13')).toBe(false)
    expect(isMonth('2026-1')).toBe(false)
    expect(isMonth('October')).toBe(false)
  })

  it('sets a month and replaces it rather than adding a second', () => {
    let cash: CashEntry[] = []
    cash = setCashEntry(cash, '2026-10', 15000)
    cash = setCashEntry(cash, '2026-10', 12000.456)
    expect(cash).toEqual([{ month: '2026-10', amount: 12000.46 }])
  })

  it('keeps months newest first', () => {
    let cash: CashEntry[] = []
    for (const m of ['2026-08', '2026-10', '2026-09']) cash = setCashEntry(cash, m, 100)
    expect(cash.map((c) => c.month)).toEqual(['2026-10', '2026-09', '2026-08'])
  })

  it('clears a month for zero, blank, negative or nonsense', () => {
    const start = setCashEntry([], '2026-10', 500)
    for (const bad of [0, null, -5, Number.NaN]) expect(setCashEntry(start, '2026-10', bad)).toEqual([])
  })

  it('ignores an invalid month instead of storing it', () => {
    expect(setCashEntry([], 'nonsense', 500)).toEqual([])
  })

  it('totals one month or all of them', () => {
    const cash = setCashEntry(setCashEntry([], '2026-09', 1000), '2026-10', 2500)
    expect(cashFor(cash, '2026-10')).toBe(2500)
    expect(cashFor(cash, '2026-08')).toBe(0)
    expect(cashFor(cash, 'all')).toBe(3500)
  })

  it('names the current month', () => {
    expect(currentMonth(new Date(2026, 9, 31))).toBe('2026-10')
    expect(currentMonth(new Date(2026, 0, 5))).toBe('2026-01')
  })
})

describe('folding cash into the summary', () => {
  const categories: NetGroup[] = [
    { key: 'Food & Drink', value: 900, count: 9 },
    { key: 'Transport', value: 300, count: 4 },
  ]

  it('adds cash as its own group, in order of size', () => {
    const groups = withCashGroup(categories, 1500, 2)
    expect(groups.map((g) => [g.key, g.value])).toEqual([['Cash', 1500], ['Food & Drink', 900], ['Transport', 300]])
  })

  it('adds nothing when there is no cash', () => {
    expect(withCashGroup(categories, 0, 0)).toBe(categories)
  })

  it('adds a month\'s cash to that month, and creates a month that has only cash', () => {
    const months: NetGroup[] = [{ key: '2026-09', value: 1000, count: 5 }]
    const merged = withCashByMonth(months, cashByMonth(setCashEntry(setCashEntry([], '2026-09', 200), '2026-10', 300)))
    expect(Object.fromEntries(merged.map((g) => [g.key, g.value]))).toEqual({ '2026-09': 1200, '2026-10': 300 })
  })

  it('does not change the groups it was given', () => {
    const months: NetGroup[] = [{ key: '2026-09', value: 1000, count: 5 }]
    withCashByMonth(months, new Map([['2026-09', 200]]))
    expect(months[0].value).toBe(1000)
  })
})
