import type { Stamped } from './merge'
export type Category =
  | 'Food & Drink'
  | 'Groceries'
  | 'Transport'
  | 'Shopping'
  | 'Bills & Utilities'
  | 'Entertainment'
  | 'Health'
  | 'Travel'
  | 'Gifts & Donations'
  | 'Cash & Transfers'
  | 'Fees & Interest'
  | 'Rewards & Cashback'
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
  'Gifts & Donations',
  'Cash & Transfers',
  'Fees & Interest',
  'Rewards & Cashback',
  'Income',
  'Uncategorized',
]

/** A single line item from a bank or credit card statement. */
export interface Transaction extends Stamped {
  id: string
  /**
   * ISO date (YYYY-MM-DD) the purchase was made — the one that answers "when
   * did I spend this", and the one an order's date lines up with. When a
   * statement prints only one date, that is it.
   */
  date: string
  /** ISO date the bank posted it, when the statement prints both dates. */
  postedDate?: string
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
  /** Whose money this was. Absent means yours; see people.ts. */
  owner?: string
  /** Which card, e.g. "uob-1111": the issuer and the card's last four digits. */
  account?: string
  /** The same, for people: "UOB ••1111". */
  accountName?: string
}

/** A line item from a Shopee / Grab / Lazada order export or screenshot. */
export interface Order extends Stamped {
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
  /** Who the order was for. Absent means you; see people.ts. */
  owner?: string
}

/**
 * The cash a person moved to their cash account for one month, stated once at
 * month end. It stands for personal spending with no detail below it, so it
 * counts as spending in that month and nothing more is tracked.
 */
/**
 * What one card's statement said about its balance, kept so that consecutive
 * statements can be checked against each other (see chain.ts).
 */
export interface StatementRecord {
  /** bank + card + period end + closing, so importing the same statement twice adds nothing. */
  id: string
  bank: string
  last4: string
  /** Latest date among the statement's rows: a stand-in for the statement date. */
  periodEnd: string
  /** Printed previous balance, when the bank prints one. */
  opening?: number
  closing: number
  /** This period's activity: purchases positive, credits and payments negative. */
  net: number
  sourceFile: string
}

export interface CashEntry extends Stamped {
  /** The month it covers, as YYYY-MM. One entry per month. */
  month: string
  /** Baht moved to cash that month. */
  amount: number
  note?: string
}

/** A user-editable rule mapping a description pattern to a category. */
export interface Rule extends Stamped {
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
