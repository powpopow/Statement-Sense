import { useRef, useState } from 'react'
import { spreadsheetUrl, SPREADSHEET_NAME } from '../lib/sheets'
import { exportJson, exportOrdersCsv, exportTransactionsCsv, readBackup } from '../lib/backup'
import type { AppStore } from '../lib/store'

export function SheetPanel({ store }: { store: AppStore }) {
  const { sync } = store
  const restoreRef = useRef<HTMLInputElement>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restored, setRestored] = useState<string | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)

  /** Imported rows grouped by the file they came from. */
  const bySource = (() => {
    const counts = new Map<string, { transactions: number; orders: number }>()
    for (const t of store.transactions) {
      const entry = counts.get(t.sourceFile) ?? { transactions: 0, orders: 0 }
      entry.transactions += 1
      counts.set(t.sourceFile, entry)
    }
    for (const o of store.orders) {
      const entry = counts.get(o.sourceFile) ?? { transactions: 0, orders: 0 }
      entry.orders += 1
      counts.set(o.sourceFile, entry)
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  })()

  const status = (() => {
    switch (sync.status) {
      case 'ready':
        return sync.lastSync ? `Synced ${new Date(sync.lastSync).toLocaleTimeString()}` : 'Connected'
      case 'syncing':
        return 'Syncing…'
      case 'connecting':
        return 'Connecting…'
      case 'error':
        return 'Sync problem'
      default:
        return 'Saved in this browser only'
    }
  })()

  async function restore(file: File) {
    setRestoreError(null)
    setRestored(null)
    try {
      const backup = await readBackup(file)
      store.commit({
        transactions: backup.transactions,
        orders: backup.orders,
        rules: backup.rules,
        // An older backup has no cash; keep what is here rather than wipe it.
        ...(backup.cash?.length ? { cash: backup.cash } : {}),
      })
      setRestored(
        `Restored ${backup.transactions.length} transactions and ${backup.orders.length} orders.`,
      )
    } catch (error) {
      setRestoreError((error as Error).message)
    }
  }

  const hasData = store.transactions.length > 0 || store.orders.length > 0

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Google Sheets storage</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Your data lives in a sheet called “{SPREADSHEET_NAME}” in your own Drive. Until you connect one,
              everything stays in this browser.
            </p>
          </div>
          <span className="pill">{status}</span>
        </div>

        {!store.googleConfigured && (
          <div className="banner warn">
            No Google client ID is configured yet, so syncing is off. Add <code>VITE_GOOGLE_CLIENT_ID</code> to a{' '}
            <code>.env</code> file (see the README for the five-minute setup) and restart the dev server. The app works
            without it — your data just stays in this browser.
          </div>
        )}

        {sync.status === 'error' && <div className="banner error">{sync.message}</div>}

        <div className="row" style={{ marginTop: 14 }}>
          {store.spreadsheetId ? (
            <>
              <a
                className="pill"
                href={spreadsheetUrl(store.spreadsheetId)}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: 'none' }}
              >
                Open the sheet ↗
              </a>
              <button onClick={() => void store.push()} disabled={sync.status === 'syncing'}>
                Push to sheet
              </button>
              <button onClick={() => void store.pull()} disabled={sync.status === 'syncing'}>
                Pull from sheet
              </button>
              <button className="ghost" onClick={store.disconnect}>
                Disconnect
              </button>
            </>
          ) : (
            <button className="primary" onClick={() => void store.connect()} disabled={!store.googleConfigured}>
              Connect Google Sheets
            </button>
          )}
        </div>

        <p className="small muted" style={{ margin: '14px 0 0' }}>
          The app asks only for the <code>drive.file</code> scope, which lets it see the one spreadsheet it creates and
          nothing else in your Drive. Statements themselves are read in this browser and never uploaded — only the
          extracted rows go to the sheet.
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Local backup</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Browser storage is cleared when you clear site data, and does not follow you to another browser or
              device. A JSON backup restores everything; the CSVs are for reading elsewhere.
            </p>
          </div>
        </div>

        <div className="row">
          <button
            className="primary"
            disabled={!hasData && !store.rules.length}
            onClick={() => exportJson(store.transactions, store.orders, store.rules, store.cash)}
          >
            Download backup (JSON)
          </button>
          <button disabled={!store.transactions.length} onClick={() => exportTransactionsCsv(store.transactions)}>
            Transactions CSV
          </button>
          <button disabled={!store.orders.length} onClick={() => exportOrdersCsv(store.orders)}>
            Orders CSV
          </button>
          <button className="ghost" onClick={() => restoreRef.current?.click()}>
            Restore from backup…
          </button>
          <input
            ref={restoreRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void restore(file)
              e.target.value = ''
            }}
          />
        </div>

        {restoreError && (
          <div className="banner error" style={{ marginTop: 12 }}>
            {restoreError}
          </div>
        )}
        {restored && (
          <div className="banner" style={{ marginTop: 12 }}>
            {restored}
          </div>
        )}

        <p className="small muted" style={{ margin: '14px 0 0' }}>
          Restoring replaces everything currently loaded, so take a backup first if you have unsaved work. Backup files
          contain your transaction data — keep them somewhere you would keep the statements themselves.
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Imported files</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Remove an import to re-read the file from scratch — worth doing after a parser fix, since re-importing
              on its own adds rows rather than replacing them.
            </p>
          </div>
        </div>

        {!bySource.length ? (
          <div className="empty">Nothing imported yet.</div>
        ) : (
          <table>
            <tbody>
              {bySource.map(([source, counts]) => (
                <tr key={source}>
                  <td>{source}</td>
                  <td className="num small muted">
                    {counts.transactions > 0 && `${counts.transactions} transactions`}
                    {counts.transactions > 0 && counts.orders > 0 && ' · '}
                    {counts.orders > 0 && `${counts.orders} orders`}
                  </td>
                  <td style={{ width: 90 }}>
                    <button
                      className="ghost small"
                      onClick={() =>
                        store.commit({
                          transactions: store.transactions.filter((t) => t.sourceFile !== source),
                          orders: store.orders.filter((o) => o.sourceFile !== source),
                        })
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          {confirmingClear ? (
            <>
              <span className="small">
                Delete all {store.transactions.length} transactions and {store.orders.length} orders?
              </span>
              <button
                className="primary"
                onClick={() => {
                  store.commit({ transactions: [], orders: [] })
                  setConfirmingClear(false)
                }}
              >
                Yes, clear everything
              </button>
              <button className="ghost" onClick={() => setConfirmingClear(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmingClear(true)}
              disabled={!store.transactions.length && !store.orders.length}
            >
              Clear all imported data
            </button>
          )}
        </div>

        <p className="small muted" style={{ margin: '14px 0 0' }}>
          Your categorisation rules are kept either way. If a sheet is connected, the change is pushed to it too, so
          take a backup first if you might want the data back.
        </p>
      </div>
    </>
  )
}
