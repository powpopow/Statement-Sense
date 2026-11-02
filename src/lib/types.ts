export type Category =
  | 'Food & Drink'
  | 'Groceries'
  | 'Transport'
  | 'Shopping'
  | 'Bills & Utilities'
  | 'Entertainment'
  | 'Health'
  | 'Travel'
  | 'Cash & Transfers'
  | 'Fees & Interest'
  | 'Income'
  | 'Uncategorized'

export const CATEGORIES: Category[] = [
  'Food & Drink',
  'Groceries',
  'Transport',
  'Shopping',
  'Bills & Utilities',
  'Entertainment',
  'Health',
  'Travel',
  'Cash & Transfers',
  'Fees & Interest',
  'Income',
  'Uncategorized',
]

/** A single line item from a bank or credit card statement. */
export interface Transaction {
  id: string
  /** ISO date (YYYY-MM-DD) the transaction was posted. */
  date: string
  /** ISO date the purchase was made, when the statement distinguishes it. */
  transactionDate?: string
  description: string
  /** Positive for money leaving the account, negative for money coming in. */
  amount: number
  currency: string
  /** Foreign currency amount, for overseas card spend. */
  foreignAmount?: number
  foreignCurrency?: string
  category: Category
  /** True when the user picked the category by hand, so re-runs leave it alone. */
  categoryLocked: boolean
  /** Which parser produced this row, for debugging bad extractions. */
  source: string
  sourceFile: string
  /** 0-1 confidence from the parser; low values get flagged in the UI. */
  confidence: number
  notes?: string
  /** Id of a matched marketplace order, if any. */
  matchedOrderId?: string
}

/** A line item from a Shopee / Grab / Lazada order export or screenshot. */
export interface Order {
  id: string
  platform: 'Shopee' | 'Grab' | 'Lazada' | 'LINE MAN' | 'Foodpanda' | 'Other'
  date: string
  /** The platform's own order reference, when we can read one. */
  orderRef?: string
  description: string
  amount: number
  currency: string
  items?: string
  sourceFile: string
  confidence: number
  matchedTransactionId?: string
}

/** A user-editable rule mapping a description pattern to a category. */
export interface Rule {
  id: string
  /** Matched case-insensitively against the description. */
  pattern: string
  matchType: 'contains' | 'regex'
  category: Category
  /** Higher priority wins when several rules match. */
  priority: number
  enabled: boolean
}

export interface ParseResult {
  transactions: Transaction[]
  orders: Order[]
  /** Human-readable notes about what the parser could and could not read. */
  warnings: string[]
  detectedFormat: string
}

export interface MatchCandidate {
  transaction: Transaction
  order: Order
  /** 0-1; combines amount closeness, date distance and merchant agreement. */
  score: number
  reasons: string[]
}
