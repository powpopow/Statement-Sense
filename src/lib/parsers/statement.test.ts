import { describe, expect, it } from 'vitest'
import { parseStatement } from './statement'
import { parseOrders } from './orders'
import { parseThaiDate, toGregorianYear } from '../thaiDate'
import { parseAmountToken, findAmounts } from '../money'
import { categorizeOne, defaultRules } from '../categorize'
import { findMatches } from '../matching'
import type { Order, Transaction } from '../types'

describe('Thai dates', () => {
  it('converts Buddhist Era years to CE', () => {
    expect(toGregorianYear(2568)).toBe(2025)
    expect(toGregorianYear(2025)).toBe(2025)
  })

  it('reads the numeric formats Thai banks print', () => {
    expect(parseThaiDate('15/03/2568')).toBe('2025-03-15')
    expect(parseThaiDate('15-03-68')).toBe('2025-03-15')
    expect(parseThaiDate('2568-03-15')).toBe('2025-03-15')
  })

  it('reads Thai month abbreviations', () => {
    expect(parseThaiDate('15 มี.ค. 2568')).toBe('2025-03-15')
    expect(parseThaiDate('1 ธ.ค. 2567')).toBe('2024-12-01')
  })

  it('reads English months and falls back to the statement year', () => {
    expect(parseThaiDate('15 Mar 2025')).toBe('2025-03-15')
    expect(parseThaiDate('15/03', 2025)).toBe('2025-03-15')
  })

  it('folds Thai digits to ASCII', () => {
    expect(parseThaiDate('๑๕/๐๓/๒๕๖๘')).toBe('2025-03-15')
  })

  it('rejects impossible dates rather than guessing', () => {
    expect(parseThaiDate('32/13/2568')).toBeNull()
    expect(parseThaiDate('no date here')).toBeNull()
  })
})

describe('amounts', () => {
  it('handles both decimal conventions and credit notation', () => {
    expect(parseAmountToken('1,234.56')).toBe(1234.56)
    expect(parseAmountToken('1.234,56')).toBe(1234.56)
    expect(parseAmountToken('(1,234.56)')).toBe(-1234.56)
    expect(parseAmountToken('1,234.56-')).toBe(-1234.56)
  })

  it('finds every money column on a row', () => {
    const amounts = findAmounts('15/03/68 7-ELEVEN SUKHUMVIT 125.00 12,450.75')
    expect(amounts.map((a) => a.value)).toEqual([125, 12450.75])
  })

  it('does not swallow a branch number into the amount beside it', () => {
    const amounts = findAmounts('03/03/2568 7-ELEVEN SUKHUMVIT 55 125.00 64,875.00')
    expect(amounts.map((a) => a.value)).toEqual([125, 64875])
  })
})

/**
 * A savings-account statement with a running balance column. The parser should
 * sign each row from the balance movement, not from the column position.
 */
const ACCOUNT_STATEMENT = [
  'ธนาคารกสิกรไทย KASIKORNBANK',
  'รายการเดินบัญชี เลขที่บัญชี xxx-x-x1234-5',
  'วันที่ รายละเอียด ถอนเงิน ฝากเงิน ยอดคงเหลือ',
  'ยอดยกมา 20,000.00',
  '01/03/2568 เงินเดือน SALARY 45,000.00 65,000.00',
  '03/03/2568 7-ELEVEN SUKHUMVIT 125.00 64,875.00',
  '05/03/2568 GRABCAR BANGKOK 220.50 64,654.50',
  '08/03/2568 SHOPEE THAILAND 1,450.00 63,204.50',
  '12/03/2568 ATM ถอนเงิน CDM 2,000.00 61,204.50',
  '15/03/2568 CAFE AMAZON PTT 85.00 61,119.50',
]

describe('account statement parsing', () => {
  const result = parseStatement([ACCOUNT_STATEMENT], 'kbank.pdf', 'test')

  it('identifies the bank', () => {
    expect(result.detectedFormat).toContain('Kasikornbank')
  })

  it('reads every transaction row and skips the brought-forward line', () => {
    expect(result.transactions).toHaveLength(6)
  })

  it('signs money in as negative and money out as positive', () => {
    const byDescription = (needle: string) =>
      result.transactions.find((t) => t.description.includes(needle))!

    expect(byDescription('SALARY').amount).toBe(-45000)
    expect(byDescription('7-ELEVEN').amount).toBe(125)
    expect(byDescription('GRABCAR').amount).toBe(220.5)
    expect(byDescription('SHOPEE').amount).toBe(1450)
    expect(byDescription('CAFE AMAZON').amount).toBe(85)
  })

  it('converts Buddhist Era dates on every row', () => {
    expect(result.transactions.every((t) => t.date.startsWith('2025-03'))).toBe(true)
  })

  it('strips the amounts out of the description', () => {
    const seven = result.transactions.find((t) => t.description.includes('7-ELEVEN'))!
    expect(seven.description).not.toContain('125.00')
    expect(seven.description).not.toContain('64,875')
  })
})

/**
 * A short statement. Too few rows to infer a balance column from consecutive
 * deltas alone, so the brought-forward line has to carry the detection — or
 * every amount comes back as the running balance.
 */
const SHORT_STATEMENT = [
  'KASIKORNBANK PUBLIC COMPANY LIMITED',
  'รายการเดินบัญชี เลขที่บัญชี xxx-x-x1234-5',
  'BALANCE BROUGHT FORWARD 20,000.00',
  '01/03/2568 SALARY TRANSFER COMPANY LTD 45,000.00 65,000.00',
  '03/03/2568 7-ELEVEN SUKHUMVIT 55 125.00 64,875.00',
  '05/03/2568 GRABCAR BANGKOK TRIP 220.50 64,654.50',
]

describe('short statement parsing', () => {
  const result = parseStatement([SHORT_STATEMENT], 'short.pdf', 'test')

  it('reads the transaction amount, not the running balance', () => {
    const byDescription = (needle: string) =>
      result.transactions.find((t) => t.description.includes(needle))!

    expect(byDescription('7-ELEVEN').amount).toBe(125)
    expect(byDescription('GRABCAR').amount).toBe(220.5)
    expect(byDescription('SALARY').amount).toBe(-45000)
  })

  it('finds all three rows', () => {
    expect(result.transactions).toHaveLength(3)
  })
})

/** A credit card statement: no balance column, amounts in the last position. */
const CARD_STATEMENT = [
  'ธนาคารไทยพาณิชย์ SIAM COMMERCIAL BANK',
  'CREDIT CARD STATEMENT  Card Number xxxx-xxxx-xxxx-1234',
  'Statement Date 25 Mar 2025   Payment Due 10 Apr 2025   Credit Limit 150,000.00',
  'Transaction Date  Posting Date  Description  Amount',
  '02/03 04/03 LAZADA THAILAND BANGKOK 2,340.00',
  '05/03 06/03 NETFLIX.COM 419.00',
  '09/03 11/03 BTS SKYTRAIN 62.00',
  '14/03 16/03 BIG C SUPERCENTER 1,205.50',
  '18/03 20/03 PAYMENT RECEIVED - THANK YOU 5,000.00',
]

describe('credit card statement parsing', () => {
  const result = parseStatement([CARD_STATEMENT], 'scb-card.pdf', 'test')

  it('identifies the bank and the statement kind', () => {
    expect(result.detectedFormat).toContain('Siam Commercial')
    expect(result.kind).toBe('card')
  })

  it('reads the charge rows', () => {
    const lazada = result.transactions.find((t) => t.description.includes('LAZADA'))!
    expect(lazada.amount).toBe(2340)
    expect(lazada.date).toBe('2025-03-02')
  })

  it('treats a payment received as money in', () => {
    const payment = result.transactions.find((t) => t.description.includes('PAYMENT RECEIVED'))!
    expect(payment.amount).toBe(-5000)
  })
})

/**
 * A KBank credit card statement, in the two-page shape the real PDF has.
 *
 * Page 1 is the statement itself. Page 2 is the terms page, which carries a
 * worked EXAMPLE of a month's spending used to explain interest — invented
 * rows that read exactly like transactions, including their own date columns
 * and an interest-calculation table.
 */
const KBANK_STATEMENT_PAGE = [
  'CREDIT CARD STATEMENT / RECEIPT 1000000049504630',
  'บมจ. ธนาคารกสิกรไทย สำนักงานใหญ่',
  'วันที่สรุปยอด STATEMENT DATE 17/10/2026',
  'TRANS DATE POSTING DATE DESCRIPTION AMOUNT (BAHT)',
  'PREVIOUS BALANCE 139.00',
  '22/09/26 23/09/26 SHOPEEFOOD BANGKOK 60.00',
  '24/09/26 25/09/26 SHOPEEFOOD BANGKOK 55.00',
  '30/09/26 30/09/26 PAYMENT - THANK YOU - MOB 11608 -139.00',
  '***** TOTAL BALANCE ***** 115.00',
]

const KBANK_TERMS_PAGE = [
  'วิธีการชำระเงิน วิธีการชำระเงินและตัวอย่างการคำนวณดอกเบี้ย',
  'Methods of Payment and Example of Interest Calculation',
  'ตัวอย่างใบแจ้งยอดบัญชีบัตรเครดิตประจำเดือน สิงหาคม 2569',
  '01/08/2026 01/08/2026 CASH ADVANCE - ATM 4,000.00',
  '01/08/2026 01/08/2026 CASH ADVANCE FEE 100.00',
  '01/08/2026 01/08/2026 VAT 7% ON CASH ADVANCE FEE 7.00',
  '02/08/2026 03/08/2026 RIVERSIDE HOTEL 5,000.00',
  '10/08/2026 INTEREST CHARGE 17.53',
  '***TOTAL BALANCE*** 9,124.53',
  '11/08/2026 24/08/202614 4,000.00 24.55',
  '03/08/2026 24/08/202622 5,000.00 48.22',
]

describe('KBank credit card statement', () => {
  const result = parseStatement([KBANK_STATEMENT_PAGE, KBANK_TERMS_PAGE], 'kbgc.pdf', 'test')

  it('identifies the bank and statement kind', () => {
    expect(result.detectedFormat).toContain('Kasikornbank')
    expect(result.kind).toBe('card')
  })

  it("never imports the bank's worked example as spending", () => {
    // These are illustrative figures printed on every statement. Treating them
    // as real inflated this statement's spend from 115 to over 9,000.
    const descriptions = result.transactions.map((t) => t.description).join(' | ')
    expect(descriptions).not.toContain('RIVERSIDE HOTEL')
    expect(descriptions).not.toContain('CASH ADVANCE')
    expect(result.transactions.some((t) => t.amount === 5000 || t.amount === 4000)).toBe(false)
  })

  it('says that it skipped the example, rather than silently dropping rows', () => {
    expect(result.warnings.join(' ')).toMatch(/example/i)
  })

  it('reads two-digit years as the present era, not 1983', () => {
    const shopee = result.transactions.filter((t) => t.description.includes('SHOPEEFOOD'))
    expect(shopee).toHaveLength(2)
    expect(shopee.map((t) => t.date).sort()).toEqual(['2026-09-22', '2026-09-24'])
  })

  it('strips the posting date out of the description', () => {
    const shopee = result.transactions.find((t) => t.description.includes('SHOPEEFOOD'))!
    expect(shopee.description).toBe('SHOPEEFOOD BANGKOK')
  })

  it('reads the real rows and nothing else', () => {
    expect(result.transactions).toHaveLength(3)
    const spend = result.transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
    expect(spend).toBe(115)
  })

  it('treats a card payment as money in', () => {
    const payment = result.transactions.find((t) => t.description.includes('THANK YOU'))!
    expect(payment.amount).toBe(-139)
  })
})

/**
 * A UOB credit card statement. Its rows carry a posting date AND a transaction
 * date, neither with a year — the year appears only in the header — and
 * credits are flagged with a trailing "CR".
 */
const UOB_CARD = [
  'ACCOUNT NUMBER 810-03101968809',
  'STATEMENT DATE 13 OCT 2026',
  'CREDIT CARD STATEMENT  UOB',
  'POST DATE TRANS DATE DESCRIPTION AMOUNT (THB)',
  'PREVIOUS BALANCE 1,475.00',
  '30 SEP 30 SEP PAYMENT THANK YOU - UOBT TMRW APP 1,475.00 CR',
  '15 SEP 14 SEP LINEPAY*LP_BTS BANGKOK 28.00',
  '28 SEP 26 SEP MRT-BEM Bangkok 34.00',
  '18 SEP 16 SEP 90GRAMS SILOM BANGKOK 1,925.00',
  '01 OCT 30 SEP Netflix.com Bangkok 419.00',
  'SUB TOTAL 2,406.00',
]

describe('UOB credit card statement', () => {
  const result = parseStatement([UOB_CARD], 'uob.pdf', 'test')
  const find = (needle: string) => result.transactions.find((t) => t.description.includes(needle))!

  it('identifies the bank', () => {
    expect(result.detectedFormat).toContain('UOB')
  })

  it('takes the year from the header when rows carry none', () => {
    // "15 SEP 14 SEP" previously read the next date's day as the year → 2014.
    expect(result.transactions.every((t) => t.date.startsWith('2026-'))).toBe(true)
  })

  it('reads UOB\'s POST DATE then TRANS DATE: date is the purchase, postedDate the posting', () => {
    expect(find('LINEPAY').date).toBe('2026-09-14')
    expect(find('LINEPAY').postedDate).toBe('2026-09-15')
  })

  it('keeps a purchase made on 30 Sep, posted 1 Oct, in September', () => {
    expect(find('Netflix').date).toBe('2026-09-30')
    expect(find('Netflix').postedDate).toBe('2026-10-01')
  })

  it('leaves postedDate off when both dates are the same day', () => {
    expect(find('PAYMENT').postedDate).toBeUndefined()
  })

  it('keeps a merchant name that opens with digits', () => {
    // "90GRAMS" has the shape of a day followed by a month.
    expect(find('GRAMS').description).toBe('90GRAMS SILOM BANGKOK')
    expect(find('GRAMS').amount).toBe(1925)
  })

  it('reads a CR suffix as money in, and keeps it out of the description', () => {
    expect(find('PAYMENT THANK YOU').amount).toBe(-1475)
    expect(find('PAYMENT THANK YOU').description).toBe('PAYMENT THANK YOU - UOBT TMRW APP')
  })

  it('strips both date columns from the description', () => {
    expect(find('MRT-BEM').description).toBe('MRT-BEM Bangkok')
  })
})

describe('acronym rules', () => {
  const rules = defaultRules()

  it('does not match a short acronym inside a longer word', () => {
    // "NT" (National Telecom) used to match PAYME*NT T*HANK YOU and, at a
    // higher priority than the payment rule, turn a card payment into income.
    expect(categorizeOne('PAYMENT THANK YOU - UOBT TMRW APP', -1475, rules)).toBe('Cash & Transfers')
    expect(categorizeOne('MEAL DEAL BANGKOK', 120, rules)).not.toBe('Bills & Utilities')
  })

  it('still matches an acronym separated by punctuation', () => {
    expect(categorizeOne('LINEPAY*LP_BTS BANGKOK', 28, rules)).toBe('Transport')
    expect(categorizeOne('MRT-BEM Bangkok', 34, rules)).toBe('Transport')
  })

  it('treats paying off a card as a transfer, not income', () => {
    expect(categorizeOne('PAYMENT - THANK YOU', -5000, rules)).toBe('Cash & Transfers')
  })
})

describe('categorisation', () => {
  const rules = defaultRules()

  it('maps Thai merchants to sensible categories', () => {
    expect(categorizeOne('7-ELEVEN SUKHUMVIT', 125, rules)).toBe('Groceries')
    expect(categorizeOne('GRABCAR BANGKOK', 220, rules)).toBe('Transport')
    expect(categorizeOne('CAFE AMAZON PTT', 85, rules)).toBe('Food & Drink')
    expect(categorizeOne('NETFLIX.COM', 419, rules)).toBe('Entertainment')
    expect(categorizeOne('SHOPEE THAILAND', 1450, rules)).toBe('Shopping')
    expect(categorizeOne('ATM ถอนเงิน CDM', 2000, rules)).toBe('Cash & Transfers')
  })

  it('lets specific intent beat generic banking verbs', () => {
    // "TRANSFER" and "BILL PAYMENT" are generic; salary and AIS are not.
    expect(categorizeOne('SALARY TRANSFER COMPANY LTD', -45000, rules)).toBe('Income')
    expect(categorizeOne('AIS MOBILE BILL PAYMENT', 799, rules)).toBe('Bills & Utilities')
  })

  it('treats money coming in at a merchant as a refund, not spending', () => {
    expect(categorizeOne('SHOPEE THAILAND', -1450, rules)).toBe('Income')
  })

  it('leaves unknown merchants alone', () => {
    expect(categorizeOne('SOME UNKNOWN SHOP 99', 100, rules)).toBe('Uncategorized')
  })
})

describe('order parsing', () => {
  const csv = [
    'Order ID,Order Date,Product Name,Total Amount',
    '240306ABCDEF,06/03/2568,Wireless Earbuds Pro,1450.00',
    '240325XYZ123,25/03/2568,Cotton T-Shirt Pack,890.00',
  ]

  it('reads a CSV export, converting Buddhist Era dates', () => {
    const { orders } = parseOrders(csv, 'shopee-orders.csv', 'test', true)
    expect(orders).toHaveLength(2)
    expect(orders[0]).toMatchObject({
      date: '2025-03-06',
      amount: 1450,
      orderRef: '240306ABCDEF',
      description: 'Wireless Earbuds Pro',
    })
  })

  it('takes the platform from the filename when the file does not name it', () => {
    expect(parseOrders(csv, 'shopee-orders.csv', 'test', true).orders[0].platform).toBe('Shopee')
    expect(parseOrders(csv, 'grab-export.csv', 'test', true).orders[0].platform).toBe('Grab')
  })

  const screenshot = [
    'Shopee',
    'Order ID: 240306ABCDEF',
    'TechShop TH',
    'Wireless Earbuds Pro',
    'Subtotal 1,500.00',
    'Discount 50.00',
    'Order Total 1,450.00',
    '06/03/2568',
  ]

  it('prefers the line labelled as the total over the subtotal', () => {
    const { orders } = parseOrders(screenshot, 'shot.png', 'test', false)
    expect(orders[0].amount).toBe(1450)
    expect(orders[0].platform).toBe('Shopee')
    expect(orders[0].date).toBe('2025-03-06')
  })

  it('describes the order by the item, not the order reference', () => {
    const { orders } = parseOrders(screenshot, 'shot.png', 'test', false)
    expect(orders[0].description).toBe('Wireless Earbuds Pro')
    expect(orders[0].orderRef).toBe('240306ABCDEF')
  })
})

describe('multi-order screenshots', () => {
  // A Shopee "My Purchases" list: several orders stacked in one image.
  const LIST = [
    'Shopee',
    'My Purchases',
    '240306ABCDEF',
    'TechShop TH',
    'Wireless Earbuds Pro',
    'Order Total ฿1,450.00',
    '240307GHIJKL',
    'HomeGoods BKK',
    'Ceramic Mug Set',
    'Order Total ฿320.00',
    '240309MNOPQR',
    'FashionHub',
    'Cotton T-Shirt Pack',
    'Order Total ฿890.00',
    '09/03/2568',
  ]

  it('reads one order per labelled total', () => {
    const { orders } = parseOrders(LIST, 'shopee-list.png', 'test', false)
    expect(orders).toHaveLength(3)
    expect(orders.map((o) => o.amount)).toEqual([1450, 320, 890])
  })

  it('keeps each order with its own shop and reference', () => {
    const { orders } = parseOrders(LIST, 'shopee-list.png', 'test', false)
    expect(orders[1].description).toBe('Ceramic Mug Set')
    expect(orders[1].orderRef).toBe('240307GHIJKL')
    expect(orders[2].orderRef).toBe('240309MNOPQR')
  })

  it('describes each order by its item, not the page header', () => {
    // The header is the longest descriptive line in the first block, so
    // picking by length labelled the first order "Shopee My Purchases".
    const withHeader = ['Shopee My Purchases', ...LIST.slice(2)]
    const { orders } = parseOrders(withHeader, 'shopee-list.png', 'test', false)
    expect(orders[0].description).toBe('Wireless Earbuds Pro')
  })

  it('says how many it found, so a miscount is visible', () => {
    const { warnings } = parseOrders(LIST, 'shopee-list.png', 'test', false)
    expect(warnings.join(' ')).toMatch(/3 orders/)
  })

  it('still reads a single-order receipt as one order', () => {
    const { orders } = parseOrders(
      ['Shopee', 'Order ID: 240306ABCDEF', 'Wireless Earbuds Pro', 'Subtotal 1,500.00', 'Order Total 1,450.00', '06/03/2568'],
      'receipt.png',
      'test',
      false,
    )
    expect(orders).toHaveLength(1)
    expect(orders[0].amount).toBe(1450)
  })

  it('gives every order a distinct id, so none are deduped away', () => {
    const { orders } = parseOrders(LIST, 'shopee-list.png', 'test', false)
    expect(new Set(orders.map((o) => o.id)).size).toBe(orders.length)
  })
})

describe('order matching', () => {
  const transaction = (over: Partial<Transaction>): Transaction => ({
    id: 't1',
    date: '2025-03-10',
    description: 'SHOPEE THAILAND',
    amount: 1450,
    currency: 'THB',
    category: 'Shopping',
    categoryLocked: false,
    source: 'test',
    sourceFile: 'test.pdf',
    confidence: 0.9,
    ...over,
  })

  const order = (over: Partial<Order>): Order => ({
    id: 'o1',
    platform: 'Shopee',
    date: '2025-03-08',
    description: 'Wireless earbuds',
    amount: 1450,
    currency: 'THB',
    sourceFile: 'shot.png',
    confidence: 0.9,
    ...over,
  })

  it('matches an exact amount posted a couple of days later', () => {
    const matches = findMatches([transaction({})], [order({})])
    expect(matches).toHaveLength(1)
    expect(matches[0].score).toBeGreaterThan(0.8)
  })

  it('does not match across a different amount', () => {
    expect(findMatches([transaction({})], [order({ amount: 900 })])).toHaveLength(0)
  })

  it('does not match a charge posted weeks later', () => {
    expect(findMatches([transaction({ date: '2025-04-20' })], [order({})])).toHaveLength(0)
  })

  it('never matches an order to money coming in', () => {
    expect(findMatches([transaction({ amount: -1450 })], [order({})])).toHaveLength(0)
  })

  it('assigns each transaction to at most one order', () => {
    const matches = findMatches(
      [transaction({ id: 't1' })],
      [order({ id: 'o1' }), order({ id: 'o2', description: 'Phone case' })],
    )
    expect(matches).toHaveLength(1)
  })
})
