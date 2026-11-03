/**
 * App state.
 *
 * The Google Sheet is the record, but every change is written to localStorage
 * first and pushed to the sheet after. That keeps the UI responsive, lets the
 * app work before you connect a sheet at all, and means a failed network call
 * never loses what you just imported.
 */
import { useCallback, useEffect, useState } from 'react'
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

interface Cache {
  transactions: Transaction[]
  orders: Order[]
  rules: Rule[]
  /** Cash stated per month; see cash.ts. */
  cash: CashEntry[]
  /** Each card statement's balances, for the chain check. */
  statements: StatementRecord[]
}

function readCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    // A cache saved before cash existed has no `cash`, so fill it in.
    if (raw) return { cash: [], statements: [], ...(JSON.parse(raw) as Partial<Cache>) } as Cache
  } catch {
    // A corrupt cache should not stop the app from starting.
  }
  return { transactions: [], orders: [], rules: defaultRules(), cash: [], statements: [] }
}

function writeCache(cache: Cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Quota exceeded; the sheet still holds the data.
  }
}

export function useAppStore() {
  // Read the cache once, lazily, so a reload restores state without flicker.
  const [initial] = useState(readCache)
  const [transactions, setTransactions] = useState<Transaction[]>(initial.transactions)
  const [orders, setOrders] = useState<Order[]>(initial.orders)
  const [rules, setRules] = useState<Rule[]>(initial.rules)
  const [cash, setCash] = useState<CashEntry[]>(initial.cash)
  const [statements, setStatements] = useState<StatementRecord[]>(initial.statements)
  const [sync, setSync] = useState<SyncState>({ status: 'disconnected' })

  useEffect(() => {
    writeCache({ transactions, orders, rules, cash, statements })
  }, [transactions, orders, rules, cash, statements])

  const spreadsheetId = 'spreadsheetId' in sync ? sync.spreadsheetId : null

  /** Push the current state to the sheet. Safe to call when disconnected. */
  const push = useCallback(
    async (next?: Partial<Cache>) => {
      const id = sheets.getSavedSpreadsheetId()
      if (!id || !isSignedIn()) return
      setSync({ status: 'syncing', spreadsheetId: id })
      try {
        await sheets.writeTransactions(id, next?.transactions ?? transactions)
        await sheets.writeOrders(id, next?.orders ?? orders)
        await sheets.writeRules(id, next?.rules ?? rules)
        await sheets.writeCash(id, next?.cash ?? cash)
        await sheets.writeStatements(id, next?.statements ?? statements)
        setSync({ status: 'ready', spreadsheetId: id, lastSync: Date.now() })
      } catch (error) {
        setSync({ status: 'error', message: (error as Error).message })
      }
    },
    [transactions, orders, rules, cash, statements],
  )

  /** Pull the sheet's contents over local state. */
  const pull = useCallback(async () => {
    const id = sheets.getSavedSpreadsheetId()
    if (!id) return
    setSync({ status: 'syncing', spreadsheetId: id })
    try {
      const [t, o, r, c, st] = await Promise.all([
        // (statements are read last)
        sheets.readTransactions(id),
        sheets.readOrders(id),
        sheets.readRules(id),
        sheets.readCash(id),
        sheets.readStatements(id),
      ])
      setTransactions(t)
      setOrders(o)
      // Cash is typed in by hand and exists nowhere else. If the sheet has none
      // (an older sheet with no Cash tab), keep what is here and let the next
      // push create the tab, rather than wiping it.
      setCash((local) => (c.length ? c : local))
      setStatements((local) => (st.length ? st : local))
      // An empty Rules tab means a fresh sheet, so seed it with the defaults.
      setRules(r.length ? r : defaultRules())
      setSync({ status: 'ready', spreadsheetId: id, lastSync: Date.now() })
      if (!r.length) await sheets.writeRules(id, defaultRules())
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
      const isNew = !id
      if (!id) id = await sheets.createSpreadsheet()
      sheets.saveSpreadsheetId(id)

      if (isNew) {
        await sheets.writeRules(id, rules)
        await sheets.writeTransactions(id, transactions)
        await sheets.writeOrders(id, orders)
        await sheets.writeCash(id, cash)
        await sheets.writeStatements(id, statements)
        setSync({ status: 'ready', spreadsheetId: id, lastSync: Date.now() })
      } else {
        setSync({ status: 'ready', spreadsheetId: id, lastSync: null })
        await pull()
      }
    } catch (error) {
      setSync({ status: 'error', message: (error as Error).message })
    }
  }, [rules, transactions, orders, cash, statements, pull])

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
        if (!cancelled) return pull()
      })
      .catch(() => {
        // The grant lapsed; the user can press Connect when they want to sync.
        if (!cancelled) setSync({ status: 'disconnected' })
      })
    return () => {
      cancelled = true
    }
  }, [pull])

  const commit = useCallback(
    (next: Partial<Cache>) => {
      if (next.transactions) setTransactions(next.transactions)
      if (next.orders) setOrders(next.orders)
      if (next.rules) setRules(next.rules)
      if (next.cash) setCash(next.cash)
      if (next.statements) setStatements(next.statements)
      void push(next)
    },
    [push],
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
    pull,
    push,
    googleConfigured: isConfigured(),
  }
}

export type AppStore = ReturnType<typeof useAppStore>
