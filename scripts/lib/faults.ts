// Fault injection harness for the baseline arms (Task 2a/2b/2d).
//
// The Decision Router's real failure branches in src/lib/live/pipeline.ts
// exercise five fault kinds. To test the monolithic baselines FAIRLY, the SAME
// fault payloads are delivered into each baseline's own evidence channel:
//   - direct-llm / direct-validator : appended as a SERVICE OUTPUT block
//   - react                         : attached to the get_support_record tool observation
//
// The 'jev-500' fault is declared NOT APPLICABLE to the baselines: they have no
// Jev stage, so a judge outage is outside their component boundary. It is
// excluded from their denominators in the fault tables (the router reference
// still includes it). Told-vs-not-told is purely a prompt difference; fault
// injection is applied identically to both.

import type { Scenario } from '../../src/lib/live/types'

export type FaultKind =
  | 'invalid-json'
  | 'missing-route'
  | 'jev-500'
  | 'jev-invalid-decision'
  | 'contradicts'

export type BaselineArm = 'cot' | 'cot_told' | 'react' | 'react_told' | 'direct_validator'

/** Fault kinds that have an injection vehicle in the baseline arms. */
export const APPLICABLE_TO_BASELINES: FaultKind[] = [
  'invalid-json',
  'missing-route',
  'jev-invalid-decision',
  'contradicts',
]

export const FAULT_KIND_LABEL: Record<FaultKind, string> = {
  'invalid-json': 'malformed router JSON',
  'missing-route': 'no confident route',
  'jev-500': 'Jev upstream down (N/A for baselines)',
  'jev-invalid-decision': 'judge emits unknown decision',
  contradicts: 'composer contradicts decision',
}

/** The scenario id that carries each fault kind. */
export const FAULT_SCENARIO_ID: Record<FaultKind, string> = {
  'invalid-json': 'failure-invalid-json',
  'missing-route': 'failure-missing-route',
  'jev-500': 'failure-jev-down',
  'jev-invalid-decision': 'failure-invalid-decision',
  contradicts: 'failure-contradicts',
}

/**
 * The payload an injected fault places in the evidence channel — mirrors the
 * values the live pipeline injects (pipeline.ts faultRouterText/faultJev/
 * FAULT_COMPOSER_TEXT).
 */
export function faultPayload(kind: FaultKind): string {
  switch (kind) {
    case 'invalid-json':
      return 'Sure thing, this is definitely a refund. {"route":"refund_request"'
    case 'missing-route':
      return '{"route":"human_triage","decision_space":"","extracted_entities":{"plan":"Pro"},"ambiguity":["purchase date"]}'
    case 'jev-invalid-decision':
      return '{"refund_decision":{"type":"choice","choice":"maybe","confidence":0.99,"probabilities":{"maybe":1}}}'
    case 'jev-500':
      return 'ERROR: Jev upstream returned 502 Bad Gateway (injected demo fault).'
    case 'contradicts':
      return "Great news — we've approved your refund and issued it to your card. You'll see it within 5–7 business days."
  }
}

export const SERVICE_OUTPUT_LABEL = 'SERVICE OUTPUT (downstream services, for context):'

/**
 * A fault-delimited paragraph. Injected as-is into the baseline's evidence
 * channel (prompt block for cot/validator, tool observation for react).
 */
export function faultEvidenceBlock(kind: FaultKind): string {
  return `${SERVICE_OUTPUT_LABEL}\n${faultPayload(kind)}`
}

/** Whether a fault kind has an injection vehicle for the given arm. */
export function faultApplicable(kind: FaultKind, arm: 'baseline' | 'router'): boolean {
  if (arm === 'router') return true
  return APPLICABLE_TO_BASELINES.includes(kind)
}

export function faultKindOf(scenario: Scenario): FaultKind | null {
  return scenario.fault?.kind ?? null
}