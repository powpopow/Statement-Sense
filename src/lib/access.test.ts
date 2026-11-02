import { describe, expect, it } from 'vitest'
import { parseAllowlist } from './access'

describe('parseAllowlist', () => {
  it('splits on commas/whitespace, lowercases, and drops non-emails', () => {
    const set = parseAllowlist('  Me@Example.com, friend@example.com ;; nonsense ,')
    expect([...set].sort()).toEqual(['friend@example.com', 'me@example.com'])
  })

  it('treats empty or missing input as no allowlist', () => {
    expect(parseAllowlist(undefined).size).toBe(0)
    expect(parseAllowlist('').size).toBe(0)
  })
})
