/** Signatures that tell us which Thai bank produced a statement. */

export type StatementKind = 'account' | 'card' | 'unknown'

export interface BankProfile {
  id: string
  name: string
  /** Names and product names. Worth one point each when found in the letterhead area. */
  signatures: string[]
  /**
   * Things only this issuer prints: its website, head-office address or phone,
   * legal name. Worth three points each. Some banks never write their own name
   * on a statement (ttb prints only its head-office address), so these are what
   * identify them.
   */
  identifiers?: (string | RegExp)[]
  /**
   * Some banks put withdrawals and deposits in separate columns; others use a
   * single signed amount. This drives how we read the numbers on a row.
   */
  defaultKind: StatementKind
}

export const BANK_PROFILES: BankProfile[] = [
  {
    id: 'kbank',
    name: 'Kasikornbank (KBank)',
    signatures: ['KASIKORNBANK', 'KBANK', 'ธนาคารกสิกรไทย', 'K PLUS', 'K-CREDIT'],
    identifiers: ['KASIKORNBANK.COM', 'K-CONTACT CENTER', 'ราษฎร์บูรณะ 27/1', /RAT\s*BURANA/i],
    defaultKind: 'unknown',
  },
  {
    id: 'scb',
    name: 'Siam Commercial Bank (SCB)',
    signatures: ['SIAM COMMERCIAL', 'SCB EASY', 'ธนาคารไทยพาณิชย์', 'SCB '],
    identifiers: ['SCB.CO.TH', 'SCB CONTACT CENTER'],
    defaultKind: 'unknown',
  },
  {
    id: 'ktb',
    name: 'Krungthai Bank (KTB)',
    signatures: ['KRUNGTHAI BANK', 'KRUNG THAI BANK', 'ธนาคารกรุงไทย', 'KRUNGTHAI NEXT'],
    identifiers: ['KRUNGTHAI.COM', 'KTB NETBANK'],
    defaultKind: 'unknown',
  },
  {
    id: 'bbl',
    name: 'Bangkok Bank (BBL)',
    signatures: ['BANGKOK BANK', 'ธนาคารกรุงเทพ', 'BUALUANG'],
    identifiers: ['BANGKOKBANK.COM'],
    defaultKind: 'unknown',
  },
  {
    id: 'ttb',
    name: 'TMBThanachart (ttb)',
    signatures: ['TMBTHANACHART', 'TTB ', 'ทีทีบี', 'ธนาคารทหารไทยธนชาต'],
    // ttb statements never name the bank; the head-office address and phone do.
    identifiers: ['TTBBANK.COM', '0 2299 1111', /3000\s+PHAHOLYOTHIN/i, /3000\s*ถ\.?\s*พหลโยธิน/],
    defaultKind: 'unknown',
  },
  {
    id: 'krungsri',
    name: 'Krungsri (Bank of Ayudhya)',
    signatures: ['KRUNGSRI', 'AYUDHYA', 'ธนาคารกรุงศรีอยุธยา', 'KMA'],
    identifiers: ['KRUNGSRI.COM'],
    defaultKind: 'unknown',
  },
  {
    id: 'gsb',
    name: 'Government Savings Bank (GSB)',
    signatures: ['GOVERNMENT SAVINGS BANK', 'ธนาคารออมสิน', 'MYMO'],
    identifiers: ['GSB.OR.TH'],
    defaultKind: 'account',
  },
  {
    id: 'ktc',
    name: 'KTC (Krungthai Card)',
    signatures: ['KTC VISA', 'KTC FOREVER', 'KTC TOUCH', 'KTC MOBILE', 'KTC PHONE'],
    identifiers: ['KRUNGTHAI CARD', 'บัตรกรุงไทย', 'KTC.CO.TH'],
    defaultKind: 'card',
  },
  {
    id: 'uob',
    name: 'UOB Thailand',
    signatures: ['UNITED OVERSEAS BANK', 'UOB '],
    identifiers: ['UOB.CO.TH', 'UOB CONTACT CENTER'],
    defaultKind: 'unknown',
  },
  {
    id: 'citi',
    name: 'Citibank Thailand',
    signatures: ['CITIBANK', 'CITI '],
    defaultKind: 'card',
  },
]

/** Words that mark a statement as a credit card rather than a deposit account. */
const CARD_HINTS = [
  'CREDIT CARD', 'CARD NUMBER', 'STATEMENT DATE', 'PAYMENT DUE', 'MINIMUM PAYMENT',
  'CREDIT LIMIT', 'บัตรเครดิต', 'ยอดชำระขั้นต่ำ', 'วันครบกำหนดชำระ', 'วงเงิน',
  'POSTING DATE', 'วันที่บันทึก',
]

/** Words that mark a deposit / savings account statement. */
const ACCOUNT_HINTS = [
  'ACCOUNT NUMBER', 'SAVINGS', 'CURRENT ACCOUNT', 'BALANCE BROUGHT FORWARD',
  'WITHDRAWAL', 'DEPOSIT', 'เลขที่บัญชี', 'ถอนเงิน', 'ฝากเงิน', 'ยอดคงเหลือ',
  'บัญชีออมทรัพย์', 'รายการเดินบัญชี',
]

export interface Detection {
  bank: BankProfile | null
  kind: StatementKind
  label: string
}

/**
 * Match a signature against the statement text.
 *
 * Short bank acronyms are matched on letter boundaries rather than as bare
 * substrings, so "SCB" does not fire inside another word while "UOBT TMRW"
 * and "UOB PREMIER" both still identify UOB. Padding signatures with a
 * trailing space used to serve this purpose, and missed a bank whose name
 * ended a line.
 */
const SHORT_SIGNATURE_RE = /^[A-Za-z]{2,4}$/

function signatureMatches(signature: string, text: string): boolean {
  const s = signature.trim()
  if (SHORT_SIGNATURE_RE.test(s)) {
    return new RegExp(`(?<![A-Za-z])${s}(?![A-Za-z])`, 'i').test(text)
  }
  return text.toUpperCase().includes(s.toUpperCase())
}

function identifierMatches(identifier: string | RegExp, text: string): boolean {
  return typeof identifier === 'string' ? text.toUpperCase().includes(identifier.toUpperCase()) : identifier.test(text)
}

/**
 * Where a payment slip begins. The slip lists every bank a customer can pay
 * at, so everything from here on says nothing about who issued the statement.
 * (A KTC statement once came back as KBank because of it.)
 */
const PAYMENT_SLIP_RE = /PAY-?IN\s*SLIP|PAYMENT\s*(?:FORM|SLIP)|แบบฟอร์มการชำระเงิน|FOR BANK USE ONLY|สำหรับธนาคาร/i

/** A transaction row starts with a date. Merchant text in it ("Payment-SCB…") is not the issuer. */
const ROW_START_RE = /^\s*\d{1,2}\s*[/\-. ]\s*(?:\d{1,2}|[A-Za-z]{3,9})\b/

/**
 * The text that can name the issuer: the letterhead and summary, without
 * transaction rows and without anything from the payment slip onwards.
 */
function letterhead(lines: string[]): string {
  const kept: string[] = []
  for (const line of lines) {
    if (PAYMENT_SLIP_RE.test(line)) break
    if (ROW_START_RE.test(line)) continue
    kept.push(line)
  }
  return kept.join('\n')
}

export function detectStatement(input: string | string[]): Detection {
  const lines = Array.isArray(input) ? input : input.split('\n')
  const text = lines.join('\n')
  const upper = text.toUpperCase()
  const head = letterhead(lines)

  // Score every bank on the letterhead: 1 per name, 3 per identifier it alone prints.
  let bank: BankProfile | null = null
  let best = 0
  for (const profile of BANK_PROFILES) {
    const score =
      profile.signatures.filter((s) => signatureMatches(s, head)).length +
      3 * (profile.identifiers ?? []).filter((id) => identifierMatches(id, head)).length
    if (score > best) {
      best = score
      bank = profile
    }
  }

  const cardScore = CARD_HINTS.filter((h) => upper.includes(h.toUpperCase())).length
  const accountScore = ACCOUNT_HINTS.filter((h) => upper.includes(h.toUpperCase())).length

  let kind: StatementKind = 'unknown'
  if (cardScore > accountScore) kind = 'card'
  else if (accountScore > cardScore) kind = 'account'
  else if (bank) kind = bank.defaultKind

  const label = bank
    ? `${bank.name}${kind === 'unknown' ? '' : ` — ${kind === 'card' ? 'credit card' : 'account'}`}`
    : kind === 'unknown'
      ? 'Unrecognised statement (generic parser)'
      : `Unknown bank — ${kind === 'card' ? 'credit card' : 'account'}`

  return { bank, kind, label }
}
