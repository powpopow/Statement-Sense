import { useCallback, useRef, useState } from 'react'
import { importFile, dedupeOrders, dedupeTransactions, type ImportKind, type ImportOutcome } from '../lib/import'
import { lookAlikeOrders, lookAlikeTransactions } from '../lib/duplicates'
import { formatMoney } from '../lib/money'
import type { AppStore } from '../lib/store'
import { openOcrSession, type OcrSession } from '../lib/extract'

/** An outcome plus how many rows the file yielded before duplicates were cut. */
type ImportSummary = ImportOutcome & { parsedCount: number }

interface Props {
  store: AppStore
  onDone: () => void
}

export function Upload({ store, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ message: string; fraction: number } | null>(null)
  const [outcomes, setOutcomes] = useState<ImportSummary[]>([])
  const [hint, setHint] = useState<ImportKind | 'auto'>('auto')

  // Files waiting on a password, kept so a retry can re-read the same File.
  const [locked, setLocked] = useState<{ file: File; incorrect: boolean }[]>([])
  const [passwords, setPasswords] = useState<Record<string, string>>({})

  const handleFiles = useCallback(
    async (files: FileList | File[], password?: string) => {
      const list = Array.from(files)
      if (!list.length) return

      setBusy(true)
      setOutcomes([])
      setLocked([])

      // One OCR worker for the whole batch: starting it loads the Thai and
      // English models, which is the slow part of importing screenshots.
      const needsOcr = list.some((f) => !/\.(pdf|csv|tsv)$/i.test(f.name))
      let ocr: OcrSession | null = null
      if (needsOcr) {
        setProgress({ message: 'Starting the text recogniser…', fraction: 0 })
        try {
          ocr = await openOcrSession()
        } catch {
          // Fall back to a worker per file rather than failing the import.
          ocr = null
        }
      }
      const results: ImportSummary[] = []
      let nextTransactions = store.transactions
      let nextOrders = store.orders

      for (let i = 0; i < list.length; i++) {
        const file = list[i]
        setProgress({
          message: list.length > 1 ? `${file.name} (${i + 1} of ${list.length})` : `${file.name} — reading`,
          fraction: i / list.length,
        })

        const outcome = await importFile(file, store.rules, {
          hint: hint === 'auto' ? undefined : hint,
          password,
          ocr: ocr ?? undefined,
          onProgress: (message, fraction) =>
            setProgress({ message: `${file.name} — ${message}`, fraction: (i + fraction) / list.length }),
        })

        // An encrypted PDF is not a failure — hold the file and ask for a password.
        if (outcome.needsPassword) {
          setLocked((current) => [
            ...current.filter((l) => l.file !== file),
            { file, incorrect: outcome.needsPassword!.incorrect },
          ])
          continue
        }

        const freshTransactions = dedupeTransactions(nextTransactions, outcome.transactions)
        const freshOrders = dedupeOrders(nextOrders, outcome.orders)

        const skippedTx = outcome.transactions.length - freshTransactions.length
        const skippedOrders = outcome.orders.length - freshOrders.length
        if (skippedTx) outcome.warnings.push(`${skippedTx} row${skippedTx === 1 ? '' : 's'} already imported, skipped.`)
        if (skippedOrders) outcome.warnings.push(`${skippedOrders} order${skippedOrders === 1 ? '' : 's'} already imported, skipped.`)

        nextTransactions = [...nextTransactions, ...freshTransactions]
        nextOrders = [...nextOrders, ...freshOrders]

        // Not identical, but the same day and amount with near-identical text from
        // another file: probably one row read twice. Imported, but pointed out.
        const txLooks = lookAlikeTransactions(nextTransactions)
        const orderLooks = lookAlikeOrders(nextOrders)
        const maybeTx = freshTransactions.filter((t) => txLooks.has(t.id)).length
        const maybeOrders = freshOrders.filter((o) => orderLooks.has(o.id)).length
        if (maybeTx) {
          outcome.warnings.push(
            `${maybeTx} imported row${maybeTx === 1 ? '' : 's'} look${maybeTx === 1 ? 's' : ''} like one already imported from another file. Check Transactions → Possible duplicates.`,
          )
        }
        if (maybeOrders) {
          outcome.warnings.push(
            `${maybeOrders} imported order${maybeOrders === 1 ? '' : 's'} look${maybeOrders === 1 ? 's' : ''} like one already imported. Check Order matching for the “possible duplicate” tag.`,
          )
        }
        results.push({
          ...outcome,
          transactions: freshTransactions,
          orders: freshOrders,
          // Keep the pre-dedupe count, so a file whose rows were all duplicates
          // is not reported as unreadable.
          parsedCount: outcome.transactions.length + outcome.orders.length,
        })
      }

      nextTransactions.sort((a, b) => b.date.localeCompare(a.date))
      nextOrders.sort((a, b) => b.date.localeCompare(a.date))

      await ocr?.close()

      store.commit({ transactions: nextTransactions, orders: nextOrders })
      setOutcomes(results)
      setProgress(null)
      setBusy(false)
    },
    [hint, store],
  )

  const totalImported = outcomes.reduce((n, o) => n + o.transactions.length + o.orders.length, 0)

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Import</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Bank or credit card statements (PDF or screenshot), and Shopee / Grab orders (screenshot or CSV).
              Everything is read in this browser.
            </p>
          </div>
        </div>

        <div className="row" style={{ marginBottom: 14 }}>
          <label className="small secondary" htmlFor="kind">
            Treat files as
          </label>
          <select id="kind" value={hint} onChange={(e) => setHint(e.target.value as ImportKind | 'auto')}>
            <option value="auto">Detect automatically</option>
            <option value="statement">Bank / card statement</option>
            <option value="orders">Shopee / Grab orders</option>
          </select>
        </div>

        <div
          className={`dropzone${dragOver ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            if (!busy) void handleFiles(e.dataTransfer.files)
          }}
        >
          <p style={{ margin: '0 0 12px', fontWeight: 600 }}>Drop files here</p>
          <p className="small muted" style={{ margin: '0 0 16px' }}>
            PDF, PNG, JPG, CSV — several at once is fine
          </p>
          <button className="primary" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Working…' : 'Choose files'}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            // Deliberately unfiltered. Safari greys out valid files when an
            // accept list mixes extensions with wildcards, and a PDF saved
            // without a visible extension gets excluded on macOS — which made
            // real statements unselectable. The file type is checked on import
            // instead, where a wrong file can be explained rather than hidden.
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        {progress && (
          <div style={{ marginTop: 16 }}>
            <p className="small secondary" style={{ margin: '0 0 6px' }}>
              {progress.message}
            </p>
            <div className="progress">
              <div style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
            </div>
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              Scanned PDFs and screenshots are read with OCR — roughly a second each. The first import on a
              device also loads the recogniser, about 10MB.
            </p>
          </div>
        )}
      </div>

      {locked.map(({ file, incorrect }) => (
        <div className="card" key={file.name}>
          <div className="card-head">
            <div>
              <h2>Password needed</h2>
              <p className="small muted" style={{ margin: '4px 0 0' }}>
                <strong>{file.name}</strong> is encrypted. Thai banks usually lock emailed statements with your ID
                card number, date of birth, or part of your phone number — the covering email normally says which.
              </p>
            </div>
          </div>

          {incorrect && <div className="banner error">That password was not accepted. Try another.</div>}

          <form
            className="row"
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault()
              const value = passwords[file.name] ?? ''
              if (value) void handleFiles([file], value)
            }}
          >
            <input
              type="password"
              autoFocus
              placeholder="Statement password"
              value={passwords[file.name] ?? ''}
              onChange={(e) => setPasswords((p) => ({ ...p, [file.name]: e.target.value }))}
              style={{ minWidth: 240 }}
            />
            <button className="primary" type="submit" disabled={busy || !(passwords[file.name] ?? '').trim()}>
              {busy ? 'Unlocking…' : 'Unlock and import'}
            </button>
            <button type="button" className="ghost" onClick={() => setLocked((l) => l.filter((x) => x.file !== file))}>
              Skip this file
            </button>
          </form>

          <p className="small muted" style={{ margin: '12px 0 0' }}>
            The password is used once to open the file in this browser. It is not stored, and never leaves your
            machine.
          </p>
        </div>
      ))}

      {outcomes.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>
              Imported {totalImported} row{totalImported === 1 ? '' : 's'}
            </h2>
            {totalImported > 0 && (
              <button className="primary" onClick={onDone}>
                See the summary
              </button>
            )}
          </div>

          {outcomes.map((outcome) => (
            <div key={outcome.fileName} style={{ marginBottom: 18 }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <strong>{outcome.fileName}</strong>
                <span className="pill">{outcome.detectedFormat}</span>
                <span className="small muted">
                  {outcome.transactions.length > 0 &&
                    `${outcome.transactions.length} transactions · ${formatMoney(
                      outcome.transactions.reduce((s, t) => s + Math.max(0, t.amount), 0),
                    )} spend`}
                  {outcome.orders.length > 0 && `${outcome.orders.length} orders`}
                </span>
              </div>

              {outcome.error && <div className="banner error">Could not read this file: {outcome.error}</div>}
              {outcome.warnings.map((w, i) => (
                <div key={i} className="banner warn">
                  {w}
                </div>
              ))}
              {outcome.reconciliation.map((check, i) => (
                <div key={`check-${i}`} className={check.status === 'mismatch' ? 'banner error' : 'banner'}>
                  <strong>
                    {check.status === 'verified' ? '✓ Adds up' : check.status === 'assumed' ? '✓ Adds up if paid in full' : check.status === 'mismatch' ? '⚠ Does not add up' : 'Not checked'}
                  </strong>
                  {check.last4 && ` · card ••${check.last4}`} — {check.detail}
                </div>
              ))}
              {!outcome.error && !outcome.parsedCount && outcome.sampleText?.length && (
                <details className="banner" style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer' }}>What the recogniser actually read</summary>
                  <pre className="small mono" style={{ whiteSpace: 'pre-wrap', margin: '10px 0 0' }}>
                    {outcome.sampleText.join('\n')}
                  </pre>
                  <p className="small muted" style={{ margin: '10px 0 0' }}>
                    If this looks nothing like the image, the crop or resolution is the problem. If it looks right
                    but nothing was extracted, the layout is not recognised yet — this text is what to send on.
                  </p>
                </details>
              )}

              {!outcome.error && !outcome.parsedCount && (
                <div className="banner warn">
                  Nothing was extracted. If this is a password-protected PDF, remove the password first; if it is a
                  photo, a straight, well-lit crop reads much better.
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
