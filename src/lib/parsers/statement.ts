/**
 * The statement parser.
 *
 * Rather than hand-writing a layout per bank, this reads any row that starts
 * with a date and carries amounts, then works out what the amount columns mean
 * from the data itself:
 *
 *  - If the rightmost column behaves like a running balance (each value equals
 *    the previous one plus or minus the column beside it), we use the balance
 *    deltas to sign every transaction exactly. This is the reliable path, and
 *    most Thai passbook-style statements take it.
 *  - Otherwise we fall back to credit markers (CR, parentheses, trailing minus,
 *    Thai refund/payment wording) and treat everything else as spending.
 */
import { findAmounts, detectCurrency, type ParsedAmount } from '../money'
import { parseThaiDate, findStatementYear, normalizeThaiDigits } from '../thaiDate'
import type { Transaction } from '../types'
import { kindOf } from '../categorize'
import { detectStatement, type StatementKind } from './banks'
import { documentClosing, reconcile, splitSections, type Reconciliation, type Section } from './sections'

/**
 * A line is a candidate row only if a date sits near its start.
 *
 * The year is optional and must not swallow anything that follows it:
 * statements printing two dates per row often carry no year at all
 * ("15 SEP 14 SEP LINEPAY…"), where "14" is the next date's day, and a
 * merchant can open with digits ("16 SEP 90GRAMS SILOM"), where "90" is part
 * of the name. So a two-digit year is accepted only when nothing runs on
 * directly after it and no month name follows.
 */
const MONTHS_EN = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec'
const YEAR_PART = String.raw`(?:\s*(?:\d{4}|\d{2}(?![A-Za-z\d])(?!\s*(?:${MONTHS_EN})\b)(?!\s*[฀-๿])))?`
const LEADING_DATE_RE = new RegExp(
  String.raw`^\s*(\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?` +
    String.raw`|\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}` +
    String.raw`|\d{1,2}\s*[฀-๿.]{2,10}${YEAR_PART}` +
    String.raw`|\d{1,2}\s*[A-Za-z]{3,9}\.?${YEAR_PART})`,
  'i',
)

/**
 * A date with digits welded onto its year, as in "24/08/202614".
 *
 * Thai card statements print an interest-calculation table whose columns run
 * date, date, day-count, principal, interest — and the day count collides with
 * the year when the PDF is flattened to text. Nothing in a real transaction
 * row looks like this, so it is a reliable signal to drop the line.
 */
const MALFORMED_DATE_RE = /\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}\d+/

/**
 * Thai banks print a worked example on every statement — an invented month of
 * spending used to explain how interest is charged. Those rows look exactly
 * like real transactions, so without this they are imported as spending and
 * can dwarf the real figures.
 *
 * Both halves must appear on the same line, so that a passing mention of
 * "ตัวอย่าง" in body text does not discard a page of genuine rows.
 */
const EXAMPLE_WORD_RE = /ตัวอย่าง|example|sample|illustration/i
const EXAMPLE_CONTEXT_RE = /ดอกเบี้ย|ใบแจ้งยอด|interest\s*calculation|statement/i

function isExampleHeading(line: string): boolean {
  return EXAMPLE_WORD_RE.test(line) && EXAMPLE_CONTEXT_RE.test(line)
}

/**
 * Trim each page at its first example heading. Scoping to the page matters:
 * the example sits on the terms-and-conditions page, while real transactions
 * live on their own pages and must survive untouched.
 */
function dropExampleSections(pages: string[][]): { pages: string[][]; dropped: boolean } {
  let dropped = false
  const kept = pages.map((lines) => {
    const marker = lines.findIndex(isExampleHeading)
    if (marker === -1) return lines
    dropped = true
    return lines.slice(0, marker)
  })
  return { pages: kept, dropped }
}

/** Rows whose description matches these are summary lines, not transactions. */
const SKIP_RE = new RegExp(
  [
    'BALANCE (BROUGHT|CARRIED) FORWARD',
    // A summary line, not a merchant: "TOTAL", "TOTAL BALANCE", "TOTAL FEE" —
    // but not "TOTAL ACCESS", the legal name of a Thai phone company.
    String.raw`\bTOTAL\b(?=\s*(?:$|[\d.,()]|BALANCE|AMOUNT|FEE|VAT|DEBIT|CREDIT|PAYMENT|SPEND|PURCHASE|DUE|NEW|INTEREST|CHARGE|FOR|OF|THIS|CASH|MIN|SUMMARY))`,
    'SUB\\s*TOTAL',
    'SUBTOTAL',
    'STATEMENT (DATE|PERIOD)',
    'PAGE \\d',
    'ยอดยกมา',
    'ยอดยกไป',
    'รวมทั้งสิ้น',
    'ยอดรวม',
    'หน้า \\d',
  ].join('|'),
  'i',
)

/** Markers that flip a card transaction from spending to a credit. */
const CREDIT_RE = new RegExp(
  ['\\bCR\\b', 'REFUND', 'REVERSAL', 'PAYMENT RECEIVED', 'THANK YOU',
   'คืนเงิน', 'รับชำระ', 'ชำระเงิน', 'ยกเลิกรายการ', 'โอนเข้า', 'เงินเข้า', 'ดอกเบี้ยรับ'].join('|'),
  'i',
)

/** The opening balance line, which seeds the balance maths for the first row. */
const BROUGHT_FORWARD_RE = /BALANCE BROUGHT FORWARD|OPENING BALANCE|ยอดยกมา|ยอดคงเหลือยกมา/i

interface CandidateRow {
  /** Index of the card section this row came from. */
  section: number
  line: string
  /** The purchase date. */
  date: string
  /** The posting date, when the row carries two dates. */
  postedDate?: string
  description: string
  amounts: ParsedAmount[]
}

/**
 * Which date comes first on a row.
 *
 * Card statements print two dates, and banks disagree on the order: UOB prints
 * "POST DATE  TRANS DATE", KBank, ttb and KTC print the transaction date first.
 * The column header says which; without one, the transaction date is assumed first.
 */
type DateOrder = 'post-first' | 'trans-first'
const POST_FIRST_HEADER_RE = /POST(?:ING|ED)?\s*DATE.*TRANS(?:\.|ACTION)?\s*DATE/i

function detectDateOrder(lines: string[]): DateOrder {
  return lines.some((line) => POST_FIRST_HEADER_RE.test(line)) ? 'post-first' : 'trans-first'
}

/** Up to two dates at the start of a line, as ISO dates, in the order printed. */
function leadingDates(line: string, fallbackYear?: number): string[] {
  const dates: string[] = []
  let rest = normalizeThaiDigits(line)
  for (let i = 0; i < 2; i++) {
    const match = rest.match(LEADING_DATE_RE)
    if (!match) break
    // The shape alone is not enough: a merchant can open with digits ("90GRAMS").
    const iso = parseThaiDate(match[1], fallbackYear)
    if (!iso) break
    dates.push(iso)
    rest = rest.slice(match[0].length).replace(/^[\s|:,]+/, '')
  }
  return dates
}

/**
 * Find the balance the statement opens with. Without it the first transaction
 * has no previous balance to difference against, so its direction is a guess.
 */
function findOpeningBalance(lines: string[]): number | null {
  for (const line of lines) {
    if (!BROUGHT_FORWARD_RE.test(line)) continue
    const amounts = findAmounts(line)
    if (amounts.length) return amounts.at(-1)!.value
  }
  return null
}

/**
 * Remove every date at the start of a line, not just the first.
 *
 * Credit card statements carry both a transaction date and a posting date, so
 * stopping after one leaves the posting date stranded in the description.
 */
function stripDate(line: string): { rest: string } {
  let rest = line
  // Two is the most any statement uses — a transaction date and a posting date.
  for (let i = 0; i < 2; i++) {
    const match = rest.match(LEADING_DATE_RE)
    if (!match) break
    // The shape of a date is not enough: a merchant can open with digits, and
    // "90GRAMS SILOM" reads as day-then-month until you try to parse it.
    if (!parseThaiDate(match[1], 2000)) break
    rest = rest.slice(match[0].length).replace(/^[\s|:,]+/, '')
  }
  return { rest }
}

/**
 * Build a description by removing the date and every amount token, then
 * cleaning up the leftover column separators and bookkeeping codes.
 */
function buildDescription(line: string, amounts: ParsedAmount[]): string {
  const normalized = normalizeThaiDigits(line)
  let out = ''
  let cursor = 0
  for (const a of amounts) {
    out += normalized.slice(cursor, a.index)
    cursor = a.index + a.length
  }
  out += normalized.slice(cursor)

  return stripDate(out)
    .rest
    // Times like 14:32 and standalone transaction codes add nothing useful.
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ')
    // "CR"/"DR" are column flags marking the direction, already read from the
    // amount; leaving them makes every credit read "… THANK YOU CR".
    .replace(/\s+(CR|DR)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—|:,./]+|[\s\-–—|:,./]+$/g, '')
    .trim()
}

function collectRows(lines: string[], fallbackYear?: number, order: DateOrder = 'trans-first', section = 0): CandidateRow[] {
  const rows: CandidateRow[] = []
  for (const line of lines) {
    if (!line.trim() || SKIP_RE.test(line) || MALFORMED_DATE_RE.test(line)) continue
    const dates = leadingDates(line, fallbackYear)
    if (!dates.length) continue
    const amounts = findAmounts(line)
    if (!amounts.length) continue
    // One date is both; two are purchase and posting, in the header's order.
    const [first, second] = dates
    const date = second && order === 'post-first' ? second : first
    const postedDate = second ? (order === 'post-first' ? first : second) : undefined
    rows.push({ section, line, date, postedDate, description: buildDescription(line, amounts), amounts })
  }
  return rows
}

/**
 * Decide whether the last amount column is a running balance.
 *
 * We check consecutive rows that both have at least two amounts: if the change
 * in the last column matches one of the other amounts on the row, that is a
 * balance. Requiring a clear majority keeps us from guessing on noisy OCR.
 */
function detectBalanceColumn(rows: CandidateRow[], openingBalance: number | null): boolean {
  const multi = rows.filter((r) => r.amounts.length >= 2)
  if (!multi.length) return false

  const balances = multi.map((r) => r.amounts.at(-1)!.value)

  // The brought-forward balance supplies a prior value for the very first row.
  // Without it the first row can only be compared against the second, which
  // costs a comparison — enough to make short statements undecidable, where
  // the fallback would then read the balance column as the amount.
  const hasOpening = openingBalance !== null
  const candidates = hasOpening ? multi : multi.slice(1)
  const priors = hasOpening ? [openingBalance, ...balances.slice(0, -1)] : balances.slice(0, -1)

  let agree = 0
  let tested = 0
  candidates.forEach((row, i) => {
    const delta = Math.abs(row.amounts.at(-1)!.value - priors[i])
    if (delta === 0) return
    tested++
    const matches = row.amounts.slice(0, -1).some((a) => Math.abs(Math.abs(a.value) - delta) < 0.02)
    if (matches) agree++
  })

  // A known opening balance makes each comparison far stronger evidence, so
  // fewer of them are needed before trusting the conclusion.
  const minimum = hasOpening ? 2 : 3
  return tested >= minimum && agree / tested >= 0.6
}

export interface StatementParseOutput {
  transactions: Transaction[]
  warnings: string[]
  detectedFormat: string
  kind: StatementKind
  /** One check per card on the statement: do the rows add up to the balance the bank printed? Cards only. */
  reconciliation: Reconciliation[]
  /** Which issuer the statement came from (see BANK_PROFILES), or null if unrecognised. */
  bankId: string | null
}

/**
 * @param inputPages Lines grouped by page. Page grouping is load-bearing: the
 *   bank's worked example is trimmed per page, so a flat list would either
 *   keep invented transactions or discard real ones.
 */
export function parseStatement(
  inputPages: string[][],
  sourceFile: string,
  idPrefix: string,
): StatementParseOutput {
  const detection = detectStatement(inputPages.flat())

  const { pages, dropped } = dropExampleSections(inputPages)
  const lines = pages.flat()
  const text = lines.join('\n')
  const year = findStatementYear(text)
  const warnings: string[] = []
  if (dropped) {
    warnings.push(
      'Skipped the illustrative example the bank prints to explain interest — those rows are not your transactions.',
    )
  }

  // One section per card table; a bare list of rows (OCR) is read line by line.
  const isRowLine = (line: string) => LEADING_DATE_RE.test(normalizeThaiDigits(line))
  const sections = splitSections(lines, isRowLine)
  const order = detectDateOrder(lines)
  const rows = (sections ?? [{ lines } as Section]).flatMap((sec, i) => collectRows(sec.lines, year, order, i))
  if (!rows.length) {
    return {
      transactions: [],
      warnings: [
        'No transaction rows found. The statement may be an image-only PDF, password protected, or in a layout the parser does not recognise yet.',
      ],
      detectedFormat: detection.label,
      kind: detection.kind,
      reconciliation: [],
      bankId: detection.bank?.id ?? null,
    }
  }

  const openingBalance = findOpeningBalance(lines)
  const hasBalance = detectBalanceColumn(rows, openingBalance)
  const transactions: Transaction[] = []
  const sectionOf: number[] = [] // which section each transaction came from, aligned with `transactions`
  let previousBalance: number | null = hasBalance ? openingBalance : null
  let lowConfidenceCount = 0

  rows.forEach((row, i) => {
    let amount: number
    let confidence = 0.9

    if (hasBalance && row.amounts.length >= 2) {
      const balance = row.amounts.at(-1)!.value
      const stated = row.amounts.at(-2)!

      if (previousBalance !== null) {
        const delta = balance - previousBalance
        // A falling balance is money out, which is positive spending for us.
        amount = -delta
        // If the balance delta disagrees with the stated amount, the row is
        // probably misread, so fall back to the stated figure and flag it.
        if (Math.abs(Math.abs(delta) - Math.abs(stated.value)) > 0.02) {
          amount = Math.abs(stated.value)
          confidence = 0.5
          lowConfidenceCount++
        }
      } else {
        amount = Math.abs(stated.value)
        confidence = 0.7
      }
      previousBalance = balance
    } else {
      // No balance column: the rightmost amount is the transaction amount.
      const last = row.amounts.at(-1)!
      amount = Math.abs(last.value)
      if (last.negativeNotation || CREDIT_RE.test(row.line)) amount = -amount
      confidence = row.amounts.length > 2 ? 0.6 : 0.8
      if (confidence < 0.7) lowConfidenceCount++
    }

    if (!Number.isFinite(amount) || amount === 0) return

    const foreignCurrency = detectCurrency(row.line)
    const description = row.description || '(no description)'

    const card = detection.kind === 'card' ? sections?.[row.section]?.last4 : undefined
    sectionOf.push(row.section)
    transactions.push({
      id: `${idPrefix}-t${i}`,
      date: row.date,
      ...(row.postedDate && row.postedDate !== row.date ? { postedDate: row.postedDate } : {}),
      description,
      amount: Math.round(amount * 100) / 100,
      currency: 'THB',
      ...(foreignCurrency ? { foreignCurrency } : {}),
      category: 'Uncategorized',
      categoryLocked: false,
      source: detection.label,
      sourceFile,
      confidence,
      ...(card
        ? { account: `${detection.bank?.id ?? 'card'}-${card}`, accountName: `${detection.bank?.short ?? 'Card'} ••${card}` }
        : {}),
    })
  })

  if (hasBalance) {
    warnings.push('Amounts were derived from the running balance column, which is the most reliable reading.')
  } else {
    warnings.push('No running balance column found — amounts were read from the rightmost money column and signed from credit markers. Check a few rows.')
  }
  if (lowConfidenceCount) {
    warnings.push(`${lowConfidenceCount} row${lowConfidenceCount === 1 ? '' : 's'} had ambiguous columns and are flagged for review.`)
  }
  if (!year) {
    warnings.push('No statement year found in the header; dates written without a year may be wrong.')
  }

  // Cards: does each card's activity add up to the balance the bank printed?
  const reconciliation: Reconciliation[] =
    detection.kind === 'card' && sections
      ? sections
          .map((sec, index) => {
            const mine = transactions.filter((_, t) => sectionOf[t] === index)
            const net = mine.reduce((sum, t) => sum + t.amount, 0)
            const paid = mine.reduce((sum, t) => (kindOf(t) === 'payment' ? sum - t.amount : sum), 0)
            const closing = sec.closing ?? (sections.length === 1 ? documentClosing(lines) : undefined)
            const periodEnd = mine.map((t) => t.postedDate ?? t.date).sort().pop()
            return { sec, rows: mine.length, check: { ...reconcile({ ...sec, closing }, net, paid), periodEnd } }
          })
          // A heading with nothing under it, and no balances, is not a card.
          .filter(({ sec, rows: n }) => n > 0 || sec.opening !== undefined || sec.closing !== undefined)
          .map(({ check }) => check)
      : []
  return {
    transactions,
    warnings,
    detectedFormat: detection.label,
    kind: detection.kind,
    reconciliation,
    bankId: detection.bank?.id ?? null,
  }
}
