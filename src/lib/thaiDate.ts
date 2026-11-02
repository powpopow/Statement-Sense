/**
 * Date parsing for Thai bank statements.
 *
 * Two things make these awkward: years are often Buddhist Era (2568 = 2025 CE),
 * and months appear as Thai abbreviations with or without the trailing periods.
 */

const THAI_MONTHS: Record<string, number> = {
  'ม.ค.': 1, มกราคม: 1, มค: 1,
  'ก.พ.': 2, กุมภาพันธ์: 2, กพ: 2,
  'มี.ค.': 3, มีนาคม: 3, มีค: 3,
  'เม.ย.': 4, เมษายน: 4, เมย: 4,
  'พ.ค.': 5, พฤษภาคม: 5, พค: 5,
  'มิ.ย.': 6, มิถุนายน: 6, มิย: 6,
  'ก.ค.': 7, กรกฎาคม: 7, กค: 7,
  'ส.ค.': 8, สิงหาคม: 8, สค: 8,
  'ก.ย.': 9, กันยายน: 9, กย: 9,
  'ต.ค.': 10, ตุลาคม: 10, ตค: 10,
  'พ.ย.': 11, พฤศจิกายน: 11, พย: 11,
  'ธ.ค.': 12, ธันวาคม: 12, ธค: 12,
}

const EN_MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

/**
 * Guard against reading the next date's day as a year.
 *
 * Card statements print two dates per row with no year at all ("15 SEP 14 SEP
 * LINEPAY…"), so a trailing two-digit number is only a year when what follows
 * is not another month name. Four-digit years are never ambiguous.
 */
const EN_MONTH_NAMES = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec'
const YEAR_OR_NEXT_DATE = String.raw`(\d{4}|\d{2}(?![A-Za-z\d])(?!\s*(?:${EN_MONTH_NAMES})\b)(?!\s*[฀-๿]))`

/** Thai digits ๐-๙ appear in some statements; fold them to ASCII. */
export function normalizeThaiDigits(s: string): string {
  return s.replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
}

/**
 * Convert a year to CE. Buddhist Era runs 543 ahead, so a 4-digit year at or
 * above 2400 is BE.
 *
 * Two-digit years are genuinely ambiguous — Thai statements write both, and
 * `26` could mean 2569 BE (2026) or 2026 CE, while `69` means 2569 BE. So
 * rather than assuming one era, take whichever reading lands nearest the
 * present and is not in the future: 26 → 2026 CE, 69 → 2026 BE, 68 → 2025 BE.
 */
export function toGregorianYear(year: number): number {
  if (year >= 2400) return year - 543
  if (year >= 100) return year

  const now = new Date().getFullYear()
  const buddhist = 2500 + year - 543
  const gregorian = 2000 + year
  // A statement cannot be from the future, so rank those last.
  const distance = (candidate: number) =>
    candidate > now + 1 ? Number.POSITIVE_INFINITY : Math.abs(now - candidate)

  return distance(buddhist) <= distance(gregorian) ? buddhist : gregorian
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Parse one date out of a statement fragment. Returns an ISO date or null.
 *
 * `fallbackYear` fills in formats like "15/03" that omit the year, which is
 * common in credit card statements where the year only appears in the header.
 */
export function parseThaiDate(raw: string, fallbackYear?: number): string | null {
  if (!raw) return null
  const s = normalizeThaiDigits(raw).trim()

  // 15/03/2568, 15-03-68, 15.03.2025
  const numeric = s.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (numeric) {
    const d = +numeric[1]
    const m = +numeric[2]
    const y = toGregorianYear(+numeric[3])
    const r = iso(y, m, d)
    if (r) return r
  }

  // 2568-03-15 / 2025-03-15 (ISO-ish, year first)
  const yearFirst = s.match(/(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/)
  if (yearFirst) {
    const r = iso(toGregorianYear(+yearFirst[1]), +yearFirst[2], +yearFirst[3])
    if (r) return r
  }

  // 15 มี.ค. 68  /  15 มีนาคม 2568
  const thai = s.match(new RegExp(String.raw`(\d{1,2})\s*([฀-๿.]+)\s*${YEAR_OR_NEXT_DATE}?`))
  if (thai) {
    const key = thai[2].replace(/\s/g, '')
    const m = THAI_MONTHS[key] ?? THAI_MONTHS[key.replace(/\./g, '')]
    if (m) {
      const y = thai[3] ? toGregorianYear(+thai[3]) : fallbackYear
      if (y) {
        const r = iso(y, m, +thai[1])
        if (r) return r
      }
    }
  }

  // 15 Mar 2025  /  15 SEP (year from the statement header)  /  Mar 15, 2025
  const enDM = s.match(new RegExp(String.raw`(\d{1,2})\s*([A-Za-z]{3,9})\.?\s*${YEAR_OR_NEXT_DATE}?`, 'i'))
  if (enDM) {
    const m = EN_MONTHS[enDM[2].toLowerCase()]
    if (m) {
      const y = enDM[3] ? toGregorianYear(+enDM[3]) : fallbackYear
      if (y) {
        const r = iso(y, m, +enDM[1])
        if (r) return r
      }
    }
  }
  const enMD = s.match(/([A-Za-z]{3,9})\.?\s*(\d{1,2}),?\s*(\d{2,4})?/)
  if (enMD) {
    const m = EN_MONTHS[enMD[1].toLowerCase()]
    if (m) {
      const y = enMD[3] ? toGregorianYear(+enMD[3]) : fallbackYear
      if (y) {
        const r = iso(y, m, +enMD[2])
        if (r) return r
      }
    }
  }

  // 15/03 with the year supplied by the statement header.
  const dayMonth = s.match(/^(\d{1,2})[/\-.](\d{1,2})$/)
  if (dayMonth && fallbackYear) {
    const r = iso(fallbackYear, +dayMonth[2], +dayMonth[1])
    if (r) return r
  }

  return null
}

/** Pull a statement-level year from header text, to fill in partial dates. */
export function findStatementYear(text: string): number | undefined {
  const t = normalizeThaiDigits(text)
  const years = [...t.matchAll(/\b(25\d{2}|20\d{2})\b/g)].map((m) => toGregorianYear(+m[1]))
  if (!years.length) return undefined
  const now = new Date().getFullYear()
  const plausible = years.filter((y) => y >= 2000 && y <= now + 1)
  if (!plausible.length) return undefined
  // The most frequent plausible year is almost always the statement period.
  const counts = new Map<number, number>()
  for (const y of plausible) counts.set(y, (counts.get(y) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
