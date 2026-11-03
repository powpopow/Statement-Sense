/**
 * Does each statement pick up where the last one left off?
 *
 * A card's opening balance is the previous statement's closing balance. So for
 * two consecutive statements of one card, the earlier closing must equal the
 * later opening. That proves the later rows even when the bank prints no
 * previous balance (ttb): the opening is then worked out as closing − activity.
 */
import type { StatementRecord } from './types'

export interface ChainLink {
  card: string
  from: StatementRecord
  to: StatementRecord
  status: 'matches' | 'break' | 'gap'
  /** Printed or worked-out opening minus the earlier closing. */
  difference?: number
  detail: string
}

const round2 = (n: number) => Math.round(n * 100) / 100
const baht = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

/** Statements are about a month apart; further than this and one is probably missing. */
const MAX_GAP_DAYS = 50

export const openingOf = (r: StatementRecord) => r.opening ?? round2(r.closing - r.net)

/** Merge a new record in, unless this exact statement is already there. */
export function addStatement(records: StatementRecord[], record: StatementRecord): StatementRecord[] {
  return records.some((r) => r.id === record.id) ? records : [...records, record]
}

export const cardLabel = (r: Pick<StatementRecord, 'bank' | 'last4'>) => `${r.bank.toUpperCase()} ••${r.last4}`

export function chainLinks(records: StatementRecord[]): ChainLink[] {
  const byCard = new Map<string, StatementRecord[]>()
  for (const r of records) byCard.set(`${r.bank}|${r.last4}`, [...(byCard.get(`${r.bank}|${r.last4}`) ?? []), r])

  const links: ChainLink[] = []
  for (const list of byCard.values()) {
    list.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
    for (let i = 1; i < list.length; i++) {
      const from = list[i - 1]
      const to = list[i]
      const card = cardLabel(to)
      if (days(from.periodEnd, to.periodEnd) > MAX_GAP_DAYS) {
        links.push({ card, from, to, status: 'gap', detail: `A statement between ${from.periodEnd} and ${to.periodEnd} looks to be missing.` })
        continue
      }
      const opening = openingOf(to)
      const difference = round2(opening - from.closing)
      links.push(
        Math.abs(difference) < 0.01
          ? { card, from, to, status: 'matches', difference: 0, detail: `Opens at ${baht(opening)}, where the previous statement closed.` }
          : {
              card,
              from,
              to,
              status: 'break',
              difference,
              detail: `The previous statement closed at ${baht(from.closing)} but this one opens at ${baht(opening)} (${baht(Math.abs(difference))} ${difference > 0 ? 'more' : 'less'}). A row in one of them may be misread or missing.`,
            },
      )
    }
  }
  return links.sort((a, b) => b.to.periodEnd.localeCompare(a.to.periodEnd))
}
