import { useMemo, useState } from 'react'
import { applyRules, defaultRules } from '../lib/categorize'
import { backlogAsMarkdown, unmatchedMerchants } from '../lib/suggest'
import { formatMoney } from '../lib/money'
import { formatDate } from '../lib/thaiDate'
import { CATEGORIES, type Category, type Rule } from '../lib/types'
import type { AppStore } from '../lib/store'

export function Rules({ store }: { store: AppStore }) {
  const [pattern, setPattern] = useState('')
  const [category, setCategory] = useState<Category>('Food & Drink')
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase()
    const sorted = [...store.rules].sort(
      (a, b) => a.category.localeCompare(b.category) || b.priority - a.priority,
    )
    return q ? sorted.filter((r) => r.pattern.toUpperCase().includes(q) || r.category.toUpperCase().includes(q)) : sorted
  }, [store.rules, query])

  /** Count how many current transactions each rule would claim. */
  const hitCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of store.transactions) {
      for (const r of store.rules) {
        if (!r.enabled) continue
        const hit =
          r.matchType === 'regex'
            ? safeRegex(r.pattern)?.test(t.description)
            : t.description.toUpperCase().includes(r.pattern.toUpperCase())
        if (hit) counts.set(r.id, (counts.get(r.id) ?? 0) + 1)
      }
    }
    return counts
  }, [store.rules, store.transactions])

  function save(rules: Rule[]) {
    store.commit({ rules, transactions: applyRules(store.transactions, rules) })
  }

  function add() {
    const trimmed = pattern.trim()
    if (!trimmed) return
    save([
      ...store.rules,
      {
        id: `rule-${Date.now().toString(36)}`,
        pattern: trimmed,
        matchType: 'contains',
        category,
        // User rules outrank the seeds, which are scored by pattern length.
        priority: 1000,
        enabled: true,
      },
    ])
    setPattern('')
  }

  const unmatched = useMemo(() => unmatchedMerchants(store.transactions), [store.transactions])
  const unmatchedTotal = unmatched.reduce((s, g) => s + g.total, 0)

  async function copyBacklog() {
    try {
      await navigator.clipboard.writeText(backlogAsMarkdown(unmatched))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Categorisation rules</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              The first rule that matches a description wins, highest priority first. These live in the Rules tab of
              your Google Sheet, so you can also edit them there.
            </p>
          </div>
          <button onClick={() => save(defaultRules())}>Reset to defaults</button>
        </div>

        <div className="row" style={{ marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Text to look for, e.g. STARBUCKS"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            style={{ minWidth: 240 }}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button className="primary" onClick={add} disabled={!pattern.trim()}>
            Add rule
          </button>
          <button onClick={() => save(store.rules)}>Re-run on all transactions</button>
        </div>

        <input
          type="search"
          placeholder={`Filter ${store.rules.length} rules`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: '100%', marginBottom: 12 }}
        />

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pattern</th>
                <th>Match</th>
                <th>Category</th>
                <th className="num">Hits</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((rule) => (
                <tr key={rule.id} style={{ opacity: rule.enabled ? 1 : 0.5 }}>
                  <td className="mono small">{rule.pattern}</td>
                  <td className="small muted">{rule.matchType}</td>
                  <td>
                    <select
                      value={rule.category}
                      style={{ fontSize: 13 }}
                      onChange={(e) =>
                        save(
                          store.rules.map((r) =>
                            r.id === rule.id ? { ...r, category: e.target.value as Category } : r,
                          ),
                        )
                      }
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num small muted">{hitCounts.get(rule.id) ?? 0}</td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                      <button
                        className="ghost small"
                        onClick={() =>
                          save(store.rules.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)))
                        }
                      >
                        {rule.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="ghost small"
                        onClick={() => save(store.rules.filter((r) => r.id !== rule.id))}
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {unmatched.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Unmatched merchants ({unmatched.length})</h2>
              <p className="small muted" style={{ margin: '4px 0 0' }}>
                {formatMoney(unmatchedTotal)} of spending with no rule, biggest first. Names are normalised —
                processor prefixes, store codes and city suffixes removed — so one shop groups into one row.
              </p>
            </div>
            <button onClick={() => void copyBacklog()}>{copied ? 'Copied ✓' : 'Copy list'}</button>
          </div>

          <div className="table-wrap" style={{ maxHeight: 360 }}>
            <table>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th className="num">Times</th>
                  <th className="num">Total</th>
                  <th>Last seen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {unmatched.map((group) => (
                  <tr key={group.merchant}>
                    <td>
                      {group.merchant}
                      {group.example.toUpperCase() !== group.merchant && (
                        <div className="small muted">{group.example}</div>
                      )}
                    </td>
                    <td className="num small muted">{group.count}</td>
                    <td className="num">{formatMoney(group.total)}</td>
                    <td className="small muted">{formatDate(group.lastSeen)}</td>
                    <td style={{ width: 120 }}>
                      <button className="ghost small" onClick={() => setPattern(group.merchant)}>
                        Use as pattern
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="small muted" style={{ margin: '12px 0 0' }}>
            “Copy list” puts this table on the clipboard as Markdown, so it can be pasted somewhere the rules get
            written properly. These rows also stay in your sheet with the category “Uncategorized”, so the backlog
            survives whatever you do here.
          </p>
        </div>
      )}
    </>
  )
}

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}
