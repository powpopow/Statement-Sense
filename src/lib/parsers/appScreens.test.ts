import { describe, expect, it } from 'vitest'
import { detectPlatform, detectShape, parseOrders } from './orders'
import { findBahtAmounts, normalizeBahtSign } from '../money'

/**
 * Lines as they appear on a real Shopee "My Purchases" screen. Note what is
 * absent: the word "Shopee", and any order date.
 */
const SHOPEE_LIST = [
  'My Purchases',
  'To Ship', 'To Receive', 'Completed', 'Return/Refund', 'Cancel',
  'WhiteLab Essentials', 'Completed',
  'Whitelab Night Time Gummies Whitelab, A Vit...',
  'x1',
  '฿699 ฿279',
  'Total 1 item: ฿209',
  'Buy Again',
  'Buy again with special voucher at ฿239',
  '20% off Up to ฿200',
  'Min. Spend ฿200  T&C',
  'Mall VRH Modernlife', 'Completed',
  'VRH Tissue Holder NOVA 104 Satin Finish (Air...',
  'x3',
  '฿730 ฿219',
  'Total 3 items: ฿492',
  'Buy Again',
  'Mall American Standard Official Store', 'Completed',
  'American Standard Adjustable Rail Not Includi...',
  'x2',
  '฿1,630',
  'Total 2 items: ฿2,371',
]

/** Lines from Grab's Activity History — no totals, amounts beside merchants. */
const GRAB_ACTIVITY = [
  'Activity History',
  'Transport', 'Food', 'Mart', 'Dine Out', 'Finance',
  'Tiengna Viennoiserie -', 'ถนนสุขุมวิท 39', '฿370',
  '+337 GrabCoins',
  '7 Oct 2026, 11:19',
  'Reorder',
  'FitFish ปลาย่าง อาหารคลีน', '(Healthy Grilled Bento)...', '฿200',
  '+320 GrabCoins',
  '6 Oct 2026, 13:43',
  'Reorder',
  'AJA AJA healthy kitchen', '(อะจาอะจ้า ข้าวสุขภาพ) -...', '฿0',
  '5 Oct 2026, 12:39',
  'Reorder',
  'Fit2GO Fresh -', 'Sukhumvit 31', '฿120',
  '+12 GrabCoins',
  '2 Oct 2026, 13:14',
]

describe('baht amounts on app screens', () => {
  it('reads a bare integer when the baht sign marks it as money', () => {
    // findAmounts ignores these on purpose; a ฿ makes them unambiguous.
    expect(findBahtAmounts('฿370')).toEqual([370])
    expect(findBahtAmounts('Total 2 items: ฿2,371')).toEqual([2371])
    expect(findBahtAmounts('฿699 ฿279')).toEqual([699, 279])
  })

  it('recovers the baht sign that OCR turns into 8 or B', () => {
    // Observed on real screenshots: "฿701 ฿301" comes back as "[8701 B301".
    expect(normalizeBahtSign('[8701 B301')).toBe('[฿701 ฿301')
    expect(findBahtAmounts('Total 1 item: 8200.00')).toEqual([200])
    expect(findBahtAmounts('[8701 B301')).toEqual([701, 301])
  })

  it('still reads a genuine amount that begins with 8', () => {
    // A real ฿8,200 OCRs as "88,200" — only the leading sign is consumed.
    expect(findBahtAmounts('Total 1 item: 88,200.00')).toEqual([8200])
  })

  it('ignores numbers with no baht sign', () => {
    expect(findBahtAmounts('+337 GrabCoins')).toEqual([])
    expect(findBahtAmounts('x3')).toEqual([])
  })
})

describe('recognising the app screens', () => {
  it('identifies Shopee from its list furniture, with the brand name absent', () => {
    expect(SHOPEE_LIST.join('\n')).not.toMatch(/shopee/i)
    expect(detectPlatform(SHOPEE_LIST.join('\n'))).toBe('Shopee')
    expect(detectShape(SHOPEE_LIST.join('\n'), 'Shopee')).toBe('shopee-list')
  })

  it('identifies Grab from Activity History, not the word Grab', () => {
    expect(detectPlatform(GRAB_ACTIVITY.join('\n'))).toBe('Grab')
    expect(detectShape(GRAB_ACTIVITY.join('\n'), 'Grab')).toBe('grab-activity')
  })
})

describe('Shopee purchases list', () => {
  const { orders, warnings, detectedFormat } = parseOrders(SHOPEE_LIST, 'IMG_0561.png', 'test', false)

  it('splits one order per "Total … items" line', () => {
    expect(detectedFormat).toBe('Shopee purchases list')
    expect(orders).toHaveLength(3)
  })

  it('takes the charged total, not the unit price', () => {
    // ฿279 is the per-item price; ฿209 is what was actually paid.
    expect(orders.map((o) => o.amount)).toEqual([209, 492, 2371])
  })

  it('names each order by its shop and product', () => {
    expect(orders[0].description).toContain('WhiteLab Essentials')
    expect(orders[0].description).toContain('Night Time Gummies')
    expect(orders[1].description).toContain('VRH Modernlife')
  })

  it('leaves the date empty rather than inventing one', () => {
    // The list shows only "Rate by 19 Nov", which is a review deadline.
    expect(orders.every((o) => o.date === '')).toBe(true)
    expect(warnings.join(' ')).toMatch(/amount alone/i)
  })

  it('does not treat vouchers or discounts as orders', () => {
    expect(orders.some((o) => o.amount === 239 || o.amount === 200)).toBe(false)
  })
})

describe('Grab activity history', () => {
  const { orders, warnings } = parseOrders(GRAB_ACTIVITY, 'IMG_0560.png', 'test', false)

  it('reads one order per row that has a baht amount', () => {
    expect(orders.map((o) => o.amount)).toEqual([370, 200, 120])
  })

  it('reads the date under each row', () => {
    expect(orders[0].date).toBe('2026-10-07')
    expect(orders[2].date).toBe('2026-10-02')
  })

  it('joins a merchant name that wraps onto a second line', () => {
    expect(orders[0].description).toContain('Tiengna Viennoiserie')
    expect(orders[1].description).toContain('FitFish')
  })

  it('never reads GrabCoins as the amount', () => {
    expect(orders.some((o) => o.amount === 337 || o.amount === 320)).toBe(false)
  })

  it('skips ฿0 rows and says so', () => {
    expect(orders.some((o) => o.description.includes('AJA AJA'))).toBe(false)
    expect(warnings.join(' ')).toMatch(/฿0/)
  })
})
