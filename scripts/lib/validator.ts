// Deterministic guardrail for the "Direct LLM + validator" arm (Task 2b).
//
// This arm is the DIRECT LLM (not-told, v1 prompt) followed by a validator that
// performs NO LLM calls. The validator only applies structural rules over (a)
// the LLM's extracted decision and (b) the evidence channel that the prompt
// handed the model. It halts when any of these holds:
//   1. the model's reply did not yield a decision (schema failure)
//   2. the decision is outside the policy enum, or "halt" is not something the
//      v1 prompt ever emits
//   3. an auto-decision (approve/deny) is made on missing required facts
//   4. the evidence channel contains a downstream service fault marker
//      (same payloads injected for the baseline fault test, see faults.ts)
// On any of these, the validator halts and the arm reports no decision.
// It otherwise passes the model's decision through unchanged.

import type { BaselineOutcome } from './types'
import { faultPayload, SERVICE_OUTPUT_LABEL, type FaultKind } from './faults'

const VALID_DECISIONS = ['approve_refund', 'deny_refund', 'request_review']

export interface ValidatorVerdict {
  halted: boolean
  reason: string | null // halt reason when halted (reported as the decision's reasonCode)
  detected: FaultKind | null // which injected fault the validator tripped on, if any
}

/**
 * The substring signature an injected fault leaves in the evidence channel.
 * These are deterministic markers of the SAME payloads the de-facto decision
 * router errors expose; the validator needs no model to spot them.
 */
function findFaultMarker(evidence: string): FaultKind | null {
  const has = (re: RegExp) => re.test(evidence)
  if (has(/{"route":\s*"refund_request"/)) return 'invalid-json'
  if (has(/"route":\s*"human_triage"/)) return 'missing-route'
  if (has(/"choice":\s*"maybe"/)) return 'jev-invalid-decision'
  if (evidence.includes("we've approved your refund and issued it to your card")) return 'contradicts'
  return null
}

const REQUIRED_FOR_AUTO_DECISION: Array<keyof { purchase_age_days?: number; refund_window_days?: number; account_status?: string }> =
  ['purchase_age_days', 'refund_window_days', 'account_status']

export function validateDirectModel(
  outcome: BaselineOutcome,
  facts: Record<string, unknown> | undefined,
  evidence: string,
): ValidatorVerdict {
  // (1) schema failure: no decision extracted
  if (!outcome.decision) {
    return { halted: true, reason: 'decision_not_extracted', detected: null }
  }
  // (2) enum violation: decision outside policy space
  if (!VALID_DECISIONS.includes(outcome.decision)) {
    return { halted: true, reason: 'decision_outside_enum', detected: null }
  }
  // (3) auto-decision on missing required facts
  if (outcome.decision !== 'request_review') {
    const f = facts ?? {}
    const missing = REQUIRED_FOR_AUTO_DECISION.filter((k) => f[k] === undefined || f[k] === null)
    if (missing.length > 0) {
      return { halted: true, reason: `required_facts_missing:[${missing.join(',')}]`, detected: null }
    }
  }
  // (4) downstream service fault marker in the evidence channel
  const detected = findFaultMarker(evidence)
  if (detected) {
    return { halted: true, reason: `service_fault_marker:${detected}`, detected }
  }
  return { halted: false, reason: null, detected: null }
}

/** Convenience: produce a BaselineOutcome after the validator has run. */
export function applyValidator(outcome: BaselineOutcome, verdict: ValidatorVerdict): BaselineOutcome {
  if (!verdict.halted) return outcome
  return { decision: 'halt', reasonCode: verdict.reason }
}

export { faultPayload, SERVICE_OUTPUT_LABEL }