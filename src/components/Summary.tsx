import { useMemo, useState } from 'react'
import { formatMoney } from '../lib/money'
import { ME, ownerOf, peopleFrom } from '../lib/people'
import { cashByMonth, cashFor, currentMonth, isMonth } from '../lib/cash'
import { merchantLabel, netBy, totalsOf, withCashByMonth, withCashGroup } from '../lib/summary'
import type { CashEntry, Transaction } from '../lib/types'
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

const EVERYONE = '__everyone__'

interface SummaryProps {
  transactions: Transaction[]
  cash: CashEntry[]
  /** Save (or, with null, clear) the cash stated for a month. */
  onCash: (month: string, amount: number | null) => void
}

export function Summary({ transactions: all, cash, onCash }: SummaryProps) {
  // Whose spending to show. Yours by default, so a charge you paid for your
  // mum doesn't inflate your own totals. Everything below works on this list.
  const [whose, setWhose] = useState<string>(ME)
  const people = useMemo(() => peopleFrom(all, []), [all])
  const transactions = useMemo(
    () => (whose === EVERYONE ? all : all.filter((t) => ownerOf(t) === whose)),
    [all, whose],
  )

  const months = useMemo(
    () => [...new Set(transactions.map((t) => t.date.slice(0, 7)))].sort().reverse(),
    [transactions],
  )
  const [month, setMonth] = useState<string>('all')

  const scoped = useMemo(
    () => (month === 'all' ? transactions : transactions.filter((t) => t.date.startsWith(month))),
    [transactions, month],
  )

  // Spending is purchases less refunds; rewards sit beside it and card payments
  // are neither (see lib/summary.ts).
  const totals = useMemo(() => totalsOf(scoped), [scoped])
  // Cash is the user's own allowance, so it counts for Me and Everyone only.
  const includeCash = whose === ME || whose === EVERYONE
  const cashSpend = includeCash ? cashFor(cash, month) : 0
  const cashMonths = includeCash ? (month === 'all' ? cash.length : cashSpend > 0 ? 1 : 0) : 0
  const cardSpend = totals.net
  const totalSpend = cardSpend + cashSpend
  const cashMap = useMemo(() => (includeCash ? cashByMonth(cash) : new Map<string, number>()), [cash, includeCash])
  const flagged = scoped.filter((t) => t.confidence < 0.7).length
  const uncategorized = scoped.filter((t) => t.amount > 0 && t.category === 'Uncategorized')

  const byCategory = useMemo<Datum[]>(() => {
    const sorted = withCashGroup(netBy(scoped, (t) => t.category), cashSpend, cashMonths).map((g) => [g.key, g] as const)
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
  }, [scoped, totalSpend, cashSpend, cashMonths])

  const byMonth = useMemo<Datum[]>(() => {
    return withCashByMonth(netBy(transactions, (t) => t.date.slice(0, 7)), cashMap)
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-12)
      .map(({ key, value }) => ({
        label: monthLabel(key),
        value: Math.round(value),
        color: 'var(--series-1)',
        detail: key === month ? 'Currently selected' : undefined,
      }))
  }, [transactions, month, cashMap])

  const topMerchants = useMemo(() => {
    // Net of refunds, so points redeemed against a merchant offset that merchant.
    return netBy(scoped, (t) => merchantLabel(t.description))
      .slice(0, 8)
      .map((g) => [g.key, { value: g.value, count: g.count }] as const)
  }, [scoped])

  // What you paid for other people, in the chosen period: the amount to ask for.
  const forOthers = useMemo(() => {
    const totals = new Map<string, number>()
    for (const t of all) {
      const owner = ownerOf(t)
      if (t.amount <= 0 || owner === ME) continue
      if (month !== 'all' && !t.date.startsWith(month)) continue
      totals.set(owner, (totals.get(owner) ?? 0) + t.amount)
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1])
  }, [all, month])

  if (!all.length) {
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
        <label className="small secondary" htmlFor="whose">
          Whose
        </label>
        <select id="whose" value={whose} onChange={(e) => setWhose(e.target.value)}>
          {people.map((p) => (
            <option key={p} value={p}>
              {p === ME ? 'Mine' : `${p}’s`}
            </option>
          ))}
          <option value={EVERYONE}>Everyone</option>
        </select>
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
          <div className="label">Spend</div>
          <div className="value">{formatMoney(totalSpend)}</div>
          <div className="sub">
            {totals.purchaseCount} purchase{totals.purchaseCount === 1 ? '' : 's'}
            {totals.refunded > 0 && ` · after ${formatMoney(totals.refunded)} refunded`}
            {cashSpend > 0 && ` · cards ${formatMoney(cardSpend)} + cash ${formatMoney(cashSpend)}`}
            {dayCount && ` · ${formatMoney(totalSpend / dayCount)} a day`}
          </div>
        </div>
        <div className="tile">
          <div className="label">Rewards</div>
          <div className="value">{formatMoney(totals.rewards)}</div>
          <div className="sub">
            {totals.rewardCount} cashback or reward credit{totals.rewardCount === 1 ? '' : 's'}
          </div>
        </div>
        <div className="tile">
          <div className="label">Paid to your cards</div>
          <div className="value">{formatMoney(totals.payments)}</div>
          <div className="sub">
            {totals.paymentCount} payment{totals.paymentCount === 1 ? '' : 's'} · not spending, not income
          </div>
        </div>
        {whose === ME && forOthers.length > 0 && (
          <div className="tile">
            <div className="label">Paid for others</div>
            <div className="value">{formatMoney(forOthers.reduce((s, [, v]) => s + v, 0))}</div>
            <div className="sub">{forOthers.map(([name, v]) => `${name} ${formatMoney(v)}`).join(' · ')}</div>
          </div>
        )}
        <div className="tile">
          <div className="label">Needs a look</div>
          <div className="value">{flagged + uncategorized.length}</div>
          <div className="sub">
            {flagged} low-confidence row{flagged === 1 ? '' : 's'} · {uncategorized.length} uncategorized
          </div>
        </div>
      </div>

      {includeCash && <CashPanel cash={cash} onCash={onCash} />}

      <div className="card">
        <div className="card-head">
          <h2>Where the money went</h2>
          <span className="small muted">After refunds — card payments and rewards are not spending</span>
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

/** Log the cash moved to your cash account for any month, and edit or clear earlier ones. */
function CashPanel({ cash, onCash }: { cash: CashEntry[]; onCash: SummaryProps['onCash'] }) {
  const [month, setMonth] = useState(currentMonth())
  const [amount, setAmount] = useState('')
  const valid = isMonth(month) && Number(amount) > 0
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h2>Cash</h2>
        <span className="small muted">Cash moved to your cash account; counted as personal spending</span>
      </div>
      <form
        className="row"
        style={{ flexWrap: 'wrap', gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onCash(month, Number(amount))
          setAmount('')
        }}
      >
        <label className="small secondary">
          Month <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <label className="small secondary">
          Amount{' '}
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder="15000"
            style={{ width: 110 }}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <button type="submit" disabled={!valid}>
          {cashFor(cash, month) ? 'Replace' : 'Add'}
        </button>
      </form>
      {cash.length > 0 && (
        <table style={{ marginTop: 12 }}>
          <tbody>
            {cash.map((c) => (
              <tr key={c.month}>
                <td>{monthLabel(c.month)}</td>
                <td className="num">{formatMoney(c.amount)}</td>
                <td className="num">
                  <button type="button" onClick={() => onCash(c.month, null)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
