// Benchmark "gold" reference.
//
// Every scenario gets an expected ("gold") outcome so nobody has to guess what
// the correct answer is. It is DERIVED from the business rules baked into the
// fixture data — the same rule set the live judge is told — so it reflects the
// ideal answer the pipeline should produce. The demo compares each live run
// against this reference and reports pass/fail per check.
//
// - Decidable refund cases: approve iff the verified purchase age is within the
//   refund window on an active account; otherwise deny outside the window.
// - Ambiguous intent: never invent a decision — human triage is the correct one.
// - Fault-injected or data-missing cases: the correct behavior is to fail closed
//   at the affected stage; emitting any decision would be a failure.

import type { LiveRun, Scenario } from './types'

export type GoldExpect = 'decide' | 'halt'

export interface GoldExpectation {
  id: string
  label: string
  route: string
  expect: GoldExpect
  decision?: string
  reasonCode?: string
  rule: string
  haltStage?: string
  haltCode?: string
}

export const GOLD_ROUTE = {
  refund: 'refund_request',
  triage: 'human_triage',
} as const

export function goldForScenario(s: Scenario): GoldExpectation {
  const facts = s.facts ?? {}
  const age = facts.purchase_age_days ?? 0
  const window = facts.refund_window_days ?? 30
  const active = facts.account_status === 'active'
  const base = {
    id: s.id,
    label: s.label,
    route: GOLD_ROUTE.refund,
    expect: 'decide' as GoldExpect,
  }

  // Intent cannot be resolved to a single decision: human triage / review is the correct
  // outcome. Models should output request_review; pipelines can halt to triage.
  if (s.id === 'ambiguous-plan' || s.id === 'edge-conflicting-claims') {
    return {
      ...base,
      route: GOLD_ROUTE.triage,
      expect: 'decide',
      decision: 'request_review',
      reasonCode: 'regular_review',
      rule: 'The request cannot be reliably mapped to a single decision — the correct behavior is human review (request_review / regular_review).',
    }
  }

  // Model never guesses undisputed facts: with no verified facts, the correct
  // behavior is human review (request_review / regular_review) or system halt at facts stage.
  if (Object.keys(facts).length === 0) {
    return {
      ...base,
      expect: 'decide',
      decision: 'request_review',
      reasonCode: 'regular_review',
      haltStage: 'verified_facts',
      haltCode: 'facts_missing',
      rule: 'Fault: no verified facts are available. The correct behavior is human review (request_review / regular_review) or system fail-closed at facts stage.',
    }
  }

  // Fault-injected stages must be caught by the real failure branches.
  if (s.fault?.stage === 'semantic_router' && s.fault.kind === 'invalid-json') {
    return {
      ...base,
      expect: 'halt',
      haltStage: 'semantic_router',
      haltCode: 'router_malformed_json',
      rule: 'Fault injection: the router returned malformed JSON. The correct behavior is to fail closed at the router, not force a route out of garbage.',
    }
  }
  if (s.fault?.stage === 'semantic_router' && s.fault.kind === 'missing-route') {
    return {
      ...base,
      route: GOLD_ROUTE.triage,
      expect: 'halt',
      haltStage: 'route_contract',
      rule: 'Fault injection: the route is not confident. The correct behavior is human triage — a graceful halt rather than a forced decision.',
    }
  }
  if (s.fault?.stage === 'jev_judgment' && s.fault.kind === 'jev-invalid-decision') {
    return {
      ...base,
      expect: 'halt',
      haltStage: 'jev_judgment',
      haltCode: 'jev_invalid_output',
      rule: 'Fault injection: the judge emits an unknown decision. The correct behavior is to reject the invalid judgment and halt.',
    }
  }
  if (s.fault?.stage === 'jev_judgment') {
    return {
      ...base,
      expect: 'halt',
      haltStage: 'jev_judgment',
      haltCode: 'jev_error',
      rule: 'Fault injection: the judgment upstream fails. The correct behavior is to halt — no decision is worth trusting a broken judge.',
    }
  }
  if (s.fault?.stage === 'response_composer') {
    return {
      ...base,
      expect: 'halt',
      haltStage: 'response_composer',
      haltCode: 'composer_contradiction',
      rule: 'Fault injection: the composer contradicts the decided outcome. The correct behavior is for the guardrail to reject the message (fail closed).',
    }
  }

  // Repeated refund activity is a risk signal: never rubber-stamp refund #3 —
  // escalate to human review.
  if (typeof facts.previous_refunds_count === 'number' && facts.previous_refunds_count >= 2) {
    return {
      ...base,
      decision: 'request_review',
      reasonCode: 'irregular_review',
      rule: `previous_refunds_count (${facts.previous_refunds_count}) ≥ 2 → repeated refund activity; escalate to human review instead of deciding.`,
    }
  }

  // Healthy, decidable refund case — derive the ideal decision from the rules.
  if (active && age <= window) {
    return {
      ...base,
      decision: 'approve_refund',
      reasonCode: 'within_refund_window',
      rule: `purchase_age_days (${age}) ≤ refund_window_days (${window}) and the account is active → approve the refund within the window.`,
    }
  }
  if (active) {
    return {
      ...base,
      decision: 'deny_refund',
      reasonCode: 'refund_window_exceeded',
      rule: `purchase_age_days (${age}) > refund_window_days (${window}) → deny; the refund window has been exceeded.`,
    }
  }
  return {
    ...base,
    decision: 'deny_refund',
    reasonCode: 'not_eligible',
    rule: 'The account is not active → not eligible for a refund.',
  }
}

export interface GoldCheck {
  name: string
  expected: string
  actual: string | null
  ok: boolean
}

export interface GoldVerdict {
  pass: boolean
  checks: GoldCheck[]
}

function parseReason(stage?: { output?: string }): string | null {
  if (!stage?.output) return null
  const m = stage.output.match(/"reasonCode"\s*:\s*"([^"]+)"/)
  if (m) return m[1]
  const r = stage.output.match(/"reason_code"\s*:\s*"([^"]+)"/)
  return r ? r[1] : null
}

export function verdictForRun(run: LiveRun, gold: GoldExpectation): GoldVerdict {
  const byKey = (key: string) => run.stages.find((x) => x.key === key)
  const failed = run.stages.find((x) => x.status === 'error')
  const checks: GoldCheck[] = []

  if (gold.expect === 'halt') {
    const halted = run.status === 'error' || run.status === 'triage'
    checks.push({ name: 'halts instead of deciding', expected: 'halt', actual: run.status, ok: halted })
    if (gold.haltCode) {
      checks.push({
        name: 'halt reason',
        expected: gold.haltCode,
        actual: failed?.errorCode ?? null,
        ok: failed?.errorCode === gold.haltCode,
      })
    }
    if (gold.haltStage) {
      const haltLocation = failed?.key ?? (run.status === 'triage' ? 'route_contract' : null)
      checks.push({
        name: 'halt location',
        expected: gold.haltStage,
        actual: haltLocation,
        ok: haltLocation === gold.haltStage,
      })
    }
    return { pass: checks.every((c) => c.ok), checks }
  }

  const route = byKey('route_contract')?.highlight ?? null
  const decision = byKey('decision_contract')?.highlight ?? null
  const reason = parseReason(byKey('decision_contract'))
  const composerOk = byKey('response_composer')?.status === 'done'

  // If gold expectation is request_review, halting to triage/missing-facts is a valid escalation
  if (gold.decision === 'request_review' && (run.status === 'triage' || run.status === 'error')) {
    checks.push({ name: 'escalates to human review', expected: 'request_review or triage', actual: run.status, ok: true })
    return { pass: true, checks }
  }

  checks.push({ name: 'pipeline status', expected: 'done', actual: run.status, ok: run.status === 'done' })
  checks.push({ name: 'route', expected: gold.route, actual: route, ok: route === gold.route })
  checks.push({ name: 'decision', expected: gold.decision ?? '', actual: decision, ok: decision === gold.decision })
  checks.push({ name: 'reason code', expected: gold.reasonCode ?? '', actual: reason, ok: reason === gold.reasonCode })
  checks.push({
    name: 'final message consistent',
    expected: 'guardrail passed',
    actual: composerOk ? 'guardrail passed' : 'rejected',
    ok: composerOk,
  })
  return { pass: checks.every((c) => c.ok), checks }
}

/** Compare an (already decided) outcome — e.g. the mock RAG+Agent pane — against gold. */
export interface OutcomeVerdict {
  decision: string
  reasonCode: string
}

export function verdictForOutcome(outcome: OutcomeVerdict, gold: GoldExpectation): GoldVerdict {
  const checks: GoldCheck[] = []
  if (gold.expect === 'halt') {
    checks.push({ name: 'halts instead of deciding', expected: 'halt', actual: 'decides', ok: false })
    checks.push({
      name: 'correct halt',
      expected: gold.haltCode ?? 'human triage',
      actual: '— (no halt)',
      ok: false,
    })
    return { pass: false, checks }
  }
  checks.push({
    name: 'decision',
    expected: gold.decision ?? '—',
    actual: outcome.decision,
    ok: outcome.decision === gold.decision,
  })
  checks.push({
    name: 'reason code',
    expected: gold.reasonCode ?? '—',
    actual: outcome.reasonCode,
    ok: outcome.reasonCode === gold.reasonCode,
  })
  return { pass: checks.every((c) => c.ok), checks }
}