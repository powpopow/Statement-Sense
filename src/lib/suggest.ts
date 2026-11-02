/**
 * Turning uncategorised rows into a merchant backlog.
 *
 * Statement descriptions are not merchant names. The same shop appears as
 * "AMZ_SC2644 SINGHA COMPLEXBANGKOK" and "AMZ_SC2644 SINGHA COMPLEX", payment
 * processors prefix themselves onto the real merchant ("OMISE*OMISE *DTAC
 * AUTOPABANGKOK"), and the city is glued to the end. Grouping raw strings
 * therefore scatters one merchant across several rows and hides what is
 * actually worth writing a rule for.
 */
import type { Transaction } from './types'

/** Cities Thai acquirers append to the merchant name, often without a space. */
const CITIES = [
  'BANGKOK', 'NONTHABURI', 'SAMUTPRAKAN', 'SAMUT PRAKAN', 'PATHUMTHANI', 'PATHUM THANI',
  'CHIANGMAI', 'CHIANG MAI', 'CHONBURI', 'PHUKET', 'KHONKAEN', 'KHON KAEN', 'RAYONG',
  'NAKHONPATHOM', 'NAKHON PATHOM', 'SURATTHANI', 'SURAT THANI', 'HATYAI', 'HAT YAI',
  'UDONTHANI', 'UDON THANI', 'AYUTTHAYA', 'PATTAYA', 'THAILAND', 'TH',
]

/**
 * Payment processors that prefix the real merchant, separated by "*".
 * The segment after the last "*" is the merchant worth categorising.
 */
const PROCESSOR_RE = /^(?:[A-Z0-9._]*\*\s*)+/i

/** Terminal and store codes that prefix a merchant, e.g. "PZ2124-" or "CB-055". */
const STORE_CODE_RE = /^(?:[A-Z]{2,4}[-_]?\d{2,6}[-_\s]+|\d{3,6}[-_\s]+)/i

export interface MerchantGroup {
  /** The normalised name, used for grouping and as a suggested rule pattern. */
  merchant: string
  /** One full description, so the original is still visible. */
  example: string
  count: number
  total: number
  lastSeen: string
  transactionIds: string[]
}

/**
 * Reduce a statement description to a merchant name suitable for a rule.
 * Returns an empty string when nothing useful survives.
 */
export function merchantKey(description: string): string {
  let s = description.toUpperCase().trim()

  // Keep only what follows the last processor prefix: the real merchant.
  s = s.replace(PROCESSOR_RE, '')
  s = s.replace(STORE_CODE_RE, '')

  // Instalment plans append the purchase date, e.g. "…C.WESTVILLE 03/10".
  s = s.replace(/\s+\d{1,2}[/-]\d{1,2}\s*$/, '')

  // Cities are often glued on with no separator, and a merchant whose own name
  // ends in a city gets it twice ("BINCHO ONE BANGKOK BANGKOK"), so strip
  // repeatedly rather than once — but keep at least the merchant's own name.
  for (let i = 0; i < 2; i++) {
    const before = s
    for (const city of CITIES) {
      const re = new RegExp(`\\s*${city}\\s*$`)
      if (re.test(s)) {
        const stripped = s.replace(re, '').trim()
        if (stripped.length >= 3) s = stripped
        break
      }
    }
    if (s === before) break
  }

  s = s
    // Branch and reference numbers at the end carry no meaning for a rule.
    .replace(/[\s-]+\d{3,}\s*$/, '')
    .replace(/\s*[-/#]\s*\d{1,4}\s*$/, '')
    .replace(/[^A-Z0-9&.'\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // A key of one or two characters would match far too much to be a rule.
  return s.length >= 3 ? s : description.toUpperCase().trim()
}

/** Group uncategorised spending by merchant, biggest spend first. */
export function unmatchedMerchants(transactions: Transaction[]): MerchantGroup[] {
  const groups = new Map<string, MerchantGroup>()

  for (const t of transactions) {
    // Credits are refunds and payments, not merchants worth a rule.
    if (t.category !== 'Uncategorized' || t.amount <= 0) continue

    const merchant = merchantKey(t.description)
    const existing = groups.get(merchant)
    if (existing) {
      existing.count += 1
      existing.total += t.amount
      existing.transactionIds.push(t.id)
      if (t.date > existing.lastSeen) existing.lastSeen = t.date
    } else {
      groups.set(merchant, {
        merchant,
        example: t.description,
        count: 1,
        total: t.amount,
        lastSeen: t.date,
        transactionIds: [t.id],
      })
    }
  }

  return [...groups.values()].sort((a, b) => b.total - a.total)
}

/** A Markdown table of the backlog, for pasting somewhere it can be worked on. */
export function backlogAsMarkdown(groups: MerchantGroup[]): string {
  if (!groups.length) return 'No unmatched merchants — everything is categorised.'

  const rows = groups.map(
    (g) =>
      `| ${g.merchant} | ${g.count} | ${g.total.toFixed(2)} | ${g.lastSeen} | ${g.example.replace(/\|/g, '/')} |`,
  )
  return [
    '| Merchant | Times | Total THB | Last seen | Example description |',
    '| --- | ---: | ---: | --- | --- |',
    ...rows,
  ].join('\n')
}
