/**
 * App state.
 *
 * The Google Sheet is the record, but every change is written to localStorage
 * first and pushed to the sheet after. That keeps the UI responsive, lets the
 * app work before you connect a sheet at all, and means a failed network call
 * never loses what you just imported.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyChange, live, mergeRows, newerRows } from './merge'
import { defaultRules } from './categorize'
import * as sheets from './sheets'
import * as backend from './backend'
import { isConfigured, isSignedIn, signIn, signOut } from './google'
import type { CashEntry, StatementRecord, Order, Rule, Transaction } from './types'

const CACHE_KEY = 'statement-sense.cache'

export type SyncState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'ready'; spreadsheetId: string; lastSync: number | null }
  | { status: 'syncing'; spreadsheetId: string }
  | { status: 'error'; message: string }

/** What the rest of the app sees: live rows only. */
interface Cache {
  transactions: Transaction[]
  orders: Order[]
  rules: Rule[]
  /** Cash stated per month; see cash.ts. */
  cash: CashEntry[]
  /** Each card statement's balances, for the chain check. */
  statements: StatementRecord[]
}

/** What is stored and synced: the same lists plus delete markers (see merge.ts). */
type Full = Cache

const idOf = (row: { id: string }) => row.id
const monthOf = (row: CashEntry) => row.month

const mergeStatements = (a: StatementRecord[], b: StatementRecord[]) => [
  ...new Map([...b, ...a].map((r) => [r.id, r])).values(),
]

/** Where the shared copy lives: the Apps Script backend, or (without one) the Sheets API directly. */
interface Remote {
  id: string
  read(): Promise<{ data: Full; rev?: number }>
  /** Send what the other side lacks. `theirs` is what was just read from it. */
  write(final: Full, theirs: Full): Promise<void>
}

const fromTab = <T>(rows: backend.Row[] | undefined, build: (get: sheets.Getter) => T | null): T[] =>
  (rows ?? []).flatMap((row) => {
    const item = build((key) => (row[key] === undefined || row[key] === null ? '' : String(row[key])))
    return item ? [item] : []
  })

const backendRemote: Remote = {
  id: 'backend',
  async read() {
    const { rev, tabs } = await backend.pullAll()
    return {
      rev,
      data: {
        transactions: fromTab(tabs.Transactions, sheets.buildTransaction),
        orders: fromTab(tabs.Orders, sheets.buildOrder),
        rules: fromTab(tabs.Rules, sheets.buildRule),
        cash: fromTab(tabs.Cash, sheets.buildCash),
        statements: fromTab(tabs.Statements, sheets.buildStatement),
      },
    }
  },
  async write(final, theirs) {
    const rows = <T extends object>(list: T[]) => list as unknown as backend.Row[]
    const tabs: backend.TabRows = {
      Transactions: rows(newerRows(final.transactions, theirs.transactions, idOf)),
      Orders: rows(newerRows(final.orders, theirs.orders, idOf)),
      Rules: rows(newerRows(final.rules, theirs.rules, idOf)),
      Cash: rows(newerRows(final.cash, theirs.cash, monthOf)),
      Statements: rows(final.statements.filter((r) => !theirs.statements.some((t) => t.id === r.id))),
    }
    // Nothing to send means no write, so syncing alone never moves the revision.
    if (Object.values(tabs).some((list) => list.length)) await backend.pushRows(tabs)
  },
}

function sheetsRemote(): Remote | null {
  const id = sheets.getSavedSpreadsheetId()
  if (!id || !isSignedIn()) return null
  return {
    id,
    async read() {
      const [transactions, orders, rules, cash, statements] = await Promise.all([
        sheets.readTransactions(id),
        sheets.readOrders(id),
        sheets.readRules(id),
        sheets.readCash(id),
        sheets.readStatements(id),
      ])
      return { data: { transactions, orders, rules, cash, statements } }
    },
    async write(final) {
      await sheets.writeTransactions(id, final.transactions)
      await sheets.writeOrders(id, final.orders)
      await sheets.writeRules(id, final.rules)
      await sheets.writeCash(id, final.cash)
      await sheets.writeStatements(id, final.statements)
    },
  }
}

function readCache(): Full {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    // A cache saved before cash or statements existed lacks them, so fill them in.
    if (raw) return { cash: [], statements: [], ...(JSON.parse(raw) as Partial<Full>) } as Full
  } catch {
    // A corrupt cache should not stop the app from starting.
  }
  return { transactions: [], orders: [], rules: defaultRules(), cash: [], statements: [] }
}

function writeCache(cache: Full) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Quota exceeded; the sheet still holds the data.
  }
}

export function useAppStore() {
  // Read the cache once, lazily, so a reload restores state without flicker.
  const [initial] = useState(readCache)
  const [all, setAll] = useState<Full>(initial)
  const [sync, setSync] = useState<SyncState>({ status: 'disconnected' })

  useEffect(() => {
    writeCache(all)
  }, [all])

  // Always the newest state, for callbacks that must not close over a stale copy.
  const latest = useRef(all)
  useEffect(() => {
    latest.current = all
  }, [all])

  const transactions = useMemo(() => live(all.transactions), [all.transactions])
  const orders = useMemo(() => live(all.orders), [all.orders])
  const rules = useMemo(() => live(all.rules), [all.rules])
  const cash = useMemo(() => live(all.cash), [all.cash])
  const statements = all.statements

  const spreadsheetId = 'spreadsheetId' in sync ? sync.spreadsheetId : null

  /**
   * Bring this device and the sheet together: read the sheet, merge it with
   * what is here (the newer change to each row wins), keep the result, and write
   * it back. Nothing either side holds alone is lost.
   */
  const lastRev = useRef<number | null>(null)

  const exchange = useCallback(async () => {
    const remote = backend.isBackend() ? backendRemote : sheetsRemote()
    if (!remote) return
    setSync({ status: 'syncing', spreadsheetId: remote.id })
    try {
      const { data: theirs, rev } = await remote.read()
      // Merge the newest local state, so a change made while this was reading is kept too.
      const merge = (mine: Full): Full => ({
        transactions: mergeRows(mine.transactions, theirs.transactions, idOf),
        orders: mergeRows(mine.orders, theirs.orders, idOf),
        rules: mergeRows(mine.rules, theirs.rules, idOf),
        cash: mergeRows(mine.cash, theirs.cash, monthOf),
        statements: mergeStatements(mine.statements, theirs.statements),
      })
      const final = merge(latest.current)
      latest.current = final
      setAll(final)
      await remote.write(final, theirs)
      // Remember the revision that was read, not the one after our own write:
      // if someone else wrote in between, the next check sees it and syncs again.
      if (rev !== undefined) lastRev.current = rev
      setSync({ status: 'ready', spreadsheetId: remote.id, lastSync: Date.now() })
    } catch (error) {
      setSync({ status: 'error', message: (error as Error).message })
    }
  }, [])

  // With the backend there is no Connect step: sign-in happens at the gate, so sync on start,
  // when the tab comes back into view, and every 20 seconds while it is open (a cheap revision check).
  useEffect(() => {
    if (!backend.isBackend()) return
    const first = setTimeout(() => void exchange(), 0)
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        if ((await backend.ping()) !== lastRev.current) await exchange()
      } catch {
        // A failed check is not worth an error; the next one tries again.
      }
    }
    const timer = setInterval(() => void check(), 20_000)
    const onVisible = () => void check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [exchange])

  /** Sign in, find or create the spreadsheet, and load it. */
  const connect = useCallback(async () => {
    if (!isConfigured()) {
      setSync({
        status: 'error',
        message: 'No Google client ID is set. Add VITE_GOOGLE_CLIENT_ID to .env and restart the dev server.',
      })
      return
    }
    setSync({ status: 'connecting' })
    try {
      await signIn(true)
      let id = sheets.getSavedSpreadsheetId()
      if (!id) id = await sheets.findExistingSpreadsheet()
      if (!id) id = await sheets.createSpreadsheet()
      sheets.saveSpreadsheetId(id)

      // Whether the sheet is new or has data, merge: a new one just receives everything.
      setSync({ status: 'ready', spreadsheetId: id, lastSync: null })
      await exchange()
    } catch (error) {
      setSync({ status: 'error', message: (error as Error).message })
    }
  }, [exchange])

  const disconnect = useCallback(() => {
    signOut()
    sheets.saveSpreadsheetId(null)
    setSync({ status: 'disconnected' })
  }, [])

  // Reconnect silently on load if this browser already has a sheet and grant.
  useEffect(() => {
    const id = sheets.getSavedSpreadsheetId()
    if (backend.isBackend() || !id || !isConfigured()) return
    let cancelled = false
    signIn(false)
      .then(() => {
        if (!cancelled) return exchange()
      })
      .catch(() => {
        // The grant lapsed; the user can press Connect when they want to sync.
        if (!cancelled) setSync({ status: 'disconnected' })
      })
    return () => {
      cancelled = true
    }
  }, [exchange])

  /** Replace some of the live lists; changes are stamped and removals marked, then synced. */
  const commit = useCallback(
    (next: Partial<Cache>) => {
      const now = Date.now()
      const cur = latest.current
      const updated: Full = {
        transactions: next.transactions ? applyChange(cur.transactions, next.transactions, idOf, now) : cur.transactions,
        orders: next.orders ? applyChange(cur.orders, next.orders, idOf, now) : cur.orders,
        rules: next.rules ? applyChange(cur.rules, next.rules, idOf, now) : cur.rules,
        cash: next.cash ? applyChange(cur.cash, next.cash, monthOf, now) : cur.cash,
        statements: next.statements ? mergeStatements(next.statements, cur.statements) : cur.statements,
      }
      latest.current = updated
      setAll(updated)
      void exchange()
    },
    [exchange],
  )

  return {
    transactions,
    orders,
    rules,
    cash,
    statements,
    sync,
    spreadsheetId,
    commit,
    connect,
    disconnect,
    syncNow: () => exchange(),
    googleConfigured: isConfigured(),
  }
}

export type AppStore = ReturnType<typeof useAppStore>
