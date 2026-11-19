// Deterministic rule-engine baseline (zero LLM calls, zero Jev calls).
//
// Represents what a clean engineering team can build WITHOUT an AI decision
// judge: check structural facts, reject injected service-output faults if any
// are passed, and evaluate the 4-line refund policy in pure TypeScript.
//
// Including this baseline prevents attributing deterministic arithmetic
// (200 > 30, previous_refunds_count >= 2) to Jev or an LLM.

import { REQUIRED_FACT_KEYS, type Scenario } from '../../src/lib/live/types'
import { validateDirectModelV2_1, type StructuredServiceOutput } from './validator'
import type { BaselineOutcome } from './types'

export interface DeterministicPolicyResult {
  outcome: BaselineOutcome
  halted: boolean
  reason: string | null
  ms: number
}

export function runDeterministicPolicy(
  scenario: Scenario,
  opts?: { serviceOutputs?: StructuredServiceOutput[]; evidence?: string },
): DeterministicPolicyResult {
  const started = Date.now()
  const facts = scenario.facts ?? {}
  const missing = REQUIRED_FACT_KEYS.filter((k) => facts[k] === undefined || facts[k] === null)

  let rawOutcome: BaselineOutcome
  if (missing.length > 0) {
    return {
      outcome: { decision: 'halt', reasonCode: `required_facts_missing:[${missing.join(',')}]` },
      halted: true,
      reason: `required_facts_missing:[${missing.join(',')}]`,
      ms: Date.now() - started,
    }
  }

  const prev = facts.previous_refunds_count
  const active = facts.account_status === 'active'
  const age = facts.purchase_age_days ?? 0
  const window = facts.refund_window_days ?? 30

  if (typeof prev === 'number' && prev >= 2) {
    rawOutcome = { decision: 'request_review', reasonCode: 'irregular_review' }
  } else if (!active) {
    rawOutcome = { decision: 'deny_refund', reasonCode: 'not_eligible' }
  } else if (age <= window) {
    rawOutcome = { decision: 'approve_refund', reasonCode: 'within_refund_window' }
  } else {
    rawOutcome = { decision: 'deny_refund', reasonCode: 'refund_window_exceeded' }
  }

  if (opts?.serviceOutputs?.length || opts?.evidence) {
    const val = validateDirectModelV2_1(rawOutcome, facts, opts?.evidence ?? '', {
      serviceOutputs: opts?.serviceOutputs,
    })
    if (val.halted) {
      return {
        outcome: { decision: 'halt', reasonCode: val.reason },
        halted: true,
        reason: val.reason,
        ms: Date.now() - started,
      }
    }
  }

  return {
    outcome: rawOutcome,
    halted: false,
    reason: null,
    ms: Date.now() - started,
  }
}
