/**
 * Local export and restore.
 *
 * Without a connected sheet everything lives in localStorage, which a cache
 * clear wipes. These give you a file you own: JSON round-trips the whole app
 * state, CSV is for reading the transactions in Excel or Sheets by hand.
 */
import type { Order, Rule, Transaction } from './types'

/** Bumped only if the shape changes in a way a restore has to handle. */
const BACKUP_VERSION = 1

export interface Backup {
  app: 'statement-sense'
  version: number
  exportedAt: string
  transactions: Transaction[]
  orders: Order[]
  rules: Rule[]
}

function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const stamp = () => new Date().toISOString().slice(0, 10)

export function exportJson(transactions: Transaction[], orders: Order[], rules: Rule[]) {
  const backup: Backup = {
    app: 'statement-sense',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    transactions,
    orders,
    rules,
  }
  download(`statement-sense-backup-${stamp()}.json`, JSON.stringify(backup, null, 2), 'application/json')
}

/** Quote a CSV field; doubling inner quotes is the escape CSV expects. */
function cell(value: unknown): string {
  if (value === undefined || value === null) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(headers: string[], rows: unknown[][]): string {
  // The BOM makes Excel open UTF-8 correctly, which matters for Thai text.
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
}

export function exportTransactionsCsv(transactions: Transaction[]) {
  const csv = toCsv(
    ['Date', 'Description', 'Category', 'Amount (THB)', 'Direction', 'Confidence', 'Source file'],
    transactions.map((t) => [
      t.date,
      t.description,
      t.category,
      Math.abs(t.amount).toFixed(2),
      t.amount < 0 ? 'in' : 'out',
      t.confidence.toFixed(2),
      t.sourceFile,
    ]),
  )
  download(`statement-sense-transactions-${stamp()}.csv`, csv, 'text/csv')
}

export function exportOrdersCsv(orders: Order[]) {
  const csv = toCsv(
    ['Date', 'Platform', 'Order ref', 'Description', 'Amount (THB)', 'Matched', 'Source file'],
    orders.map((o) => [
      o.date,
      o.platform,
      o.orderRef,
      o.description,
      o.amount.toFixed(2),
      o.matchedTransactionId ? 'yes' : 'no',
      o.sourceFile,
    ]),
  )
  download(`statement-sense-orders-${stamp()}.csv`, csv, 'text/csv')
}

/** Validate a restore file before handing it to the app. */
export async function readBackup(file: File): Promise<Backup> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('That file is not valid JSON.')
  }

  const backup = parsed as Partial<Backup>
  if (backup?.app !== 'statement-sense') {
    throw new Error('That does not look like a Statement Sense backup.')
  }
  if (!Array.isArray(backup.transactions) || !Array.isArray(backup.orders) || !Array.isArray(backup.rules)) {
    throw new Error('The backup is missing its transactions, orders or rules.')
  }
  if ((backup.version ?? 0) > BACKUP_VERSION) {
    throw new Error('That backup was made by a newer version of the app.')
  }

  return {
    app: 'statement-sense',
    version: backup.version ?? BACKUP_VERSION,
    exportedAt: backup.exportedAt ?? '',
    transactions: backup.transactions as Transaction[],
    orders: backup.orders as Order[],
    rules: backup.rules as Rule[],
  }
}
