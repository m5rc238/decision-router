// Mock fixture for the RAG + Agent comparison pane.
//
// DISPLAY-ONLY. The baseline pane is never executed — it exists only to contrast
// with the composed pipeline running on the left. Its "case" always matches the
// scenario currently selected on the composed side (same customer request) so
// the comparison is apples-to-apples; the rest of the content is a plausible
// mock of how a single-authority RAG/agent flow would handle it.

import type { Scenario } from '../lib/live/types'

export interface BaselineScenario {
  request: string
  retrieved: string[]
  decision: { decision: string; reason: string }
  action: { summary: string; status: string }
  response: string
}

// Map the mock's colloquial decision onto the same vocabulary as gold, so the
// RAG+Agent pane can be compared against the reference answer.
export function ragOutcomeFor(b: BaselineScenario): { decision: string; reasonCode: string } {
  return {
    decision: b.decision.decision === 'deny' ? 'deny_refund' : 'approve_refund',
    reasonCode: b.decision.reason,
  }
}

export function baselineForScenario(scenario: Scenario): BaselineScenario {
  const f = scenario.facts ?? {}
  const age = f.purchase_age_days ?? 0
  const window = f.refund_window_days ?? 30
  const active = f.account_status === 'active'
  const request = scenario.userInput

  if (active && age <= window) {
    return {
      request,
      retrieved: ['Customer record', 'Payment ledger', 'Refund policy'],
      decision: { decision: 'refund', reason: 'within_refund_window' },
      action: { summary: 'issue refund', status: 'executed' },
      response: 'Thanks for reaching out \u2014 you\u2019re within the refund window, so we\u2019ve issued your refund.',
    }
  }
  if (active) {
    return {
      request,
      retrieved: ['Customer record', 'Payment ledger', 'Refund policy'],
      decision: { decision: 'refund', reason: 'goodwill_refund' },
      action: { summary: 'issue refund', status: 'executed' },
      response: 'Hi there \u2014 after reviewing, we\u2019ve issued a goodwill refund to your card as a one-time exception.',
    }
  }
  return {
    request,
    retrieved: ['Customer record', 'Payment ledger', 'Refund policy'],
    decision: { decision: 'deny', reason: 'account_not_active' },
    action: { summary: 'flag for manual review', status: 'queued' },
    response: 'We need to verify your account before we can help further \u2014 a specialist will reach out.',
  }
}