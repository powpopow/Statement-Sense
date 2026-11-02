/**
 * Learning from a correction.
 *
 * Rule lists never cover every restaurant, so the fix has to come from the
 * person: when they recategorise a row, offer to remember that merchant, and
 * apply it to the others they have already imported.
 */
import { ruleMatches } from './categorize'
import { merchantKey } from './suggest'
import type { Category, Rule, Transaction } from './types'

/**
 * A rule pattern that finds this merchant again, or null if none is safe.
 *
 * The merchant name is cleaned of processor prefixes, store codes and cities,
 * which can leave text that is no longer in the statement line. A rule built
 * from it would never fire, or — worse — fire on the wrong thing, so a pattern
 * is only offered when it is still literally present in the description.
 */
export function learnPattern(description: string): string | null {
  const key = merchantKey(description)
  return key.length >= 3 && description.toUpperCase().includes(key) ? key : null
}

/** Beats every built-in rule (the highest of those is around 320). */
const LEARNED_BASE = 500

export function learnedRule(pattern: string, category: Category): Rule {
  return {
    id: `learned-${pattern}`,
    pattern,
    matchType: 'contains',
    category,
    priority: LEARNED_BASE + pattern.length,
    enabled: true,
  }
}

export interface RuleProposal {
  rule: Rule
  /** Other imported rows this would change. */
  affects: number
}

/**
 * What to offer after `changed` was filed under `category`, or null for nothing
 * worth offering. `rows` is the full list, `changed` already included.
 */
export function proposeRule(
  rows: Transaction[],
  changed: Transaction,
  category: Category,
  rules: Rule[],
): RuleProposal | null {
  const pattern = learnPattern(changed.description)
  if (!pattern) return null

  const rule = learnedRule(pattern, category)
  const known = rules.find((r) => r.id === rule.id)
  if (known && known.enabled && known.category === category) return null

  const affects = rows.filter(
    (t) => t.id !== changed.id && !t.categoryLocked && t.category !== category && ruleMatches(rule, t.description),
  ).length
  return { rule, affects }
}

/** Add the rule, replacing an earlier learned one for the same merchant. */
export function withLearnedRule(rules: Rule[], rule: Rule): Rule[] {
  return [...rules.filter((r) => r.id !== rule.id), rule]
}
