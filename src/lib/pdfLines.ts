/**
 * Turning pdf.js text runs back into lines.
 *
 * pdf.js returns loose text runs, not lines, so runs are regrouped by their
 * y-position and ordered left to right. Kept free of any pdf.js or browser
 * import so the app and the fixture tool in scripts/ share exactly one copy.
 */

/** The two fields of a pdf.js text item this needs. */
export interface TextRun {
  str: string
  /** [a, b, c, d, x, y] — x and y are at index 4 and 5. */
  transform: number[]
}

/** Runs within this many points of each other vertically are one line. */
const LINE_TOLERANCE = 3

export function groupRunsIntoLines(items: TextRun[]): string[] {
  const rows: { y: number; runs: { x: number; str: string }[] }[] = []

  for (const item of items) {
    if (!item.str || !item.str.trim()) continue
    const x = item.transform[4]
    const y = item.transform[5]
    let row = rows.find((r) => Math.abs(r.y - y) <= LINE_TOLERANCE)
    if (!row) {
      row = { y, runs: [] }
      rows.push(row)
    }
    row.runs.push({ x, str: item.str })
  }

  // PDF y grows upward, so sort descending to read top to bottom.
  rows.sort((a, b) => b.y - a.y)
  return rows.map((row) => {
    row.runs.sort((a, b) => a.x - b.x)
    // Join with a space only where the runs are actually separated, so that
    // glyph-by-glyph Thai text does not come back with spaces between letters.
    let line = ''
    let prevEnd = -Infinity
    for (const run of row.runs) {
      if (prevEnd !== -Infinity && run.x - prevEnd > 1) line += ' '
      line += run.str
      prevEnd = run.x + run.str.length * 4
    }
    return line.replace(/\s+/g, ' ').trim()
  })
}
