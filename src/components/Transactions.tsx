import { useMemo, useState } from 'react'
import { formatMoney } from '../lib/money'
import { formatDate } from '../lib/thaiDate'
import { CATEGORIES, type Category, type Transaction } from '../lib/types'
import type { AppStore } from '../lib/store'

type SortKey = 'date' | 'amount' | 'description' | 'category'

export function Transactions({ store }: { store: AppStore }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category | 'all' | 'flagged'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [ascending, setAscending] = useState(false)

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase()
    const filtered = store.transactions.filter((t) => {
      if (q && !t.description.toUpperCase().includes(q) && !t.sourceFile.toUpperCase().includes(q)) return false
      if (category === 'flagged') return t.confidence < 0.7 || t.category === 'Uncategorized'
      if (category !== 'all' && t.category !== category) return false
      return true
    })
    const direction = ascending ? 1 : -1
    return filtered.sort((a, b) => {
      if (sortKey === 'amount') return (a.amount - b.amount) * direction
      return String(a[sortKey]).localeCompare(String(b[sortKey])) * direction
    })
  }, [store.transactions, query, category, sortKey, ascending])

  const total = rows.reduce((s, t) => s + Math.max(0, t.amount), 0)

  function setCategoryFor(id: string, next: Category) {
    store.commit({
      transactions: store.transactions.map((t) =>
        // Picking a category by hand locks it, so re-running rules respects it.
        t.id === id ? { ...t, category: next, categoryLocked: true } : t,
      ),
    })
  }

  function remove(id: string) {
    store.commit({ transactions: store.transactions.filter((t) => t.id !== id) })
  }

  function sortBy(key: SortKey) {
    if (key === sortKey) setAscending((v) => !v)
    else {
      setSortKey(key)
      setAscending(key === 'description' || key === 'category')
    }
  }

  const header = (key: SortKey, label: string, numeric = false) => (
    <th className={numeric ? 'num' : undefined}>
      <button
        className="ghost small"
        style={{ padding: '2px 4px', fontWeight: 600 }}
        onClick={() => sortBy(key)}
      >
        {label}
        {sortKey === key ? (ascending ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  )

  return (
    <div className="card">
      <div className="card-head">
        <h2>
          {rows.length} transaction{rows.length === 1 ? '' : 's'}{' '}
          <span className="muted small" style={{ fontWeight: 400 }}>
            · {formatMoney(total)} spend
          </span>
        </h2>
        <div className="row">
          <input
            type="search"
            placeholder="Search description or file"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ minWidth: 200 }}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value as Category | 'all' | 'flagged')}>
            <option value="all">All categories</option>
            <option value="flagged">Needs a look</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!rows.length ? (
        <div className="empty">Nothing matches that filter.</div>
      ) : (
        <div className="table-wrap">
          <table className="stacked">
            <thead>
              <tr>
                {header('date', 'Date')}
                {header('description', 'Description')}
                {header('category', 'Category')}
                {header('amount', 'Amount', true)}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <Row key={t.id} transaction={t} onCategory={setCategoryFor} onRemove={remove} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="small muted" style={{ margin: '12px 0 0' }}>
        A dot marks a row the parser was unsure about — worth checking against the statement. Changing a category here
        keeps it fixed, even if you re-run the rules later.
      </p>
    </div>
  )
}

function Row({
  transaction,
  onCategory,
  onRemove,
}: {
  transaction: Transaction
  onCategory: (id: string, c: Category) => void
  onRemove: (id: string) => void
}) {
  const isCredit = transaction.amount < 0
  return (
    <tr>
      <td className="mono small" style={{ whiteSpace: 'nowrap' }}>
        {formatDate(transaction.date)}
      </td>
      <td>
        {transaction.confidence < 0.7 && <span className="flag" title="Low confidence — please check" />}
        {transaction.description}
        <div className="small muted">
          {transaction.sourceFile}
          {transaction.foreignCurrency && ` · ${transaction.foreignCurrency}`}
          {transaction.matchedOrderId && ' · matched to an order'}
        </div>
      </td>
      <td>
        <select
          value={transaction.category}
          onChange={(e) => onCategory(transaction.id, e.target.value as Category)}
          style={{ fontSize: 13 }}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </td>
      <td className="num" style={{ color: isCredit ? 'var(--good)' : undefined, fontWeight: 500 }}>
        {isCredit ? '+' : ''}
        {formatMoney(Math.abs(transaction.amount))}
      </td>
      <td>
        <button className="ghost small" title="Delete this row" onClick={() => onRemove(transaction.id)}>
          ✕
        </button>
      </td>
    </tr>
  )
}
