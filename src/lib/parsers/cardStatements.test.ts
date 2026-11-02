/**
 * Regression tests for three bugs found by running real card statements.
 * The text below is invented; the real files stay out of the repository.
 */
import { describe, expect, it } from 'vitest'
import { findAmounts } from '../money'
import { detectStatement } from './banks'
import { parseStatement } from './statement'

const HEADER = 'TRANS DATE POSTING DATE DESCRIPTION AMOUNT (BAHT)'

describe('bank detection', () => {
  it('ignores the banks listed on a payment slip', () => {
    // A pay-in slip names every bank a customer can pay at. It said nothing
    // about who issued the statement.
    const lines = [
      'KRUNGTHAI CARD PUBLIC COMPANY LIMITED',
      'KTC PHONE 02 123 5000 www.ktc.co.th',
      'STATEMENT OF CREDIT CARD',
      HEADER,
      '24/04/26 24/04/26 EXAMPLE SHOP BANGKOK TH 100.00',
      'แบบฟอร์มการชำระเงิน (Pay-in Slip)',
      'Kasikornbank  SCB  Siam Commercial Bank  UOB  Bangkok Bank  ttb  Krungsri  Government Savings Bank',
    ]
    expect(detectStatement(lines).bank?.id).toBe('ktc')
  })

  it('recognises an issuer that never prints its own name, from its head-office address', () => {
    const lines = [
      '3000 Phaholyothin RD., Chompon, Chatuchak Bangkok, Thailand 10900 Phone: 0 2299 1111',
      'Card Statement (Billed: Oct 26)',
      'Transaction date Posted date Description Amount',
      '12 Oct 26 13 Oct 26 EXAMPLE SHOP BANGKOK TH 349.00 THB',
    ]
    expect(detectStatement(lines).bank?.id).toBe('ttb')
  })

  it('does not take another bank named inside a merchant row for the issuer', () => {
    const lines = [
      'KASIKORNBANK CREDIT CARD STATEMENT',
      HEADER,
      '30/09/26 30/09/26 PAYMENT-SCB(014) INTERNET -139.00',
    ]
    expect(detectStatement(lines).bank?.id).toBe('kbank')
  })

  it('keeps Krungthai Card and Krungthai Bank apart', () => {
    expect(detectStatement(['KRUNGTHAI CARD PUBLIC COMPANY LIMITED', 'STATEMENT OF CREDIT CARD']).bank?.id).toBe('ktc')
    expect(detectStatement(['KRUNGTHAI BANK PUBLIC COMPANY LIMITED', 'www.krungthai.com']).bank?.id).toBe('ktb')
  })
})

describe('a credit sign printed on its own', () => {
  it('reads "- 500.00" as a credit', () => {
    const [amount] = findAmounts('29/04/26 Payment-XYZ Internet - 500.00')
    expect(amount.value).toBe(-500)
    expect(amount.negativeNotation).toBe(true)
  })

  it('does not mistake a hyphen in the description for a sign', () => {
    expect(findAmounts('CB-055 WEEKEND SURPRISE 500.00')[0].value).toBe(500)
    expect(findAmounts('A - B SHOP 500.00')[0].value).toBe(500)
  })

  it('makes the row a credit and leaves the dash out of the description', () => {
    const result = parseStatement(
      [[HEADER, '29/04/26 29/04/26 Payment-XYZ Internet - 500.00', '24/04/26 24/04/26 EXAMPLE AUTOPAY BANGKOK TH 500.00']],
      'x.pdf',
      'x',
    )
    const payment = result.transactions.find((t) => t.description.startsWith('Payment'))!
    expect(payment.amount).toBe(-500)
    expect(payment.description).toBe('Payment-XYZ Internet')
    expect(result.transactions.find((t) => t.description.startsWith('EXAMPLE'))!.amount).toBe(500)
  })
})

describe('rows come only from the transactions table', () => {
  it('ignores a dated row in a credit-bureau table', () => {
    const result = parseStatement(
      [[
        HEADER,
        '24/04/26 24/04/26 EXAMPLE SHOP BANGKOK TH 100.00',
        'สรุปยอดรอบนี้ 100.00',
        'NCB REPORT DATE CREDIT LIMIT OUTSTANDING LAST PAYMENT DATE DEFAULT DATE',
        '30/04/26 300,000.00 100.00 29/04/26 - / OK',
      ]],
      'x.pdf',
      'x',
    )
    expect(result.transactions.map((t) => t.amount)).toEqual([100])
  })

  it('is not ended by a merchant whose name contains TOTAL', () => {
    const result = parseStatement(
      [[HEADER, '01/10/26 02/10/26 TOTAL ACCESS CO BANGKOK 200.00', '02/10/26 03/10/26 SECOND SHOP BANGKOK 50.00']],
      'x.pdf',
      'x',
    )
    expect(result.transactions.map((t) => t.amount)).toEqual([200, 50])
  })

  it('follows a second card section that has no column header of its own', () => {
    // Each card opens with "previous balance", not a repeated header.
    const result = parseStatement(
      [[
        HEADER,
        'PREVIOUS BALANCE 0.00',
        '01/10/26 01/10/26 SHOP A BANGKOK 10.00',
        'SUB TOTAL 10.00',
        'TOTAL BALANCE - CARD ONE 10.00',
        'CARD TWO 1234 56XX XXXX 7890',
        'PREVIOUS BALANCE 0.00',
        '02/10/26 02/10/26 SHOP B BANGKOK 20.00',
        'SUB TOTAL 20.00',
      ]],
      'x.pdf',
      'x',
    )
    expect(result.transactions.map((t) => t.amount)).toEqual([10, 20])
  })

  it('still reads a bare list of rows with no table header, as an OCR screenshot gives', () => {
    const result = parseStatement(
      [['15/03/26 SOME SHOP BANGKOK 100.00', '16/03/26 OTHER SHOP BANGKOK 200.00']],
      'x.pdf',
      'x',
    )
    expect(result.transactions).toHaveLength(2)
  })
})

describe('which date is the purchase', () => {
  const row = (header: string) =>
    parseStatement([[header, '22/09/26 23/09/26 EXAMPLE SHOP BANGKOK 60.00']], 'x.pdf', 'x').transactions[0]

  it('is the first date when the header says TRANS DATE first (KBank, ttb, KTC)', () => {
    const t = row('TRANS DATE POSTING DATE DESCRIPTION AMOUNT (BAHT)')
    expect(t.date).toBe('2026-09-22')
    expect(t.postedDate).toBe('2026-09-23')
  })

  it('is the second date when the header says POST DATE first (UOB)', () => {
    const t = row('POST DATE TRANS DATE DESCRIPTION AMOUNT (THB)')
    expect(t.date).toBe('2026-09-23')
    expect(t.postedDate).toBe('2026-09-22')
  })

  it('assumes the first date is the purchase when no header says otherwise', () => {
    const t = row('DATE DESCRIPTION AMOUNT')
    expect(t.date).toBe('2026-09-22')
    expect(t.postedDate).toBe('2026-09-23')
  })

  it('uses a lone date as both', () => {
    const [t] = parseStatement([['DATE DESCRIPTION AMOUNT', '22/09/26 EXAMPLE SHOP BANGKOK 60.00']], 'x.pdf', 'x').transactions
    expect(t.date).toBe('2026-09-22')
    expect(t.postedDate).toBeUndefined()
  })
})
