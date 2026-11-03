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
import { applyRules, defaultRules } from '../src/lib/categorize'
import { parseStatement } from '../src/lib/parsers/statement'
import { totalsOf } from '../src/lib/summary'

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

      it('puts the purchase date in date and the posting date in postedDate', () => {
        if (!want.sample) return
        const t = result.transactions.find((x) => x.description.includes(want.sample.find))
        expect(t.date).toBe(want.sample.date)
        expect(t.postedDate).toBe(want.sample.postedDate)
      })

      it('tells card payments, refunds and rewards apart, and never files a credit as Income', () => {
        if (!want.kinds) return
        const filed = applyRules(result.transactions, defaultRules())
        const t = totalsOf(filed)
        expect(Math.round(t.payments * 100) / 100).toBe(want.kinds.payment)
        expect(Math.round(t.refunded * 100) / 100).toBe(want.kinds.refund)
        expect(Math.round(t.rewards * 100) / 100).toBe(want.kinds.cashback)
        expect(filed.filter((x) => x.amount < 0 && x.category === 'Income')).toHaveLength(0)
      })

      it('identifies every card and checks each against its printed balance', () => {
        if (!want.cards) return
        expect(result.reconciliation.map(({ last4, status }) => ({ last4, status }))).toEqual(want.cards)
        expect(result.transactions.every((t) => t.account && t.accountName)).toBe(true)
      })

      it('gets spending and credits to the satang', () => {
        expect(sum(result.transactions.filter((t) => t.amount > 0))).toBe(want.spend)
        expect(-sum(result.transactions.filter((t) => t.amount < 0))).toBe(want.credits)
      })
    })
  }
})

describe.skipIf(!names.length)('categorisation coverage on real statements', () => {
  it('leaves no more than 20% of spending uncategorised', () => {
    const spend = names
      .filter((name) => expected[name])
      .flatMap((name) => {
        const { pages } = JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8'))
        return applyRules(parseStatement(pages, `${name}.pdf`, 'f').transactions, defaultRules()).filter((t) => t.amount > 0)
      })
    const total = spend.reduce((s, t) => s + t.amount, 0)
    const missed = spend.filter((t) => t.category === 'Uncategorized').reduce((s, t) => s + t.amount, 0)
    expect(missed / total).toBeLessThan(0.2)
  })
})

// The balance check is only worth having if it notices damage. Break a real statement on purpose.
describe.skipIf(!names.includes('uob-3cards'))('the balance check on a damaged real statement', () => {
  const { pages } = JSON.parse(readFileSync(path.join(dir, 'uob-3cards.json'), 'utf8'))
  const original = parseStatement(pages, 'original.pdf', 'f')
  // A purchase on the first card, found by its own text so nothing here is hard-coded.
  const target = original.transactions.find((t) => t.account === original.transactions[0].account && t.amount > 0)
  const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2 })

  const damage = (edit) => {
    const copy = pages.map((p) => [...p])
    for (const page of copy) {
      const i = page.findIndex((l) => l.includes(target.description.slice(0, 14)) && l.includes(money(target.amount)))
      if (i >= 0) {
        edit(page, i)
        break
      }
    }
    return parseStatement(copy, 'damaged.pdf', 'f').reconciliation
  }

  it('notices a deleted row, naming the card and the amount', () => {
    const checks = damage((page, i) => page.splice(i, 1))
    expect(checks[0]).toMatchObject({ status: 'mismatch', last4: original.reconciliation[0].last4, difference: target.amount })
    expect(checks.slice(1).every((c) => c.status === 'verified')).toBe(true)
  })

  it('notices an amount that is off by 10 baht', () => {
    const checks = damage((page, i) => {
      page[i] = page[i].replace(money(target.amount), money(target.amount + 10))
    })
    expect(checks[0]).toMatchObject({ status: 'mismatch', difference: -10 })
  })
})
