/**
 * Card sections, and proving a statement adds up.
 *
 * One PDF can hold several cards, each with its own table: UOB prints three
 * back to back, every one opening with "PREVIOUS BALANCE" and closing with
 * "TOTAL BALANCE". Reading each as its own section gives every row an identity
 * (which card) and gives every card a check: opening balance + this period's
 * activity must equal the closing balance the bank printed. A misread amount,
 * or a row that went missing, breaks that sum — which is how it gets noticed.
 */
import { findAmounts } from '../money'
import { normalizeThaiDigits } from '../thaiDate'

export interface Section {
  /** The lines inside this card's table, in order. */
  lines: string[]
  /** Last four digits of the card, from the masked number printed above the table. */
  last4?: string
  /** Balance carried in from the last statement; negative when in credit (CR). */
  opening?: number
  /** Balance the bank prints at the end of the table; negative when in credit (CR). */
  closing?: number
}

/** A table's column header: a date column plus a description or amount column. */
export const TABLE_HEADER_RE =
  /(?:TRANS(?:\.|ACTION)?\s*DATE|POST(?:ING|ED)?\s*DATE|\bDATE\b).*\b(?:DESCRIPTION|AMOUNT|DETAILS?)\b|วันที่.*รายการ/i

/** The line that opens each card's section. */
export const TABLE_OPENING_RE =
  /PREVIOUS BALANCE|BALANCE BROUGHT FORWARD|OPENING BALANCE|ยอดยกมา|ยอดเรียกเก็บรอบที่แล้ว|ยอดคงเหลือยกมา/i

export const TABLE_END_RE = new RegExp(
  [
    String.raw`SUB\s*TOTAL`, 'TOTAL BALANCE', 'NEW BALANCE', 'TOTAL AMOUNT DUE',
    'ยอดรวม', 'ยอดยกไป', 'สรุปยอด', 'ACCOUNT SUMMARY',
    String.raw`POINTS?\s+(?:SUMMARY|EARNED|REDEEMED)`, String.raw`REWARDS?\s+POINT`,
    'NCB REPORT', 'CREDIT BUREAU', 'NATIONAL CREDIT', 'เครดิตบูโร',
    'INTEREST CALCULATION', String.raw`PAY-?IN\s*SLIP`, String.raw`PAYMENT\s*(?:FORM|SLIP)`,
    'แบบฟอร์มการชำระเงิน', 'CARDHOLDER NAME', 'ชื่อสมาชิก',
  ].join('|'),
  'i',
)

/** The line carrying the closing balance of the section just read. */
const CLOSING_RE = /TOTAL BALANCE|สรุปยอดรอบนี้|NEW BALANCE|ยอดยกไป/i

/** Statement-level closing figures, for statements with one card and no per-card total. */
const DOCUMENT_CLOSING_RE = /TOTAL AMOUNT DUE|TOTAL PAYMENT\/OVER PAID/i

/** Masked card numbers: 4300 56XX XXXX 5678, 4000-12XX-XXXX-4321, 411111XXXXXX9876. */
const MASKED_CARD_RES: [RegExp, number][] = [
  [/\d{4}[\s-]?\d{2}[Xx•*]{2}[\s-]?[Xx•*]{4}[\s-]?(\d{4})/, 1],
  [/\d{6}[Xx•*]{6}(\d{4})/, 1],
]

export function cardLast4(line: string): string | undefined {
  for (const [re, group] of MASKED_CARD_RES) {
    const match = line.match(re)
    if (match) return match[group]
  }
  return undefined
}

/** The rightmost money amount on a line; negative when the line says CR (the card is in credit). */
export function balanceOn(line: string): number | undefined {
  const amounts = findAmounts(line)
  if (!amounts.length) return undefined
  const value = Math.abs(amounts[amounts.length - 1].value)
  return /\bCR\b/i.test(line) ? -value : value
}

/** The statement's closing figure when it is printed once, outside any card's table. */
export function documentClosing(lines: string[]): number | undefined {
  for (const line of lines) {
    if (DOCUMENT_CLOSING_RE.test(line)) {
      const value = balanceOn(line)
      if (value !== undefined) return value
    }
  }
  return undefined
}

/**
 * Split a statement into one section per card table.
 *
 * Returns null when no table opening is found at all — an OCR'd screenshot, or
 * a bare list of rows — so the caller can read those line by line as before.
 * `isRow` says whether a line starts with a date: only a line that is not a row
 * can open or close a table, so a merchant called "TOTAL ACCESS" cannot end one.
 */
export function splitSections(lines: string[], isRow: (line: string) => boolean): Section[] | null {
  const sections: Section[] = []
  // `as` stops TypeScript narrowing these to null: they are set inside open().
  let current = null as Section | null // the section lines are being added to
  let finished = null as Section | null // the last one closed, still waiting for its closing balance
  let inside = false
  let rows = 0 // transaction rows seen in the current section so far
  let card: string | undefined // the last card number seen outside a table

  const open = () => {
    current = { lines: [], last4: card }
    sections.push(current)
    finished = null
    inside = true
    rows = 0
  }

  for (const line of lines) {
    // A masked card number names the card. Check every line, not just non-rows:
    // an address like "99/88 …" starts like a date, and KTC prints the number on such a line.
    // Inside a table, a row's own text is left alone.
    const last4 = inside && isRow(line) ? undefined : cardLast4(normalizeThaiDigits(line))
    if (last4) {
      if (!inside) card = last4
      // The header often comes before the number line, so a number seen before
      // the first row replaces whatever was carried over from an earlier table.
      else if (current && rows === 0) current.last4 = last4
    }

    if (!isRow(line)) {
      const opens = TABLE_OPENING_RE.test(line)
      if (opens || TABLE_HEADER_RE.test(line)) {
        if (!inside) open()
        // "Previous balance" inside a table that already has rows is the next card's opening.
        else if (opens && current && (rows > 0 || current.opening !== undefined)) open()
        if (opens && current && current.opening === undefined) current.opening = balanceOn(line)
        continue
      }

      if (TABLE_END_RE.test(line)) {
        if (CLOSING_RE.test(line)) {
          const target = inside ? current : finished
          const closing = balanceOn(line)
          if (target && target.closing === undefined && closing !== undefined) target.closing = closing
        }
        if (inside) {
          inside = false
          finished = current
        }
        continue
      }
    }
    if (inside && current) {
      current.lines.push(line)
      if (isRow(line)) rows++
    }
  }

  return sections.length ? sections : null
}

export interface Reconciliation {
  /** Last four digits of the card this covers, when known. */
  last4?: string
  status: 'verified' | 'mismatch' | 'unverified'
  opening?: number
  closing?: number
  /** This period's rows: spending positive, credits negative. */
  net: number
  /** closing − (opening + net). Zero when it adds up. */
  difference?: number
  detail: string
}

const round2 = (n: number) => Math.round(n * 100) / 100
const baht = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Does opening + activity equal the closing balance the bank printed?
 *
 * `paid` is how much of the period's credits were payments of the card's own
 * bill. It matters only when no opening balance is printed (ttb prints just
 * the amount due): then the previous balance can be inferred, and if it equals
 * what was paid, that is a good sign — though not proof, so it stays unverified.
 */
export function reconcile(
  section: Pick<Section, 'last4' | 'opening' | 'closing'>,
  netInput: number,
  paid = 0,
): Reconciliation {
  const net = round2(netInput)
  const { last4, opening, closing } = section
  const base = { last4, opening, closing, net }

  if (closing === undefined) {
    return { ...base, status: 'unverified', detail: 'No closing balance was found to check the rows against.' }
  }

  if (opening === undefined) {
    const implied = round2(closing - net)
    const clue =
      paid > 0 && Math.abs(implied - paid) < 0.01
        ? ` The previous balance implied by the rows is ${baht(implied)}, exactly what was paid, which is what you would expect if it was paid in full.`
        : ''
    return {
      ...base,
      status: 'unverified',
      detail: `This statement prints no previous balance, so the rows cannot be checked against it. Balance due ${baht(closing)}.${clue}`,
    }
  }

  const expected = round2(opening + net)
  const difference = round2(closing - expected)
  if (Math.abs(difference) < 0.01) {
    return {
      ...base,
      difference: 0,
      status: 'verified',
      detail: `Previous balance ${baht(opening)} plus ${baht(net)} of activity gives ${baht(closing)}, as printed.`,
    }
  }
  return {
    ...base,
    difference,
    status: 'mismatch',
    detail:
      `The rows give ${baht(expected)} but the statement closes at ${baht(closing)}: ${baht(Math.abs(difference))} ` +
      (difference > 0 ? 'is missing from the rows' : 'is extra in the rows') +
      '. A row may be misread, missed or duplicated.',
  }
}
