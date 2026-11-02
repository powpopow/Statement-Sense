/** Signatures that tell us which Thai bank produced a statement. */

export type StatementKind = 'account' | 'card' | 'unknown'

export interface BankProfile {
  id: string
  name: string
  /** Any of these appearing in the text identifies the bank. */
  signatures: string[]
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
    defaultKind: 'unknown',
  },
  {
    id: 'scb',
    name: 'Siam Commercial Bank (SCB)',
    signatures: ['SIAM COMMERCIAL', 'SCB EASY', 'ธนาคารไทยพาณิชย์', 'SCB '],
    defaultKind: 'unknown',
  },
  {
    id: 'ktb',
    name: 'Krungthai Bank (KTB)',
    signatures: ['KRUNGTHAI', 'KRUNG THAI', 'ธนาคารกรุงไทย', 'KRUNGTHAI NEXT'],
    defaultKind: 'unknown',
  },
  {
    id: 'bbl',
    name: 'Bangkok Bank (BBL)',
    signatures: ['BANGKOK BANK', 'ธนาคารกรุงเทพ', 'BUALUANG'],
    defaultKind: 'unknown',
  },
  {
    id: 'ttb',
    name: 'TMBThanachart (ttb)',
    signatures: ['TMBTHANACHART', 'TTB ', 'ทีทีบี', 'ธนาคารทหารไทยธนชาต'],
    defaultKind: 'unknown',
  },
  {
    id: 'krungsri',
    name: 'Krungsri (Bank of Ayudhya)',
    signatures: ['KRUNGSRI', 'AYUDHYA', 'ธนาคารกรุงศรีอยุธยา', 'KMA'],
    defaultKind: 'unknown',
  },
  {
    id: 'gsb',
    name: 'Government Savings Bank (GSB)',
    signatures: ['GOVERNMENT SAVINGS BANK', 'ธนาคารออมสิน', 'MYMO'],
    defaultKind: 'account',
  },
  {
    id: 'uob',
    name: 'UOB Thailand',
    signatures: ['UNITED OVERSEAS BANK', 'UOB '],
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

export function detectStatement(text: string): Detection {
  const upper = text.toUpperCase()

  const bank = BANK_PROFILES.find((p) => p.signatures.some((s) => signatureMatches(s, text))) ?? null

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
