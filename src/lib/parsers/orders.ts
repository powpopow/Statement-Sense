/**
 * Parsing marketplace orders (Shopee, Grab, Lazada, LINE MAN, Foodpanda).
 *
 * These arrive as app screenshots far more often than as clean exports, so the
 * parser works from loose OCR lines: find the money, find the nearest date, and
 * take the surrounding text as the item description.
 */
import { findAmounts, findBahtAmounts, parseAmountToken } from '../money'
import { parseThaiDate, findStatementYear, normalizeThaiDigits } from '../thaiDate'
import type { Order } from '../types'

type Platform = Order['platform']

/**
 * Platform signatures.
 *
 * The brand name is the obvious signal and the least reliable one: a Shopee
 * "My Purchases" screenshot never writes "Shopee" anywhere, and Grab's
 * Activity History never writes "Grab" except inside "GrabCoins". So each
 * platform is also identified by the furniture of its own screens.
 */
const PLATFORM_SIGNATURES: [Platform, RegExp][] = [
  [
    'Shopee',
    new RegExp(
      [
        'shopee', 'ช้อปปี้', 'shopeepay', 'shopeefood', '\\bspx\\b',
        // The My Purchases list: tab bar, per-order status and actions.
        'my purchases', 'การซื้อของฉัน',
        'to ship', 'to receive', 'to pay', 'buy again', 'ซื้ออีกครั้ง',
        'return/refund', 'preferred\\+?', '\\bmall\\b',
        // Not a bare "coins": Grab writes "GrabCoins" on every row.
        'rate by .{0,16} to earn',
      ].join('|'),
      'i',
    ),
  ],
  [
    'Grab',
    new RegExp(
      [
        '\\bgrab\\b', 'grabfood', 'grabmart', 'grabcar', 'grabbike', 'grabpay',
        'grabcoins', 'แกร็บ',
        // Activity History: the filter chips and per-row actions.
        'activity history', 'reorder', 'rebook', 'save group', 'group order by',
        'rate & tip', 'driver cancelled',
      ].join('|'),
      'i',
    ),
  ],
  ['Lazada', /lazada|ลาซาด้า|lazadapay/i],
  ['LINE MAN', /line\s*man|lineman|ไลน์แมน|wongnai/i],
  ['Foodpanda', /foodpanda|food\s*panda|ฟู้ดแพนด้า/i],
]

export function detectPlatform(text: string): Platform {
  for (const [platform, re] of PLATFORM_SIGNATURES) {
    if (re.test(text)) return platform
  }
  return 'Other'
}

/**
 * Which app screen this is, when we can tell. The two list views need their
 * own row-splitting rules, and neither looks like a receipt.
 */
export type ScreenshotShape = 'shopee-list' | 'grab-activity' | 'receipt'

export function detectShape(text: string, platform: Platform): ScreenshotShape {
  if (platform === 'Grab' && /activity history|reorder|rebook|grabcoins/i.test(text)) {
    return 'grab-activity'
  }
  if (platform === 'Shopee' && /my purchases|buy again|to ship|to receive|การซื้อของฉัน/i.test(text)) {
    return 'shopee-list'
  }
  return 'receipt'
}

/** Order reference formats the apps show on receipts and order detail pages. */
const ORDER_REF_RE =
  /(?:order\s*(?:id|no\.?|number)|เลขที่คำสั่งซื้อ|รหัสคำสั่งซื้อ|booking\s*code)\s*[:#]?\s*([A-Z0-9-]{6,})/i

/**
 * A reference standing on its own line, as the order list shows it without a
 * label. Requiring both letters and digits, and the whole line, keeps this
 * from swallowing prices, dates or shop names.
 */
const BARE_REF_RE = /^([A-Z0-9]{8,24})$/

function findOrderRef(block: string[]): string | undefined {
  const labelled = block.join('\n').match(ORDER_REF_RE)?.[1]
  if (labelled) return labelled

  for (const line of block) {
    const match = line.trim().match(BARE_REF_RE)
    const token = match?.[1]
    if (token && /[A-Z]/.test(token) && /\d/.test(token)) return token
  }
  return undefined
}

/** Lines that carry the order total rather than a subtotal or a discount. */
const TOTAL_RE =
  /total|amount\s*paid|grand\s*total|order\s*total|ยอดรวม|ยอดชำระ|รวมทั้งสิ้น|ยอดสุทธิ|ชำระแล้ว/i

/** Lines whose amounts are never the order total. */
const NON_TOTAL_RE =
  /subtotal|shipping|delivery\s*fee|discount|voucher|coupon|refund|cashback|point|ค่าจัดส่ง|ส่วนลด|คูปอง|แต้ม|ค่าบริการ/i

export interface OrderParseOutput {
  orders: Order[]
  warnings: string[]
  detectedFormat: string
}

/** Parse a delimited export (Shopee and Lazada both offer CSV downloads). */
function parseCsv(text: string, sourceFile: string, idPrefix: string): OrderParseOutput {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, '').trim()))

  if (rows.length < 2) return { orders: [], warnings: ['CSV had no data rows.'], detectedFormat: 'CSV' }

  const header = rows[0].map((h) => h.toLowerCase())
  const find = (...names: string[]) =>
    header.findIndex((h) => names.some((n) => h.includes(n)))

  const dateIdx = find('date', 'time', 'วันที่')
  const amountIdx = find('total', 'amount', 'paid', 'ยอด', 'ราคา')
  const descIdx = find('product', 'item', 'name', 'shop', 'merchant', 'description', 'สินค้า', 'ร้าน')
  const refIdx = find('order id', 'order no', 'order number', 'เลขที่')

  if (dateIdx === -1 || amountIdx === -1) {
    return {
      orders: [],
      warnings: ['Could not find date and amount columns in the CSV header.'],
      detectedFormat: 'CSV',
    }
  }

  // A CSV export rarely names its platform inside the file, but the download
  // filename almost always does, so both are searched.
  const platform = detectPlatform(`${sourceFile}\n${text}`)
  const year = findStatementYear(text)
  const orders: Order[] = []

  rows.slice(1).forEach((cells, i) => {
    const date = parseThaiDate(cells[dateIdx] ?? '', year)
    const amounts = findAmounts(cells[amountIdx] ?? '')
    if (!date || !amounts.length) return
    orders.push({
      id: `${idPrefix}-o${i}`,
      platform,
      date,
      orderRef: refIdx !== -1 ? cells[refIdx] : undefined,
      description: (descIdx !== -1 ? cells[descIdx] : '') || `${platform} order`,
      amount: Math.abs(amounts[0].value),
      currency: 'THB',
      sourceFile,
      confidence: 0.95,
    })
  })

  return {
    orders,
    warnings: orders.length ? [] : ['No rows in the CSV produced a usable date and amount.'],
    detectedFormat: `${platform} CSV export`,
  }
}

/** Buttons, badges and promos that are chrome rather than order content. */
const CHROME_RE = new RegExp(
  [
    'buy again', 'contact seller', 'return/refund', 'rate\\b', 'reorder', 'rebook',
    'save group', 'rate & tip', 'view more', 'see all', 'see original',
    'my purchases', 'activity history', 'to ship', 'to receive', 'to pay',
    'completed', '\\bcancel', 'driver cancelled', 'pre-order',
    'you may also like', 'review and earn', 'buy again with',
    'min\\. spend', 't&c', 'flash sale', 'sold\\b', 'grabcoins', 'coins\\b',
    // Promo strips sit between one order card and the next.
    '%\\s*off', 'off up to', 'drop from', 'cheap on shopee',
    'transport', 'food', 'mart', 'dine out', 'finance',
    'ซื้ออีกครั้ง', 'การซื้อของฉัน',
  ].join('|'),
  'i',
)

/**
 * Seller badges printed before the shop name. They are not part of the name,
 * but the line is, so they are stripped rather than filtered out — dropping
 * the line would lose "Mall VRH Modernlife" entirely.
 */
const BADGE_RE = /^(?:mall|preferred\+?|fulfilled|live|official)\s+/i

function stripBadges(line: string): string {
  let out = line.trim()
  for (let i = 0; i < 3 && BADGE_RE.test(out); i++) out = out.replace(BADGE_RE, '').trim()
  return out
}

/** A Grab row's date line, e.g. "7 Oct 2026, 11:19". */
const GRAB_DATE_RE = /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/

/**
 * Shopee's "My Purchases" list.
 *
 * Each order card ends with "Total N items: ฿X" — the figure actually charged,
 * after discounts — so that line closes a block. The shop name opens the card
 * and the product name sits just above the total.
 *
 * These cards carry no order date: "Rate by 19 Nov" is a review deadline, and
 * reading it as the purchase date would be worse than having none.
 */
function parseShopeeList(
  lines: string[],
  sourceFile: string,
  idPrefix: string,
): OrderParseOutput | null {
  const orders: Order[] = []
  const warnings: string[] = []
  let blockStart = 0

  lines.forEach((line, index) => {
    if (!/total\s*\d*\s*items?\s*:/i.test(line)) return

    // The line is already known to be a total, so fall back progressively:
    // OCR drops the baht sign as often as it mangles it, and without this a
    // readable row is silently skipped.
    const amounts =
      findBahtAmounts(line).length > 0
        ? findBahtAmounts(line)
        : findAmounts(line).map((a) => Math.abs(a.value)).length > 0
          ? findAmounts(line).map((a) => Math.abs(a.value))
          : [...line.matchAll(/[:：]\s*([\d.,]+)/g)]
              .map((m) => parseAmountToken(m[1]))
              .filter((v): v is number => v !== null && v > 0)

    if (!amounts.length) return

    const block = lines.slice(blockStart, index)
    blockStart = index + 1

    const content = block
      .map(stripBadges)
      .filter((l) => isDescriptive(l) && !CHROME_RE.test(l))

    // Count back from the total rather than forward from the start: a block
    // begins wherever the previous card ended, so promo strips and leftovers
    // sit at the top, while shop and product are always the last two lines.
    const product = content[content.length - 1]
    const shop = content.length > 1 ? content[content.length - 2] : undefined

    orders.push({
      id: `${idPrefix}-o${orders.length}`,
      platform: 'Shopee',
      // Empty means unknown: the matcher then pairs on amount alone.
      date: '',
      description: [shop, product].filter(Boolean).join(' — ').slice(0, 120) || 'Shopee order',
      amount: amounts[amounts.length - 1],
      currency: 'THB',
      sourceFile,
      confidence: product ? 0.75 : 0.6,
    })
  })

  // Not this layout after all — let the generic receipt path try.
  if (!orders.length) return null

  warnings.push(
    `Read ${orders.length} order${orders.length === 1 ? '' : 's'} from this list. Shopee does not show order dates here, so matching will go on amount alone.`,
  )
  return { orders, warnings, detectedFormat: 'Shopee purchases list' }
}

/**
 * Grab's "Activity History".
 *
 * Rows have no total label at all — a merchant with "฿370" beside it, then a
 * date line underneath. Merchant names wrap onto a second line, and a row's
 * GrabCoins line must not be mistaken for the amount.
 */
function parseGrabActivity(
  lines: string[],
  sourceFile: string,
  idPrefix: string,
): OrderParseOutput | null {
  const orders: Order[] = []
  const warnings: string[] = []
  let free = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/grabcoins/i.test(line)) continue
    const amounts = findBahtAmounts(line)
    if (!amounts.length) continue

    const amount = amounts[amounts.length - 1]
    // ฿0 rows are group orders someone else paid for.
    if (amount <= 0) {
      free++
      continue
    }

    let merchant = line.replace(/฿\s*[\d.,]+/g, ' ').replace(/\s+/g, ' ').trim()

    // The amount is right-aligned, so OCR often emits it on a line of its own
    // with the merchant immediately above. Walk back for the name, stopping at
    // whatever ends the previous row.
    if (merchant.length < 3) {
      const above: string[] = []
      for (let j = i - 1; j >= 0 && above.length < 3; j--) {
        const previous = lines[j]
        if (GRAB_DATE_RE.test(previous) || findBahtAmounts(previous).length) break
        if (/grabcoins/i.test(previous) || CHROME_RE.test(previous)) continue
        if (isDescriptive(previous)) above.unshift(previous)
      }
      merchant = above.join(' ').trim()
    }

    // Then forward for any wrapped remainder and the row's date.
    let date: string | null = null
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const next = lines[j]
      if (findBahtAmounts(next).length && !/grabcoins/i.test(next)) break
      if (GRAB_DATE_RE.test(next)) {
        date = parseThaiDate(next)
        break
      }
      if (/grabcoins/i.test(next) || CHROME_RE.test(next)) continue
      if (isDescriptive(next) && merchant.length < 80) merchant = `${merchant} ${next}`.trim()
    }

    if (!merchant || !/[A-Za-z฀-๿]{2}/.test(merchant)) continue

    orders.push({
      id: `${idPrefix}-o${orders.length}`,
      platform: 'Grab',
      date: date ?? '',
      description: merchant.slice(0, 120),
      amount,
      currency: 'THB',
      sourceFile,
      confidence: date ? 0.8 : 0.6,
    })
  }

  if (!orders.length) return null

  warnings.push(`Read ${orders.length} order${orders.length === 1 ? '' : 's'} from this activity list.`)
  if (free) {
    warnings.push(`Skipped ${free} row${free === 1 ? '' : 's'} showing ฿0 — group orders someone else paid for.`)
  }
  return { orders, warnings, detectedFormat: 'Grab activity history' }
}

/** Is this line usable as a merchant or item description? */
function isDescriptive(line: string): boolean {
  const trimmed = line.trim()
  return (
    !TOTAL_RE.test(trimmed) &&
    !NON_TOTAL_RE.test(trimmed) &&
    !ORDER_REF_RE.test(trimmed) &&
    !BARE_REF_RE.test(trimmed) &&
    !/^\W*[\d,.\s฿]+\W*$/.test(trimmed) &&
    // Needs some letters; an OCR'd divider or code is not a description.
    /[A-Za-z฀-๿]{3}/.test(trimmed)
  )
}

/**
 * The item name sits immediately above the total in both receipt and list
 * layouts, so the last descriptive line of a block beats the longest — which
 * on a list screenshot picks up the page header instead of the first item.
 */
function describeBlock(block: string[]): string {
  const descriptive = block.filter(isDescriptive)
  return descriptive.length ? descriptive[descriptive.length - 1] : ''
}

/**
 * Parse OCR'd screenshot text, where layout is unreliable.
 *
 * A screenshot may hold one order (a receipt) or several (the order list), so
 * every line labelled as a total starts a new order, and the surrounding lines
 * are searched backwards for that order's own shop name, reference and date.
 */
function parseScreenshot(lines: string[], sourceFile: string, idPrefix: string): OrderParseOutput {
  const text = lines.join('\n')
  const platform = detectPlatform(`${sourceFile}\n${text}`)

  // The two list views are laid out nothing like a receipt and need their own
  // row splitting; everything else falls through to the generic path below.
  const shape = detectShape(text, platform)
  if (shape === 'shopee-list') {
    const result = parseShopeeList(lines, sourceFile, idPrefix)
    if (result) return result
  }
  if (shape === 'grab-activity') {
    const result = parseGrabActivity(lines, sourceFile, idPrefix)
    if (result) return result
  }

  const year = findStatementYear(text)
  const warnings: string[] = []
  const today = new Date().toISOString().slice(0, 10)

  /** A date anywhere in the screenshot, used when an order block has none. */
  let fallbackDate: string | null = null
  for (const line of lines) {
    const d = parseThaiDate(normalizeThaiDigits(line), year)
    if (d) {
      fallbackDate = d
      break
    }
  }

  // Each labelled total marks the end of one order block.
  const totalIndexes = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => TOTAL_RE.test(line) && !NON_TOTAL_RE.test(line) && findAmounts(line).length)
    .map(({ i }) => i)

  if (!totalIndexes.length) {
    // No label to go on: treat the whole image as one order and take the
    // largest amount, which on a receipt is the total often enough.
    const amounts = lines
      .filter((l) => !NON_TOTAL_RE.test(l))
      .flatMap((line) => findAmounts(line).map((a) => Math.abs(a.value)))
      .filter((v) => v > 0)

    if (!amounts.length) {
      return {
        orders: [],
        warnings: ['No amount found in the screenshot. Try a clearer crop that includes the order total.'],
        detectedFormat: `${platform} screenshot`,
      }
    }

    warnings.push('No line was labelled as the order total, so the largest amount on the screenshot was used.')
    if (!fallbackDate) warnings.push('No date was readable; the order was dated today. Edit it if that is wrong.')

    const description = lines.filter(isDescriptive).sort((a, b) => b.length - a.length)[0] ?? ''
    return {
      orders: [
        {
          id: `${idPrefix}-o0`,
          platform,
          date: fallbackDate ?? today,
          orderRef: findOrderRef(lines),
          description: description.slice(0, 120) || `${platform} order`,
          amount: Math.max(...amounts),
          currency: 'THB',
          sourceFile,
          confidence: 0.5,
        },
      ],
      warnings,
      detectedFormat: `${platform} screenshot`,
    }
  }

  const orders: Order[] = []
  let blockStart = 0

  totalIndexes.forEach((totalIndex, n) => {
    const block = lines.slice(blockStart, totalIndex + 1)
    const amounts = findAmounts(lines[totalIndex]).map((a) => Math.abs(a.value)).filter((v) => v > 0)
    blockStart = totalIndex + 1
    if (!amounts.length) return

    // Within a block, prefer the block's own date and reference; fall back to
    // the screenshot's when the list view shows them only once.
    let blockDate: string | null = null
    for (const line of block) {
      const d = parseThaiDate(normalizeThaiDigits(line), year)
      if (d) blockDate = d
    }
    const blockRef = findOrderRef(block)
    const description = describeBlock(block)

    orders.push({
      id: `${idPrefix}-o${n}`,
      platform,
      date: blockDate ?? fallbackDate ?? today,
      orderRef: blockRef ?? (totalIndexes.length === 1 ? findOrderRef(lines) : undefined),
      description: description.slice(0, 120) || `${platform} order`,
      // The last amount on a total line is the figure after the label.
      amount: amounts[amounts.length - 1],
      currency: 'THB',
      sourceFile,
      confidence: blockDate ?? fallbackDate ? 0.8 : 0.5,
    })
  })

  if (orders.length > 1) {
    warnings.push(`Read ${orders.length} orders from this screenshot. Check the amounts against the app.`)
  }
  if (!fallbackDate && orders.some((o) => o.date === today)) {
    warnings.push('No date was readable; those orders were dated today. Edit them if that is wrong.')
  }

  return { orders, warnings, detectedFormat: `${platform} screenshot` }
}

export function parseOrders(
  lines: string[],
  sourceFile: string,
  idPrefix: string,
  isCsv: boolean,
): OrderParseOutput {
  return isCsv
    ? parseCsv(lines.join('\n'), sourceFile, idPrefix)
    : parseScreenshot(lines, sourceFile, idPrefix)
}
