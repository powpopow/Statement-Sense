/** Card sections and the balance check. The statements here are invented. */
import { describe, expect, it } from 'vitest'
import { balanceOn, cardLast4, reconcile } from './sections'
import { parseStatement } from './statement'

// Modelled on how issuers lay out a multi-card statement: each card has a product
// line, then its masked number, then "previous balance", its rows and a total.
const TWO_CARDS = [
  'ACME UOB CREDIT CARD STATEMENT',
  'STATEMENT DATE 13 OCT 2026  PAYMENT DUE DATE 05 NOV 2026',
  'POINTS EARNED 5100 12XX XXXX 9999 100', // a number in a points table, before any card section
  'POST DATE TRANS DATE DESCRIPTION AMOUNT (THB)',
  'ALPHA CARD',
  '5100 12XX XXXX 1111 SOME HOLDER',
  'PREVIOUS BALANCE 100.00',
  '30 SEP 30 SEP PAYMENT THANK YOU 100.00 CR',
  '15 SEP 14 SEP EXAMPLE SHOP A BANGKOK 40.00',
  '16 SEP 15 SEP EXAMPLE SHOP B BANGKOK 60.00',
  'SUB TOTAL 100.00',
  'TOTAL BALANCE - ALPHA CARD 100.00',
  'BETA CARD',
  '5200 34XX XXXX 5555 SOME HOLDER',
  'PREVIOUS BALANCE 500.00',
  '02 OCT 01 OCT REFUND EXAMPLE SHOP C 700.00 CR',
  '03 OCT 02 OCT EXAMPLE SHOP D BANGKOK 50.00',
  'SUB TOTAL 150.00 CR',
  'TOTAL BALANCE - BETA CARD 150.00 CR',
]

const parse = (lines: string[]) => parseStatement([lines], 'x.pdf', 'x')

describe('card sections', () => {
  const result = parse(TWO_CARDS)

  it('gives every card its own number, even when a stale one sits in a table above', () => {
    expect(result.reconciliation.map((r) => r.last4)).toEqual(['1111', '5555'])
  })

  it('tags each row with its card', () => {
    expect(result.transactions.map((t) => t.accountName)).toEqual([
      'UOB ••1111', 'UOB ••1111', 'UOB ••1111', 'UOB ••5555', 'UOB ••5555',
    ])
    expect(result.transactions[0].account).toBe('uob-1111')
  })

  it('proves each card adds up, including one that closes in credit (CR)', () => {
    expect(result.reconciliation.map((r) => r.status)).toEqual(['verified', 'verified'])
    expect(result.reconciliation[1]).toMatchObject({ opening: 500, closing: -150, net: -650, difference: 0 })
  })
})

describe('when a statement does not add up', () => {
  it('flags a closing balance that disagrees with the rows, and says by how much', () => {
    const tampered = TWO_CARDS.map((l) => (l.startsWith('TOTAL BALANCE - ALPHA') ? 'TOTAL BALANCE - ALPHA CARD 110.00' : l))
    const result = parse(tampered)
    const alpha = result.reconciliation[0]
    expect(alpha.status).toBe('mismatch')
    expect(alpha.difference).toBe(10)
    expect(alpha.detail).toContain('missing from the rows')
    // The other card is unaffected.
    expect(result.reconciliation[1].status).toBe('verified')
  })

  it('catches a row that went missing', () => {
    const missing = TWO_CARDS.filter((l) => !l.includes('EXAMPLE SHOP B'))
    const alpha = parse(missing).reconciliation[0]
    expect(alpha.status).toBe('mismatch')
    expect(alpha.difference).toBe(60)
  })

  it('catches a row that was read twice', () => {
    const doubled = TWO_CARDS.flatMap((l) => (l.includes('EXAMPLE SHOP A') ? [l, l] : [l]))
    const alpha = parse(doubled).reconciliation[0]
    expect(alpha.status).toBe('mismatch')
    expect(alpha.difference).toBe(-40)
    expect(alpha.detail).toContain('extra in the rows')
  })
})

describe('other layouts', () => {
  it('reads a single card whose number is on an address-like line, with a Thai previous-balance label', () => {
    const lines = [
      'KRUNGTHAI CARD PUBLIC COMPANY LIMITED',
      '99/88 CARD NUMBER 4000-12XX-XXXX-4321 SHARE CREDIT LIMIT 300,000.00',
      'STATEMENT OF CREDIT CARD',
      'TRANS. DATE POSTING DATE DESCRIPTION AMOUNT (BAHT)',
      'ยอดเรียกเก็บรอบที่แล้ว 500.00',
      '29/04/26 29/04/26 Payment-XYZ Internet - 500.00',
      '24/04/26 24/04/26 EXAMPLE AUTOPAY BANGKOK TH 500.00',
      'สรุปยอดรอบนี้ MR. SOMEONE 500.00',
    ]
    const result = parse(lines)
    expect(result.reconciliation).toHaveLength(1)
    expect(result.reconciliation[0]).toMatchObject({ last4: '4321', status: 'verified', opening: 500, closing: 500 })
    expect(result.transactions[0].accountName).toBe('KTC ••4321')
  })

  it('accepts a statement with no printed previous balance only on the paid-in-full assumption', () => {
    const lines = [
      '3000 Phaholyothin RD., Chompon, Chatuchak Bangkok Phone: 0 2299 1111',
      'Card Statement  Card number 411111XXXXXX9876 Credit limit 500,000.00',
      'CARDHOLDER Statement date 14 Oct 26 Total amount due 300.00',
      'Transaction date Posted date Description Amount',
      '12 Oct 26 13 Oct 26 EXAMPLE SHOP BANGKOK TH 300.00 THB',
      '30 Sep 26 30 Sep 26 Payment via touch BANGKOK TH -200.00 THB',
    ]
    const [check] = parse(lines).reconciliation
    expect(check).toMatchObject({ last4: '9876', status: 'assumed', closing: 300 })
    expect(check.detail).toContain('exactly what was paid')
  })

  it('does no card checking for an account statement, and gives its rows no card', () => {
    const lines = [
      'SAVINGS ACCOUNT  WITHDRAWAL DEPOSIT',
      'วันที่ รายการ ถอนเงิน ฝากเงิน ยอดคงเหลือ',
      '01-10-26 ยอดยกมา 1,000.00',
      '02-10-26 ถอนเงิน 100.00 900.00',
      '03-10-26 ฝากเงิน 50.00 950.00',
    ]
    const result = parse(lines)
    expect(result.kind).toBe('account')
    expect(result.reconciliation).toEqual([])
    expect(result.transactions.every((t) => t.account === undefined)).toBe(true)
  })
})

describe('helpers', () => {
  it('reads a balance and a CR marker', () => {
    expect(balanceOn('TOTAL BALANCE - SOME CARD 1,263.00 CR')).toBe(-1263)
    expect(balanceOn('PREVIOUS BALANCE 1,475.00')).toBe(1475)
    expect(balanceOn('no money here')).toBeUndefined()
  })

  it('finds the last four digits in the shapes issuers mask them', () => {
    expect(cardLast4('4300 56XX XXXX 5678 NAME')).toBe('5678')
    expect(cardLast4('CARD NUMBER 4000-12XX-XXXX-4321')).toBe('4321')
    expect(cardLast4('Card number 411111XXXXXX9876 Credit limit')).toBe('9876')
    expect(cardLast4('an ordinary line with 12345678')).toBeUndefined()
  })

  it('treats a sub-satang difference as adding up', () => {
    expect(reconcile({ opening: 10, closing: 20.004 }, 10).status).toBe('verified')
    expect(reconcile({ opening: 10, closing: 20.5 }, 10).status).toBe('mismatch')
  })
})
