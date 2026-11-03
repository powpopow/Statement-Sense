/** Ties extraction, parsing and categorisation into one call per file. */
import { extractFile, PdfPasswordRequired, type OcrSession } from './extract'
import { parseStatement } from './parsers/statement'
import { parseOrders, detectPlatform } from './parsers/orders'
import { applyRules } from './categorize'
import type { Reconciliation } from './parsers/sections'
import type { Order, Rule, Transaction } from './types'

export type ImportKind = 'statement' | 'orders'

export interface ImportOutcome {
  fileName: string
  kind: ImportKind
  detectedFormat: string
  transactions: Transaction[]
  orders: Order[]
  warnings: string[]
  /** For card statements: does each card's activity add up to the balance the bank printed? */
  reconciliation: Reconciliation[]
  /** Which bank issued a statement, when recognised. */
  bankId?: string | null
  /** Set when the file could not be read at all. */
  error?: string
  /**
   * Set when the file is an encrypted PDF. The UI asks for a password and
   * calls importFile again rather than treating this as a failure.
   */
  needsPassword?: { incorrect: boolean }
  /**
   * The first lines OCR actually read. Shown only when nothing was extracted,
   * so a failure says what the recogniser saw instead of leaving it a guess.
   */
  sampleText?: string[]
}

/**
 * Explain why a file cannot be read, or return null if it looks usable.
 *
 * The file picker deliberately does not filter, so this is where a wrong file
 * is caught. It errs towards trying: a PDF saved without an extension, or with
 * an empty MIME type, is common and must still be accepted.
 */
function describeIfUnsupported(file: File): string | null {
  const name = file.name.toLowerCase()
  const supported = /\.(pdf|png|jpe?g|webp|gif|bmp|heic|heif|tiff?|csv|tsv)$/i
  if (supported.test(name)) return null
  // No recognised extension: trust the browser's type when it gives one.
  if (file.type.startsWith('image/') || file.type === 'application/pdf') return null
  if (file.type === 'text/csv' || file.type === 'text/plain') return null
  if (!file.type) return null

  const obviouslyWrong = /\.(zip|rar|7z|tar|gz|docx?|xlsx?|pptx?|mp4|mov|mp3|exe|dmg|app)$/i
  if (obviouslyWrong.test(name)) {
    return `${file.name.split('.').pop()?.toUpperCase()} files are not supported. Upload the statement as a PDF, a screenshot, or a CSV export.`
  }
  return `This file type is not supported (${file.type}). Upload a PDF, a screenshot, or a CSV export.`
}

/** Short stable id prefix so re-importing the same file is recognisable. */
function idPrefix(fileName: string): string {
  let hash = 0
  for (let i = 0; i < fileName.length; i++) {
    hash = (hash * 31 + fileName.charCodeAt(i)) | 0
  }
  return `${Math.abs(hash).toString(36)}-${Date.now().toString(36)}`
}

/**
 * Guess whether a file is a bank statement or a marketplace order.
 * The caller can override this, since a Shopee screenshot and a card statement
 * screenshot are not always distinguishable before reading them.
 */
function guessKind(text: string, hint?: ImportKind): ImportKind {
  if (hint) return hint
  const platform = detectPlatform(text)
  if (platform === 'Other') return 'statement'
  // Marketplace names also appear *inside* statements as merchant names, so
  // only call it an order file when there is no statement furniture around it.
  const statementish = /statement|balance|เลขที่บัญชี|รายการเดินบัญชี|credit limit|วงเงิน/i.test(text)
  return statementish ? 'statement' : 'orders'
}

export async function importFile(
  file: File,
  rules: Rule[],
  options: {
    hint?: ImportKind
    onProgress?: (message: string, fraction: number) => void
    /** Supplied on a retry, after the UI has asked for it. */
    password?: string
    /** Shared across a batch so the OCR models load once, not per file. */
    ocr?: OcrSession
  } = {},
): Promise<ImportOutcome> {
  const prefix = idPrefix(file.name)
  const isCsv = /\.(csv|tsv)$/i.test(file.name)

  const unsupported = describeIfUnsupported(file)
  if (unsupported) {
    return {
      fileName: file.name,
      kind: 'statement',
      detectedFormat: 'unsupported',
      transactions: [],
      orders: [],
      warnings: [],
      reconciliation: [],
      error: unsupported,
    }
  }

  try {
    // Page grouping is kept, not flattened: the statement parser trims the
    // bank's worked-example section per page.
    let pages: string[][]
    if (isCsv) {
      pages = [(await file.text()).split(/\r?\n/)]
    } else {
      const extraction = await extractFile(file, options.onProgress, options.password, options.ocr)
      pages = extraction.pages.map((p) => p.lines)
    }

    const lines = pages.flat()
    const text = lines.join('\n')
    const kind = isCsv ? (options.hint ?? 'orders') : guessKind(text, options.hint)

    if (kind === 'orders') {
      const result = parseOrders(lines, file.name, prefix, isCsv)
      return {
        fileName: file.name,
        kind,
        detectedFormat: result.detectedFormat,
        transactions: [],
        orders: result.orders,
        warnings: result.warnings,
        reconciliation: [],
        ...(result.orders.length ? {} : { sampleText: lines.slice(0, 25) }),
      }
    }

    const result = parseStatement(pages, file.name, prefix)
    return {
      fileName: file.name,
      kind,
      detectedFormat: result.detectedFormat,
      transactions: applyRules(result.transactions, rules),
      orders: [],
      warnings: result.warnings,
      reconciliation: result.reconciliation,
      bankId: result.bankId,
      ...(result.transactions.length ? {} : { sampleText: lines.slice(0, 25) }),
    }
  } catch (error) {
    const base = {
      fileName: file.name,
      kind: 'statement' as const,
      transactions: [],
      orders: [],
      warnings: [],
      reconciliation: [],
    }
    if (error instanceof PdfPasswordRequired) {
      return {
        ...base,
        detectedFormat: 'password protected',
        needsPassword: { incorrect: error.incorrect },
      }
    }
    return { ...base, detectedFormat: 'unreadable', error: (error as Error).message }
  }
}

// Duplicate handling lives in duplicates.ts; re-exported so callers keep one import.
export { dedupeOrders, dedupeTransactions } from './duplicates'
