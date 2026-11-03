import { useEffect, useState } from 'react'
import { Upload } from './components/Upload'
import { Summary } from './components/Summary'
import { setCashEntry } from './lib/cash'
import { Transactions } from './components/Transactions'
import { Matches } from './components/Matches'
import { Rules } from './components/Rules'
import { SheetPanel } from './components/SheetPanel'
import { useAppStore } from './lib/store'

type Tab = 'import' | 'summary' | 'transactions' | 'matches' | 'rules' | 'storage'

const TABS: { id: Tab; label: string }[] = [
  { id: 'import', label: 'Import' },
  { id: 'summary', label: 'Summary' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'matches', label: 'Order matching' },
  { id: 'rules', label: 'Rules' },
  { id: 'storage', label: 'Storage' },
]

type Theme = 'light' | 'dark' | 'system'

export default function App() {
  const store = useAppStore()
  const [tab, setTab] = useState<Tab>('import')
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('statement-sense.theme') as Theme) ?? 'system',
  )

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('statement-sense.theme', theme)
  }, [theme])

  const syncLabel =
    store.sync.status === 'ready'
      ? 'Sheet connected'
      : store.sync.status === 'syncing'
        ? 'Syncing…'
        : store.sync.status === 'error'
          ? 'Sync problem'
          : 'Local only'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Statement Sense</h1>
          <span>Thai bank statements → categorised spending</span>
        </div>
        <div className="row">
          <button className="pill" onClick={() => setTab('storage')} title="Storage settings">
            <span
              className="swatch"
              style={{
                background:
                  store.sync.status === 'ready'
                    ? 'var(--good)'
                    : store.sync.status === 'error'
                      ? 'var(--critical)'
                      : 'var(--border-strong)',
                borderRadius: '50%',
              }}
            />
            {syncLabel}
          </button>
          <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Theme">
            <option value="system">System theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'transactions' && store.transactions.length > 0 && (
              <span className="muted"> ({store.transactions.length})</span>
            )}
            {t.id === 'matches' && store.orders.length > 0 && <span className="muted"> ({store.orders.length})</span>}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'import' && <Upload store={store} onDone={() => setTab('summary')} />}
        {tab === 'summary' && <Summary
            transactions={store.transactions}
            cash={store.cash}
            onCash={(month, amount) => store.commit({ cash: setCashEntry(store.cash, month, amount) })}
          />}
        {tab === 'transactions' && <Transactions store={store} />}
        {tab === 'matches' && <Matches store={store} />}
        {tab === 'rules' && <Rules store={store} />}
        {tab === 'storage' && <SheetPanel store={store} />}
      </main>
    </div>
  )
}
