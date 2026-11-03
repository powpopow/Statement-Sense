/**
 * The Google Sheet is the system of record.
 *
 * Each data type gets its own tab with a header row, so the sheet stays
 * readable and editable by hand — editing the Rules tab in Google Sheets is a
 * supported way to retrain categorisation.
 */
import { googleFetch } from './google'
import type { Stamped } from './merge'
import type { CashEntry, Category, StatementRecord, Order, Rule, Transaction } from './types'

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'
const SPREADSHEET_KEY = 'statement-sense.spreadsheetId'
export const SPREADSHEET_NAME = 'Statement Sense Data'

const TX_HEADERS = [
  'id', 'date', 'postedDate', 'description', 'amount', 'currency',
  'foreignAmount', 'foreignCurrency', 'category', 'categoryLocked',
  'source', 'sourceFile', 'confidence', 'notes', 'matchedOrderId', 'owner', 'account', 'accountName',
  'updatedAt', 'deleted',
] as const

const ORDER_HEADERS = [
  'id', 'platform', 'date', 'orderRef', 'description', 'amount', 'currency',
  'items', 'sourceFile', 'confidence', 'matchedTransactionId', 'owner',
  'updatedAt', 'deleted',
] as const

const RULE_HEADERS = ['id', 'pattern', 'matchType', 'category', 'priority', 'enabled', 'updatedAt', 'deleted'] as const

/** One row per month: the cash the user states at month end. */
const CASH_HEADERS = ['month', 'amount', 'note', 'updatedAt', 'deleted'] as const

const STATEMENT_HEADERS = ['id', 'bank', 'last4', 'periodEnd', 'opening', 'closing', 'net', 'sourceFile'] as const

export const TABS = {
  transactions: 'Transactions',
  orders: 'Orders',
  rules: 'Rules',
  cash: 'Cash',
  statements: 'Statements',
} as const

export function getSavedSpreadsheetId(): string | null {
  try {
    return localStorage.getItem(SPREADSHEET_KEY)
  } catch {
    return null
  }
}

export function saveSpreadsheetId(id: string | null) {
  try {
    if (id) localStorage.setItem(SPREADSHEET_KEY, id)
    else localStorage.removeItem(SPREADSHEET_KEY)
  } catch {
    // Non-fatal: the user just has to pick the sheet again next session.
  }
}

export function spreadsheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`
}

/**
 * Look for a sheet this app made before, so a returning user reconnects to it
 * instead of collecting duplicates.
 *
 * This is the only call that needs the Drive API, and it is a convenience
 * rather than a requirement — so a failure here (most often the Drive API not
 * being enabled on the project) returns null and lets the caller create a
 * fresh sheet, rather than failing the whole connection.
 */
export async function findExistingSpreadsheet(): Promise<string | null> {
  const query = encodeURIComponent(
    `name='${SPREADSHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
  )
  try {
    const response = await googleFetch(`${DRIVE_API}?q=${query}&fields=files(id,name)&pageSize=1`)
    const data = (await response.json()) as { files?: { id: string }[] }
    return data.files?.[0]?.id ?? null
  } catch {
    return null
  }
}

async function appendRows(spreadsheetId: string, tab: string, rows: unknown[][]) {
  if (!rows.length) return
  await googleFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: rows }) },
  )
}

/**
 * Keep a tab's header row current. Sheets made before a column existed have an
 * older header, and a value in a column with no header is lost on the next
 * read, so every write refreshes it. Cheap, and it migrates old sheets in place.
 */
async function writeHeaders(spreadsheetId: string, tab: string, headers: readonly string[]) {
  await googleFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tab)}!A1?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [headers] }) },
  )
}

async function clearTab(spreadsheetId: string, tab: string) {
  await googleFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tab)}!A2:Z100000:clear`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

async function readTab(spreadsheetId: string, tab: string): Promise<string[][]> {
  const response = await googleFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tab)}!A1:Z100000`,
  )
  const data = (await response.json()) as { values?: string[][] }
  return data.values ?? []
}

/** Create the spreadsheet with all tabs and header rows in one call. */
export async function createSpreadsheet(): Promise<string> {
  const response = await googleFetch(SHEETS_API, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: SPREADSHEET_NAME },
      sheets: [
        { properties: { title: TABS.transactions, gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: TABS.orders, gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: TABS.rules, gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: TABS.cash, gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: TABS.statements, gridProperties: { frozenRowCount: 1 } } },
      ],
    }),
  })
  const data = (await response.json()) as { spreadsheetId: string }
  const id = data.spreadsheetId

  await googleFetch(`${SHEETS_API}/${id}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: [
        { range: `${TABS.transactions}!A1`, values: [TX_HEADERS as unknown as string[]] },
        { range: `${TABS.orders}!A1`, values: [ORDER_HEADERS as unknown as string[]] },
        { range: `${TABS.rules}!A1`, values: [RULE_HEADERS as unknown as string[]] },
        { range: `${TABS.cash}!A1`, values: [CASH_HEADERS as unknown as string[]] },
        { range: `${TABS.statements}!A1`, values: [STATEMENT_HEADERS as unknown as string[]] },
      ],
    }),
  })

  return id
}

function toRow<T extends object>(item: T, headers: readonly string[]): unknown[] {
  return headers.map((h) => {
    const value = (item as Record<string, unknown>)[h]
    if (value === undefined || value === null) return ''
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    return value
  })
}

/** Map a sheet row back to an object using the sheet's own header row. */
function fromRows<T>(values: string[][], build: (get: (key: string) => string) => T | null): T[] {
  if (values.length < 2) return []
  const headers = values[0].map((h) => h.trim())
  const out: T[] = []
  for (const row of values.slice(1)) {
    if (!row.some((cell) => cell?.trim())) continue
    const get = (key: string) => {
      const i = headers.indexOf(key)
      return i === -1 ? '' : (row[i] ?? '').trim()
    }
    const item = build(get)
    if (item) out.push(item)
  }
  return out
}

const num = (s: string, fallback = 0) => {
  const n = Number(String(s).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : fallback
}
const bool = (s: string) => /^(true|yes|1)$/i.test(s.trim())

/** When a row last changed, and whether it was deleted; blank on rows written before stamping. */
const stampOf = (get: (key: string) => string): Stamped => ({
  ...(get('updatedAt') !== '' ? { updatedAt: num(get('updatedAt')) } : {}),
  ...(bool(get('deleted')) ? { deleted: true } : {}),
})

export async function writeTransactions(spreadsheetId: string, transactions: Transaction[]) {
  await writeHeaders(spreadsheetId, TABS.transactions, TX_HEADERS)
  await clearTab(spreadsheetId, TABS.transactions)
  await appendRows(spreadsheetId, TABS.transactions, transactions.map((t) => toRow(t, TX_HEADERS)))
}

export async function writeOrders(spreadsheetId: string, orders: Order[]) {
  await writeHeaders(spreadsheetId, TABS.orders, ORDER_HEADERS)
  await clearTab(spreadsheetId, TABS.orders)
  await appendRows(spreadsheetId, TABS.orders, orders.map((o) => toRow(o, ORDER_HEADERS)))
}

export async function writeRules(spreadsheetId: string, rules: Rule[]) {
  await clearTab(spreadsheetId, TABS.rules)
  await appendRows(spreadsheetId, TABS.rules, rules.map((r) => toRow(r, RULE_HEADERS)))
}

/**
 * Make sure a tab exists. Sheets made before the Cash tab was added do not
 * have it, and writing to a tab that is not there fails.
 */
async function ensureTab(spreadsheetId: string, title: string, headers: readonly string[]) {
  const response = await googleFetch(`${SHEETS_API}/${spreadsheetId}?fields=sheets.properties.title`)
  const data = (await response.json()) as { sheets?: { properties: { title: string } }[] }
  if (data.sheets?.some((s) => s.properties.title === title)) return
  await googleFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }] }),
  })
  await writeHeaders(spreadsheetId, title, headers)
}

export async function writeCash(spreadsheetId: string, cash: CashEntry[]) {
  await ensureTab(spreadsheetId, TABS.cash, CASH_HEADERS)
  await writeHeaders(spreadsheetId, TABS.cash, CASH_HEADERS)
  await clearTab(spreadsheetId, TABS.cash)
  await appendRows(spreadsheetId, TABS.cash, cash.map((c) => toRow(c, CASH_HEADERS)))
}

/** An older sheet has no Cash tab yet: that means no cash stated, not a failure. */
export async function readCash(spreadsheetId: string): Promise<CashEntry[]> {
  let values: string[][]
  try {
    values = await readTab(spreadsheetId, TABS.cash)
  } catch (error) {
    if (/Unable to parse range|Requested entity was not found/i.test((error as Error).message)) return []
    throw error
  }
  return fromRows<CashEntry>(values, (get) => {
    const month = get('month')
    const amount = num(get('amount'))
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) return null
    const stamp = stampOf(get)
    // A removed month is kept as a marker; otherwise an amount is needed.
    if (amount <= 0 && !stamp.deleted) return null
    return { month, amount, ...(get('note') ? { note: get('note') } : {}), ...stamp }
  })
}

export async function writeStatements(spreadsheetId: string, statements: StatementRecord[]) {
  await ensureTab(spreadsheetId, TABS.statements, STATEMENT_HEADERS)
  await writeHeaders(spreadsheetId, TABS.statements, STATEMENT_HEADERS)
  await clearTab(spreadsheetId, TABS.statements)
  await appendRows(spreadsheetId, TABS.statements, statements.map((s) => toRow(s, STATEMENT_HEADERS)))
}

export async function readStatements(spreadsheetId: string): Promise<StatementRecord[]> {
  let values: string[][]
  try {
    values = await readTab(spreadsheetId, TABS.statements)
  } catch (error) {
    if (/Unable to parse range|Requested entity was not found/i.test((error as Error).message)) return []
    throw error
  }
  return fromRows<StatementRecord>(values, (get) => {
    if (!get('id') || !get('last4') || !get('periodEnd') || get('closing') === '') return null
    return {
      id: get('id'),
      bank: get('bank'),
      last4: get('last4'),
      periodEnd: get('periodEnd'),
      ...(get('opening') !== '' ? { opening: num(get('opening')) } : {}),
      closing: num(get('closing')),
      net: num(get('net')),
      sourceFile: get('sourceFile'),
    }
  })
}

export async function readTransactions(spreadsheetId: string): Promise<Transaction[]> {
  const values = await readTab(spreadsheetId, TABS.transactions)
  return fromRows<Transaction>(values, (get) => {
    const id = get('id')
    const date = get('date')
    if (!id || !date) return null
    return {
      id,
      date,
      postedDate: get('postedDate') || undefined,
      description: get('description'),
      amount: num(get('amount')),
      currency: get('currency') || 'THB',
      foreignAmount: get('foreignAmount') ? num(get('foreignAmount')) : undefined,
      foreignCurrency: get('foreignCurrency') || undefined,
      category: (get('category') || 'Uncategorized') as Category,
      categoryLocked: bool(get('categoryLocked')),
      source: get('source'),
      sourceFile: get('sourceFile'),
      confidence: num(get('confidence'), 0.5),
      notes: get('notes') || undefined,
      matchedOrderId: get('matchedOrderId') || undefined,
      owner: get('owner') || undefined,
      account: get('account') || undefined,
      accountName: get('accountName') || undefined,
      ...stampOf(get),
    }
  })
}

export async function readOrders(spreadsheetId: string): Promise<Order[]> {
  const values = await readTab(spreadsheetId, TABS.orders)
  return fromRows<Order>(values, (get) => {
    const id = get('id')
    if (!id) return null
    return {
      id,
      platform: (get('platform') || 'Other') as Order['platform'],
      date: get('date'),
      orderRef: get('orderRef') || undefined,
      description: get('description'),
      amount: num(get('amount')),
      currency: get('currency') || 'THB',
      items: get('items') || undefined,
      sourceFile: get('sourceFile'),
      confidence: num(get('confidence'), 0.5),
      matchedTransactionId: get('matchedTransactionId') || undefined,
      owner: get('owner') || undefined,
      ...stampOf(get),
    }
  })
}

export async function readRules(spreadsheetId: string): Promise<Rule[]> {
  const values = await readTab(spreadsheetId, TABS.rules)
  return fromRows<Rule>(values, (get) => {
    const pattern = get('pattern')
    if (!pattern) return null
    return {
      id: get('id') || `rule-${pattern}`,
      pattern,
      matchType: get('matchType') === 'regex' ? 'regex' : 'contains',
      category: (get('category') || 'Uncategorized') as Category,
      priority: num(get('priority'), pattern.length),
      // Blank means enabled, so a hand-added row in the sheet just works.
      enabled: get('enabled') === '' ? true : bool(get('enabled')),
      ...stampOf(get),
    }
  })
}
