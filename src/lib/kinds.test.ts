import { describe, expect, it } from 'vitest'
import { applyRules, categorizeOne, defaultRules, kindOf } from './categorize'
import { merchantLabel, netBy, totalsOf } from './summary'
import type { Transaction } from './types'

const rules = defaultRules()

let n = 0
const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  date: '2026-10-05',
  description: 'EXAMPLE SHOP BANGKOK',
  amount: 100,
  currency: 'THB',
  category: 'Shopping',
  categoryLocked: false,
  source: 'UOB Thailand — credit card',
  sourceFile: 'a.pdf',
  confidence: 1,
  ...over,
})

describe('what a credit on a card is', () => {
  it('treats a debit as spending', () => {
    expect(kindOf({ description: 'ANYTHING', amount: 45 })).toBe('spend')
  })

  it("recognises every issuer's wording for paying the card's own bill", () => {
    for (const d of [
      'PAYMENT THANK YOU - UOBT TMRW APP',
      'PAYMENT - THANK YOU - MOB 11608',
      'Payment via ttb touch BANGKOK TH',
      'Payment-SCB(014)Internet',
    ]) {
      expect(kindOf({ description: d, amount: -100 }), d).toBe('payment')
    }
  })

  it('recognises rewards', () => {
    expect(kindOf({ description: 'CB-055 WEEKEND SURPRISE AUG26(WEEK2)', amount: -500 })).toBe('cashback')
    expect(kindOf({ description: 'CASHBACK OCT', amount: -20 })).toBe('cashback')
  })

  it('calls any other credit a refund', () => {
    expect(kindOf({ description: 'PWP: WWW.GRAB.COM', amount: -58 })).toBe('refund')
    expect(kindOf({ description: 'CR CARD MEMBERSHIP FEE - INC OF VAT', amount: -2140 })).toBe('refund')
    expect(kindOf({ description: 'SHOPEE THAILAND', amount: -1450 })).toBe('refund')
  })
})

describe('filing a card credit', () => {
  const card = { card: true }

  it('files a card payment as a transfer, and a reward as a reward', () => {
    expect(categorizeOne('PAYMENT THANK YOU - UOBT TMRW APP', -1475, rules, card)).toBe('Cash & Transfers')
    expect(categorizeOne('CB-055 WEEKEND SURPRISE', -500, rules, card)).toBe('Rewards & Cashback')
  })

  it("files a refund under the merchant's own category so it nets against it, never as Income", () => {
    expect(categorizeOne('PWP: WWW.GRAB.COM', -58, rules, card)).toBe('Transport')
    expect(categorizeOne('REFUND SHOPEE THAILAND', -300, rules, card)).toBe('Shopping')
    expect(categorizeOne('CR CARD MEMBERSHIP FEE - INC OF VAT', -2140, rules, card)).toBe('Fees & Interest')
  })

  it('leaves an unrecognised credit uncategorised rather than calling it income', () => {
    expect(categorizeOne('MYSTERY ADJUSTMENT', -10, rules, card)).toBe('Uncategorized')
  })

  it('keeps the old behaviour for anything that is not a card', () => {
    expect(categorizeOne('SALARY TRANSFER COMPANY LTD', -45000, rules)).toBe('Income')
    expect(categorizeOne('SHOPEE THAILAND', -1450, rules)).toBe('Income')
  })

  it('applies card handling from the row\'s source label', () => {
    const [onCard, onAccount] = applyRules(
      [
        tx({ description: 'PWP: WWW.GRAB.COM', amount: -58, source: 'UOB Thailand — credit card' }),
        tx({ description: 'PWP: WWW.GRAB.COM', amount: -58, source: 'Kasikornbank (KBank) — account' }),
      ],
      rules,
    )
    expect(onCard.category).toBe('Transport')
    expect(onAccount.category).toBe('Income')
  })
})

describe('summary maths', () => {
  const rows = [
    tx({ amount: 100, category: 'Transport', description: 'GRABCAR A' }),
    tx({ amount: 200, category: 'Transport', description: 'GRABCAR B' }),
    tx({ amount: 80, category: 'Groceries', description: '7-ELEVEN' }),
    tx({ amount: -50, category: 'Transport', description: 'PWP: WWW.GRAB.COM' }),
    tx({ amount: -500, category: 'Cash & Transfers', description: 'PAYMENT THANK YOU' }),
    tx({ amount: -10, category: 'Rewards & Cashback', description: 'CASHBACK OCT' }),
  ]

  it('spends purchases less refunds, and keeps rewards and card payments apart', () => {
    const t = totalsOf(rows)
    expect(t).toMatchObject({ purchases: 380, refunded: 50, rewards: 10, payments: 500, net: 330 })
    expect(t).toMatchObject({ purchaseCount: 3, refundCount: 1, rewardCount: 1, paymentCount: 1 })
  })

  it('nets a refund against its own category, and leaves payments and rewards out', () => {
    const byCategory = netBy(rows, (r) => r.category)
    expect(byCategory.map((g) => [g.key, g.value])).toEqual([['Transport', 250], ['Groceries', 80]])
  })

  it('drops a group whose refunds cancel its purchases', () => {
    const cancelled = [tx({ amount: 58, category: 'Transport' }), tx({ amount: -58, category: 'Transport', description: 'PWP: WWW.GRAB.COM' })]
    expect(netBy(cancelled, (r) => r.category)).toEqual([])
  })

  it('groups by month', () => {
    const months = netBy(
      [tx({ date: '2026-09-30', amount: 40 }), tx({ date: '2026-10-01', amount: 60 }), tx({ date: '2026-10-02', amount: 15 })],
      (r) => r.date.slice(0, 7),
    )
    expect(Object.fromEntries(months.map((g) => [g.key, g.value]))).toEqual({ '2026-09': 40, '2026-10': 75 })
  })

  it('names a merchant without its city or trailing reference number', () => {
    expect(merchantLabel('SHOPEEFOOD BANGKOK')).toBe('SHOPEEFOOD')
    expect(merchantLabel('OMISE*OMISE *DTAC AUTOPABANGKOK')).toContain('DTAC')
    expect(merchantLabel('7-ELEVEN')).toBe('7-ELEVEN')
  })

  it('puts a points refund and its charges under one merchant, so the refund nets', () => {
    expect(merchantLabel('PWP: WWW.GRAB.COM')).toBe(merchantLabel('WWW.GRAB.COM BANGKOK'))
    const rows = [
      tx({ amount: 191, description: 'WWW.GRAB.COM BANGKOK' }),
      tx({ amount: 58, description: 'WWW.GRAB.COM BANGKOK' }),
      tx({ amount: -191, description: 'PWP: WWW.GRAB.COM' }),
    ]
    const [grab] = netBy(rows, (r) => merchantLabel(r.description))
    expect(grab.value).toBe(58)
    expect(grab.count).toBe(2)
  })
})
