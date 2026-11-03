/**
 * Merging two copies of the data (this device and the Sheet).
 *
 * Every row carries `updatedAt`, the time it was last changed, and a deleted row
 * is kept as a marker (`deleted: true`) instead of vanishing. Merging then needs
 * no guesswork: for each row the newer change wins, and a delete on one device
 * is not undone by another device that still has the row. Replacing one side
 * with the other, as a plain pull did, throws away whatever only the other side had.
 */
export interface Stamped {
  /** Milliseconds since 1970 when this row was last changed. Absent on rows from before stamping. */
  updatedAt?: number
  /** A deleted row, kept so the delete reaches every device. */
  deleted?: boolean
}

export const isLive = (row: Stamped) => !row.deleted
export const live = <T extends Stamped>(rows: T[]): T[] => rows.filter(isLive)

/** Merge two copies. The newer change wins; on a tie, this device's copy stays. */
export function mergeRows<T extends Stamped>(local: T[], remote: T[], key: (row: T) => string): T[] {
  const merged = new Map<string, T>()
  for (const row of local) merged.set(key(row), row)
  for (const row of remote) {
    const mine = merged.get(key(row))
    if (!mine || (row.updatedAt ?? 0) > (mine.updatedAt ?? 0)) merged.set(key(row), row)
  }
  return [...merged.values()]
}

const content = (row: Stamped) => JSON.stringify({ ...row, updatedAt: undefined, deleted: undefined })

/**
 * The full list (with delete markers) after the app changed its live list to
 * `next`: stamp what is new or edited, and mark what is gone as deleted.
 */
export function applyChange<T extends Stamped>(full: T[], next: T[], key: (row: T) => string, now: number): T[] {
  const before = new Map(full.map((row) => [key(row), row]))
  const out: T[] = []
  const seen = new Set<string>()
  for (const row of next) {
    const k = key(row)
    seen.add(k)
    const prev = before.get(k)
    const unchanged = prev && !prev.deleted && content(prev) === content(row)
    out.push(unchanged ? prev : { ...row, updatedAt: now, deleted: undefined })
  }
  for (const [k, prev] of before) {
    if (seen.has(k)) continue
    out.push(prev.deleted ? prev : { ...prev, deleted: true, updatedAt: now })
  }
  return out
}
