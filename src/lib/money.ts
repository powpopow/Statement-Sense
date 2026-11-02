import { normalizeThaiDigits } from './thaiDate'

/**
 * Amounts in a statement line, e.g. "1,234.56" or "(1,234.56)" or "1.234,56".
 *
 * Whitespace is deliberately not accepted as a thousands separator: branch
 * names carry numbers ("SUKHUMVIT 55 125.00"), and allowing a space there
 * swallows the branch number into the amount.
 */
const AMOUNT_RE = /\(?-?(?:\d{1,3}(?:[,.]\d{3})+|\d+)(?:[.,]\d{1,2})?\)?-?/g

export interface ParsedAmount {
  value: number
  /** Where it sat in the source string, used to pick the right column. */
  index: number
  length: number
  /** True when written as (1,234.56) or with a trailing minus — a credit. */
  negativeNotation: boolean
}

/**
 * Convert one amount token to a number. Handles both 1,234.56 and 1.234,56
 * by assuming the *last* separator with 1-2 trailing digits is the decimal.
 */
export function parseAmountToken(token: string): number | null {
  let t = normalizeThaiDigits(token).trim()
  const parenthesised = /^\(.*\)$/.test(t)
  const trailingMinus = /-$/.test(t)
  t = t.replace(/[()]/g, '').replace(/-$/, '').trim()
  const leadingMinus = t.startsWith('-')
  t = t.replace(/^-/, '')

  if (!/\d/.test(t)) return null

  const lastComma = t.lastIndexOf(',')
  const lastDot = t.lastIndexOf('.')
  const sep = Math.max(lastComma, lastDot)
  let normalized: string
  if (sep !== -1 && t.length - sep - 1 <= 2 && t.length - sep - 1 >= 1) {
    // Treat the final separator as the decimal point.
    normalized = t.slice(0, sep).replace(/[^\d]/g, '') + '.' + t.slice(sep + 1).replace(/[^\d]/g, '')
  } else {
    normalized = t.replace(/[^\d]/g, '')
  }

  const n = Number(normalized)
  if (!Number.isFinite(n)) return null
  const negative = parenthesised || trailingMinus || leadingMinus
  return negative ? -n : n
}

/** Find every amount-looking token in a line, left to right. */
export function findAmounts(line: string): ParsedAmount[] {
  const s = normalizeThaiDigits(line)
  const out: ParsedAmount[] = []
  for (const m of s.matchAll(AMOUNT_RE)) {
    const token = m[0]
    // Skip bare integers that are too short to be money and look like counts.
    if (!/[.,]\d{2}\b/.test(token) && !/\d{1,3}(,\d{3})+/.test(token)) continue
    const parsed = parseAmountToken(token)
    if (parsed === null) continue
    // Some statements print the credit sign as its own column: "Payment - 628.11".
    // A dash standing alone, with space on both sides, directly before an amount
    // is that sign, not a separator. (Merchant text never ends in a bare dash
    // followed by a money amount.)
    const loneMinus = parsed > 0 && /(?:^|\s)[-–−]\s+$/.test(s.slice(0, m.index ?? 0))
    out.push({
      value: loneMinus ? -parsed : parsed,
      index: m.index ?? 0,
      length: token.length,
      negativeNotation: loneMinus || /^\(/.test(token) || /-$/.test(token) || /^-/.test(token),
    })
  }
  return out
}

/**
 * Amounts written with the baht sign, as the Shopee and Grab apps do.
 *
 * `findAmounts` deliberately ignores bare integers, because on a bank
 * statement they are reference and branch numbers. App screens have no such
 * problem — "฿370" is unambiguous — so a leading ฿ is taken as proof that the
 * number is money, decimals or not.
 */
/**
 * OCR rarely returns the baht sign itself. On real app screenshots ฿ comes
 * back as "8" or "B", which is worse than losing it — the stray character is
 * absorbed into the number, turning ฿200.00 into 8200.00.
 *
 * So a B or 8 welded to the front of a number, where a currency symbol would
 * sit, is read back as ฿. A genuine ฿8,200 OCRs as "88,200" and still comes
 * out right, because only the first character is consumed.
 */
export function normalizeBahtSign(line: string): string {
  return line.replace(/(^|[\s:[(|–—-])[B8b](?=\d)/g, '$1฿')
}

export function findBahtAmounts(line: string): number[] {
  const out: number[] = []
  for (const match of normalizeBahtSign(normalizeThaiDigits(line)).matchAll(/฿\s*([\d.,]+)/g)) {
    const value = parseAmountToken(match[1])
    if (value !== null && Number.isFinite(value)) out.push(Math.abs(value))
  }
  return out
}

const CURRENCY_HINTS: Record<string, string> = {
  THB: 'THB', บาท: 'THB', '฿': 'THB',
  USD: 'USD', $: 'USD',
  EUR: 'EUR', '€': 'EUR',
  GBP: 'GBP', '£': 'GBP',
  JPY: 'JPY', '¥': 'JPY',
  SGD: 'SGD', MYR: 'MYR', IDR: 'IDR', CNY: 'CNY', HKD: 'HKD', AUD: 'AUD', KRW: 'KRW', VND: 'VND', TWD: 'TWD',
}

/** Detect a non-home currency mentioned on a line, for overseas card spend. */
export function detectCurrency(line: string): string | null {
  const upper = line.toUpperCase()
  for (const [hint, code] of Object.entries(CURRENCY_HINTS)) {
    if (code === 'THB') continue
    const pattern = /^[A-Z]{3}$/.test(hint) ? new RegExp(`\\b${hint}\\b`) : hint
    if (typeof pattern === 'string' ? line.includes(pattern) : pattern.test(upper)) return code
  }
  return null
}

export function formatMoney(amount: number, currency = 'THB'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}
