import { useMemo } from 'react'
import { AUTO_MATCH_THRESHOLD, findMatches } from '../lib/matching'
import { formatMoney } from '../lib/money'
import { formatDate } from '../lib/thaiDate'
import type { AppStore } from '../lib/store'
import type { MatchCandidate } from '../lib/types'

export function Matches({ store }: { store: AppStore }) {
  const { transactions, orders } = store

  const unmatchedOrders = useMemo(() => orders.filter((o) => !o.matchedTransactionId), [orders])
  const unmatchedTransactions = useMemo(
    () => transactions.filter((t) => !t.matchedOrderId),
    [transactions],
  )

  const candidates = useMemo(
    () => findMatches(unmatchedTransactions, unmatchedOrders),
    [unmatchedTransactions, unmatchedOrders],
  )

  const confirmed = useMemo(
    () =>
      orders
        .filter((o) => o.matchedTransactionId)
        .map((o) => ({ order: o, transaction: transactions.find((t) => t.id === o.matchedTransactionId) }))
        .filter((pair) => pair.transaction),
    [orders, transactions],
  )

  function accept(pairs: MatchCandidate[]) {
    if (!pairs.length) return
    const orderByTransaction = new Map(pairs.map((p) => [p.transaction.id, p.order.id]))
    const transactionByOrder = new Map(pairs.map((p) => [p.order.id, p.transaction.id]))

    store.commit({
      transactions: transactions.map((t) =>
        orderByTransaction.has(t.id)
          ? {
              ...t,
              matchedOrderId: orderByTransaction.get(t.id),
              // The order knows what was actually bought; the statement only
              // knows the payment processor, so the order wins on description.
              description: enrich(t.description, pairs.find((p) => p.transaction.id === t.id)!),
            }
          : t,
      ),
      orders: orders.map((o) =>
        transactionByOrder.has(o.id) ? { ...o, matchedTransactionId: transactionByOrder.get(o.id) } : o,
      ),
    })
  }

  function unmatch(orderId: string) {
    const order = orders.find((o) => o.id === orderId)
    store.commit({
      orders: orders.map((o) => (o.id === orderId ? { ...o, matchedTransactionId: undefined } : o)),
      transactions: transactions.map((t) =>
        t.id === order?.matchedTransactionId ? { ...t, matchedOrderId: undefined } : t,
      ),
    })
  }

  const strong = candidates.filter((c) => c.score >= AUTO_MATCH_THRESHOLD)
  const weak = candidates.filter((c) => c.score < AUTO_MATCH_THRESHOLD)

  if (!orders.length) {
    return (
      <div className="card">
        <div className="empty">
          <p style={{ margin: 0, fontWeight: 600 }}>No marketplace orders yet</p>
          <p className="small" style={{ margin: '6px 0 0', maxWidth: 440, marginInline: 'auto' }}>
            Import Shopee or Grab order screenshots (or a CSV export) on the Import tab. This page then pairs them
            with the matching card charges, so a line reading “SHOPEE” turns into what you actually bought.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Suggested matches</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Matched on amount first, then how close the dates are, then whether the platform name shows up on the
              statement line.
            </p>
          </div>
          {strong.length > 0 && (
            <button className="primary" onClick={() => accept(strong)}>
              Accept {strong.length} strong match{strong.length === 1 ? '' : 'es'}
            </button>
          )}
        </div>

        {!candidates.length ? (
          <div className="empty">
            {!transactions.length ? (
              <>
                <p style={{ margin: 0, fontWeight: 600 }}>No statement imported here yet</p>
                <p className="small" style={{ margin: '6px 0 0', maxWidth: 460, marginInline: 'auto' }}>
                  {unmatchedOrders.length} order{unmatchedOrders.length === 1 ? '' : 's'} are waiting, but there are
                  no card charges on this device to pair them with. Import the statement these orders were paid on,
                  or move the orders to where it already is — Storage → Download backup.
                </p>
              </>
            ) : unmatchedOrders.length ? (
              `No candidates found for ${unmatchedOrders.length} unmatched order${unmatchedOrders.length === 1 ? '' : 's'}. The card charge may not be imported yet, or it posted more than a week later.`
            ) : (
              'Every order is matched.'
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Statement line</th>
                  <th className="num">Amount</th>
                  <th>Why</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...strong, ...weak].map((c) => (
                  <tr key={`${c.transaction.id}-${c.order.id}`}>
                    <td>
                      <span className="pill">{c.order.platform}</span>{' '}
                      <span className="small">{c.order.description.slice(0, 50)}</span>
                      <div className="small muted">{formatDate(c.order.date)}</div>
                    </td>
                    <td>
                      {c.transaction.description.slice(0, 50)}
                      <div className="small muted">{formatDate(c.transaction.date)}</div>
                    </td>
                    <td className="num">{formatMoney(c.transaction.amount)}</td>
                    <td className="small secondary">{c.reasons.join(' · ')}</td>
                    <td>
                      <button className="small" onClick={() => accept([c])}>
                        Match
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Imported orders ({orders.length})</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              {formatMoney(orders.reduce((s, o) => s + o.amount, 0))} across every order read from your screenshots.
              Worth a glance after an import — OCR can misread an amount, and a wrong one here will never match.
            </p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="stacked">
            <thead>
              <tr>
                <th>Date</th>
                <th>Order</th>
                <th>Platform</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...orders]
                // Unmatched first: those are the ones still needing attention.
                .sort((a, b) =>
                  Number(Boolean(a.matchedTransactionId)) - Number(Boolean(b.matchedTransactionId)) ||
                  b.date.localeCompare(a.date),
                )
                .map((order) => (
                  <tr key={order.id}>
                    <td className="mono small" style={{ whiteSpace: 'nowrap' }}>
                      {order.date ? formatDate(order.date) : <span className="muted">no date</span>}
                    </td>
                    <td>
                      {order.description}
                      <div className="small muted">
                        {order.sourceFile}
                        {order.orderRef && ` · ${order.orderRef}`}
                        {order.matchedTransactionId && ' · matched'}
                      </div>
                    </td>
                    <td>
                      <span className="pill">{order.platform}</span>
                    </td>
                    <td className="num" style={{ fontWeight: 500 }}>
                      {formatMoney(order.amount)}
                    </td>
                    <td>
                      <button
                        className="ghost small"
                        title="Remove this order"
                        onClick={() =>
                          store.commit({
                            orders: orders.filter((o) => o.id !== order.id),
                            transactions: transactions.map((t) =>
                              t.matchedOrderId === order.id ? { ...t, matchedOrderId: undefined } : t,
                            ),
                          })
                        }
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {confirmed.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Matched ({confirmed.length})</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Statement line</th>
                  <th className="num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {confirmed.map(({ order, transaction }) => (
                  <tr key={order.id}>
                    <td>
                      <span className="pill">{order.platform}</span>{' '}
                      <span className="small">{order.description.slice(0, 50)}</span>
                    </td>
                    <td className="small">{transaction!.description.slice(0, 60)}</td>
                    <td className="num">{formatMoney(transaction!.amount)}</td>
                    <td>
                      <button className="ghost small" onClick={() => unmatch(order.id)}>
                        Unmatch
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

/** Append the order's description to the statement line, once. */
function enrich(description: string, match: MatchCandidate): string {
  const detail = match.order.description.trim().slice(0, 60)
  if (!detail || description.includes(detail)) return description
  return `${description} — ${detail}`
}
