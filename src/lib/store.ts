/**
 * App state.
 *
 * The Google Sheet is the record, but every change is written to localStorage
 * first and pushed to the sheet after. That keeps the UI responsive, lets the
 * app work before you connect a sheet at all, and means a failed network call
 * never loses what you just imported.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyChange, live, mergeRows } from './merge'
import { defaultRules } from './categorize'
import * as sheets from './sheets'
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
  const exchange = useCallback(async (local: Full = latest.current) => {
    const id = sheets.getSavedSpreadsheetId()
    if (!id || !isSignedIn()) return
    setSync({ status: 'syncing', spreadsheetId: id })
    try {
      const [t, o, r, c, st] = await Promise.all([
        sheets.readTransactions(id),
        sheets.readOrders(id),
        sheets.readRules(id),
        sheets.readCash(id),
        sheets.readStatements(id),
      ])
      const merged: Full = {
        transactions: mergeRows(local.transactions, t, idOf),
        orders: mergeRows(local.orders, o, idOf),
        rules: mergeRows(local.rules, r, idOf),
        cash: mergeRows(local.cash, c, monthOf),
        statements: mergeStatements(local.statements, st),
      }
      // A change made while this was running is merged in too, not overwritten.
      const now = latest.current
      const final: Full = {
        transactions: mergeRows(now.transactions, merged.transactions, idOf),
        orders: mergeRows(now.orders, merged.orders, idOf),
        rules: mergeRows(now.rules, merged.rules, idOf),
        cash: mergeRows(now.cash, merged.cash, monthOf),
        statements: mergeStatements(now.statements, merged.statements),
      }
      setAll(final)
      await sheets.writeTransactions(id, final.transactions)
      await sheets.writeOrders(id, final.orders)
      await sheets.writeRules(id, final.rules)
      await sheets.writeCash(id, final.cash)
      await sheets.writeStatements(id, final.statements)
      setSync({ status: 'ready', spreadsheetId: id, lastSync: Date.now() })
    } catch (error) {
      setSync({ status: 'error', message: (error as Error).message })
    }
  }, [])

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
    if (!id || !isConfigured()) return
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
      void exchange(updated)
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
