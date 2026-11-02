import { useMemo, useState } from 'react'
import { formatMoney } from '../lib/money'
import type { Transaction } from '../lib/types'
import { BarChart, ColumnChart, type Datum } from './charts'

/** Fixed slot per category, so a category keeps its colour as filters change. */
const SERIES_SLOTS = 8
const categoryColor = (index: number) =>
  index < SERIES_SLOTS ? `var(--series-${index + 1})` : 'var(--border-strong)'

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  })
  // "Sep 26" would read as the 26th of September, so mark the year explicitly.
  return `${name} ’${String(y).slice(2)}`
}

export function Summary({ transactions }: { transactions: Transaction[] }) {
  const months = useMemo(
    () => [...new Set(transactions.map((t) => t.date.slice(0, 7)))].sort().reverse(),
    [transactions],
  )
  const [month, setMonth] = useState<string>('all')

  const scoped = useMemo(
    () => (month === 'all' ? transactions : transactions.filter((t) => t.date.startsWith(month))),
    [transactions, month],
  )

  const spend = scoped.filter((t) => t.amount > 0)
  const income = scoped.filter((t) => t.amount < 0)
  const totalSpend = spend.reduce((s, t) => s + t.amount, 0)
  const totalIncome = income.reduce((s, t) => s - t.amount, 0)
  const flagged = scoped.filter((t) => t.confidence < 0.7).length
  const uncategorized = spend.filter((t) => t.category === 'Uncategorized')

  const byCategory = useMemo<Datum[]>(() => {
    const totals = new Map<string, { value: number; count: number }>()
    for (const t of spend) {
      const entry = totals.get(t.category) ?? { value: 0, count: 0 }
      entry.value += t.amount
      entry.count += 1
      totals.set(t.category, entry)
    }
    const sorted = [...totals.entries()].sort((a, b) => b[1].value - a[1].value)
    // Past eight slots the palette stops being distinguishable, so fold the
    // tail into one bar rather than inventing colours.
    const head = sorted.slice(0, SERIES_SLOTS)
    const tail = sorted.slice(SERIES_SLOTS)
    const data: Datum[] = head.map(([label, entry], i) => ({
      label,
      value: Math.round(entry.value),
      color: categoryColor(i),
      detail: `${entry.count} transaction${entry.count === 1 ? '' : 's'} · ${
        totalSpend ? Math.round((entry.value / totalSpend) * 100) : 0
      }% of spend`,
    }))
    if (tail.length) {
      const value = tail.reduce((s, [, e]) => s + e.value, 0)
      data.push({
        label: `Other (${tail.length})`,
        value: Math.round(value),
        color: 'var(--border-strong)',
        detail: tail.map(([label]) => label).join(', '),
      })
    }
    return data
  }, [spend, totalSpend])

  const byMonth = useMemo<Datum[]>(() => {
    const totals = new Map<string, number>()
    for (const t of transactions.filter((x) => x.amount > 0)) {
      const key = t.date.slice(0, 7)
      totals.set(key, (totals.get(key) ?? 0) + t.amount)
    }
    return [...totals.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([key, value]) => ({
        label: monthLabel(key),
        value: Math.round(value),
        color: 'var(--series-1)',
        detail: key === month ? 'Currently selected' : undefined,
      }))
  }, [transactions, month])

  const topMerchants = useMemo(() => {
    const totals = new Map<string, { value: number; count: number }>()
    for (const t of spend) {
      // Collapse the trailing reference numbers banks append to merchant names.
      const key = t.description.replace(/\s*\d{4,}\s*$/, '').slice(0, 44).trim() || t.description
      const entry = totals.get(key) ?? { value: 0, count: 0 }
      entry.value += t.amount
      entry.count += 1
      totals.set(key, entry)
    }
    return [...totals.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 8)
  }, [spend])

  if (!transactions.length) {
    return (
      <div className="card">
        <div className="empty">
          <p style={{ margin: 0, fontWeight: 600 }}>Nothing imported yet</p>
          <p className="small" style={{ margin: '6px 0 0' }}>
            Upload a statement on the Import tab and the summary will appear here.
          </p>
        </div>
      </div>
    )
  }

  const dayCount = month === 'all' ? null : new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()

  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        <label className="small secondary" htmlFor="month">
          Period
        </label>
        <select id="month" value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="all">All time ({transactions.length} transactions)</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>

      <div className="tiles" style={{ marginBottom: 16 }}>
        <div className="tile">
          <div className="label">Total spend</div>
          <div className="value">{formatMoney(totalSpend)}</div>
          <div className="sub">
            {spend.length} transaction{spend.length === 1 ? '' : 's'}
            {dayCount && ` · ${formatMoney(totalSpend / dayCount)} a day`}
          </div>
        </div>
        <div className="tile">
          <div className="label">Money in</div>
          <div className="value">{formatMoney(totalIncome)}</div>
          <div className="sub">{income.length} credits, refunds and transfers in</div>
        </div>
        <div className="tile">
          <div className="label">Net</div>
          <div className="value" style={{ color: totalIncome - totalSpend >= 0 ? 'var(--good)' : 'var(--critical)' }}>
            {formatMoney(totalIncome - totalSpend)}
          </div>
          <div className="sub">{month === 'all' ? 'Across everything imported' : monthLabel(month)}</div>
        </div>
        <div className="tile">
          <div className="label">Needs a look</div>
          <div className="value">{flagged + uncategorized.length}</div>
          <div className="sub">
            {flagged} low-confidence row{flagged === 1 ? '' : 's'} · {uncategorized.length} uncategorized
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Where the money went</h2>
          <span className="small muted">Spending only — credits are excluded</span>
        </div>
        <BarChart data={byCategory} format={(n) => formatMoney(n)} />
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card" style={{ marginTop: 0 }}>
          <div className="card-head">
            <h2>Monthly spend</h2>
            <span className="small muted">Last 12 months</span>
          </div>
          <ColumnChart data={byMonth} format={(n) => formatMoney(n)} />
        </div>

        <div className="card" style={{ marginTop: 0 }}>
          <div className="card-head">
            <h2>Top merchants</h2>
          </div>
          <table>
            <tbody>
              {topMerchants.map(([name, entry]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="num muted small">{entry.count}×</td>
                  <td className="num">{formatMoney(entry.value)}</td>
                </tr>
              ))}
              {!topMerchants.length && (
                <tr>
                  <td className="muted small">No spending in this period.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
