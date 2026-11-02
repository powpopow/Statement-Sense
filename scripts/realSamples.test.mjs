/**
 * Runs every real statement fixture through the parser.
 *
 * Fixtures live in fixtures/ (git-ignored, made with scripts/extract-fixture.mjs)
 * because a statement is personal data and this repository is public. With no
 * fixtures — a fresh clone, CI — the whole suite is skipped rather than failing.
 * Expected figures sit in fixtures/expected.json, also local.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseStatement } from '../src/lib/parsers/statement'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const expectedFile = path.join(dir, 'expected.json')
const expected = existsSync(expectedFile) ? JSON.parse(readFileSync(expectedFile, 'utf8')) : {}
const names = existsSync(dir)
  ? readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'expected.json').map((f) => f.replace(/\.json$/, ''))
  : []

const sum = (rows) => Math.round(rows.reduce((s, t) => s + t.amount, 0) * 100) / 100

describe.skipIf(!names.length)('real statements', () => {
  for (const name of names) {
    const want = expected[name]
    if (!want) continue

    describe(name, () => {
      const { pages } = JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8'))
      const result = parseStatement(pages, `${name}.pdf`, 'f')

      it('is attributed to the right bank', () => {
        expect(result.bankId).toBe(want.bank)
      })

      it('reads exactly the rows on the statement', () => {
        expect(result.transactions).toHaveLength(want.rows)
      })

      it('gets spending and credits to the satang', () => {
        expect(sum(result.transactions.filter((t) => t.amount > 0))).toBe(want.spend)
        expect(-sum(result.transactions.filter((t) => t.amount < 0))).toBe(want.credits)
      })
    })
  }
})
