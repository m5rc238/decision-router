// Deterministic guardrail for the "Direct LLM + validator" arm.
//
// Versions:
//   - validator-v1.0-frozen: original Task 2b hardcoded regexes scanning flat
//     prompt text.
//   - validator-v2.0-structural: preserved snapshot of v2.0 before fixing
//     `denyMentionedV2_0` ("cannot automatically decide") and the flat-string
//     customer prompt-injection vulnerability (`extractServiceOutput` first match).
//   - validator-v2.1-structured: default. Accepts structured `serviceOutputs`
//     (eliminating prompt-injection DoS/bypass against CASE:), validates
//     `draftResponse` when present, uses `composerGuardV2_1`, and in legacy
//     flat-string replay mode scans only after VERIFIED SUPPORT RECORD using the
//     last SERVICE OUTPUT header.

import {
  REQUIRED_FACT_KEYS,
  type DecisionContract,
  type FaultStage,
} from '../../src/lib/live/types'
import { extractJsonObject, asRecord } from '../../src/lib/live/json'
import {
  composerGuardV2_0,
  composerGuardV2_1,
  DECISIONS,
  REASON_ALLOWED,
  validateRouter,
} from '../../src/lib/live/pipeline'
import type { BaselineOutcome } from './types'
import { faultPayload, SERVICE_OUTPUT_LABEL, type FaultKind } from './faults'

export const VALIDATOR_V1_VERSION = 'validator-v1.0-frozen'
export const VALIDATOR_V2_0_VERSION = 'validator-v2.0-structural'
export const VALIDATOR_V2_1_VERSION = 'validator-v2.1-structured'
export const VALIDATOR_V2_VERSION = VALIDATOR_V2_1_VERSION

export type ValidatorVersionKey = 'v1' | 'v2.0' | 'v2.1' | 'v2'

export interface StructuredServiceOutput {
  stage?: FaultStage | 'untagged'
  payload: string
}

export interface ValidateDirectOpts {
  version?: ValidatorVersionKey
  serviceError?: string | null
  serviceOutputs?: StructuredServiceOutput[]
  draftResponse?: string | null
}

const VALID_DECISIONS = ['approve_refund', 'deny_refund', 'request_review']

export interface ValidatorVerdict {
  halted: boolean
  reason: string | null
  detected: FaultKind | null
  version?: string
  serviceErrorObserved?: boolean
}

function findFaultMarkerV1(evidence: string): FaultKind | null {
  const has = (re: RegExp) => re.test(evidence)
  if (has(/{"route":\s*"refund_request"/)) return 'invalid-json'
  if (has(/"route":\s*"human_triage"/)) return 'missing-route'
  if (has(/"choice":\s*"maybe"/)) return 'jev-invalid-decision'
  if (evidence.includes("we've approved your refund and issued it to your card")) return 'contradicts'
  return null
}

function missingRequiredFacts(facts: Record<string, unknown> | undefined): string[] {
  const f = facts ?? {}
  return REQUIRED_FACT_KEYS.filter((k) => f[k] === undefined || f[k] === null)
}

/** Frozen v1 validator preserved for regression and challenge-set comparisons. */
export function validateDirectModelV1(
  outcome: BaselineOutcome,
  facts: Record<string, unknown> | undefined,
  evidence: string,
): ValidatorVerdict {
  if (!outcome.decision) {
    return { halted: true, reason: 'decision_not_extracted', detected: null, version: VALIDATOR_V1_VERSION }
  }
  if (!VALID_DECISIONS.includes(outcome.decision)) {
    return { halted: true, reason: 'decision_outside_enum', detected: null, version: VALIDATOR_V1_VERSION }
  }
  if (outcome.decision !== 'request_review') {
    const missing = missingRequiredFacts(facts)
    if (missing.length > 0) {
      return {
        halted: true,
        reason: `required_facts_missing:[${missing.join(',')}]`,
        detected: null,
        version: VALIDATOR_V1_VERSION,
      }
    }
  }
  const detected = findFaultMarkerV1(evidence)
  if (detected) {
    return {
      halted: true,
      reason: `service_fault_marker:${detected}`,
      detected,
      version: VALIDATOR_V1_VERSION,
    }
  }
  return { halted: false, reason: null, detected: null, version: VALIDATOR_V1_VERSION }
}

interface ExtractedServiceOutput {
  stage: FaultStage | 'untagged'
  body: string
}

/** V2.0 legacy extractor (vulnerable to CASE: prompt injection by design; preserved for audit). */
function extractServiceOutputV2_0(evidence: string): ExtractedServiceOutput | null {
  const taggedRe = /SERVICE OUTPUT \((semantic_router|jev_judgment|response_composer)\):\s*\n/
  const taggedMatch = taggedRe.exec(evidence)
  let stage: FaultStage | 'untagged' = 'untagged'
  let start = -1
  if (taggedMatch) {
    stage = taggedMatch[1] as FaultStage
    start = taggedMatch.index + taggedMatch[0].length
  } else {
    const legacyIdx = evidence.indexOf(SERVICE_OUTPUT_LABEL)
    if (legacyIdx === -1) return null
    start = legacyIdx + SERVICE_OUTPUT_LABEL.length
    if (evidence[start] === '\r') start++
    if (evidence[start] === '\n') start++
  }

  const tail = evidence.slice(start)
  const endMarker = '\n\nRender your judgement on this case.'
  const endIdx = tail.indexOf(endMarker)
  const body = (endIdx === -1 ? tail : tail.slice(0, endIdx)).trim()
  return { stage, body }
}

/**
 * Legacy flat-string fallback for historical replay: searches ONLY after the
 * authoritative VERIFIED SUPPORT RECORD boundary and uses the last header so
 * customer-supplied text in CASE: cannot spoof or shadow service output.
 */
function extractServiceOutputAfterRecord(evidence: string): ExtractedServiceOutput | null {
  const recordMarker = '\nVERIFIED SUPPORT RECORD (the only source of truth):\n'
  const recordIdx = evidence.indexOf(recordMarker)
  const scoped = recordIdx === -1 ? evidence : evidence.slice(recordIdx + recordMarker.length)
  const headerRe = /SERVICE OUTPUT \((semantic_router|jev_judgment|response_composer)\):\s*\n|SERVICE OUTPUT \(downstream services, for context\):\s*\n/g
  let lastMatch: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  while ((m = headerRe.exec(scoped))) {
    lastMatch = m
  }
  if (!lastMatch) return null
  const stage = (lastMatch[1] as FaultStage | undefined) ?? 'untagged'
  const start = lastMatch.index + lastMatch[0].length
  const tail = scoped.slice(start)
  const endMarker = '\n\nRender your judgement on this case.'
  const endIdx = tail.indexOf(endMarker)
  const body = (endIdx === -1 ? tail : tail.slice(0, endIdx)).trim()
  return { stage, body }
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function validateServiceRouterPayload(body: string): { reason: string; detected: FaultKind | null } | null {
  const trimmed = body.trim()
  if (trimmed.startsWith('[')) {
    return { reason: 'service_structural:malformed_service_json', detected: 'invalid-json' }
  }
  const jsonText = extractJsonObject(trimmed)
  if (!jsonText) {
    return { reason: 'service_structural:malformed_service_json', detected: 'invalid-json' }
  }
  const parsed = safeParseJson(jsonText)
  if (!asRecord(parsed)) {
    return { reason: 'service_structural:malformed_service_json', detected: 'invalid-json' }
  }
  const validated = validateRouter(parsed)
  if (!validated) {
    return { reason: 'service_structural:malformed_service_json', detected: 'invalid-json' }
  }
  if (validated.triage) {
    return { reason: 'service_structural:unroutable_or_triage_route', detected: 'missing-route' }
  }
  return null
}

function validateServiceJudgePayload(
  body: string,
  requireReasonCode: boolean,
): { reason: string; detected: FaultKind | null } | null {
  const trimmed = body.trim()
  if (trimmed.startsWith('[')) {
    return { reason: 'service_structural:malformed_service_json', detected: 'invalid-json' }
  }
  const jsonText = extractJsonObject(trimmed)
  if (!jsonText) {
    return { reason: 'service_structural:malformed_service_json', detected: 'invalid-json' }
  }
  const parsed = asRecord(safeParseJson(jsonText))
  if (!parsed) {
    return { reason: 'service_structural:malformed_service_json', detected: 'invalid-json' }
  }
  const refundDecision = asRecord(parsed.refund_decision)
  const choice = typeof refundDecision?.choice === 'string' ? refundDecision.choice : null
  if (!choice || !DECISIONS.has(choice)) {
    return { reason: 'service_structural:invalid_judge_decision', detected: 'jev-invalid-decision' }
  }
  const confidence = refundDecision?.confidence
  if (typeof confidence === 'number' && confidence < 0.55) {
    return { reason: 'service_structural:low_confidence_judgment', detected: 'jev-invalid-decision' }
  }
  const reasonNode = asRecord(parsed.reason_code)
  if (requireReasonCode || parsed.reason_code !== undefined) {
    const reasonChoice = typeof reasonNode?.choice === 'string' ? reasonNode.choice : null
    if (!reasonChoice || !(REASON_ALLOWED[choice] ?? []).includes(reasonChoice)) {
      return { reason: 'service_structural:invalid_judge_reason_code', detected: 'jev-invalid-decision' }
    }
  }
  return null
}

function validateSingleServiceOutput(
  stage: FaultStage | 'untagged',
  bodyRaw: string,
  decision: DecisionContract['decision'],
  guardFn: typeof composerGuardV2_1,
): { reason: string; detected: FaultKind | null } | null {
  const body = bodyRaw.trim()
  if (body.length === 0) {
    return { reason: 'service_structural:empty_service_output', detected: null }
  }
  if (/^ERROR:/i.test(body)) {
    return { reason: 'service_structural:upstream_service_error', detected: 'jev-500' }
  }
  if (stage === 'semantic_router') {
    return validateServiceRouterPayload(body)
  }
  if (stage === 'jev_judgment') {
    return validateServiceJudgePayload(body, true)
  }
  if (stage === 'response_composer') {
    const guardErr = guardFn(decision, body)
    return guardErr ? { reason: 'service_structural:composer_contradiction', detected: 'contradicts' } : null
  }
  const looksJsonish =
    body.startsWith('{') || body.startsWith('[') || /"(?:route|decision_space|refund_decision|reason_code)"\s*:/.test(body)
  if (looksJsonish) {
    const jsonText = extractJsonObject(body)
    const parsed = jsonText ? asRecord(safeParseJson(jsonText)) : null
    if (parsed && 'refund_decision' in parsed) {
      return validateServiceJudgePayload(body, 'reason_code' in parsed)
    }
    return validateServiceRouterPayload(body)
  }
  const guardErr = guardFn(decision, body)
  return guardErr ? { reason: 'service_structural:composer_contradiction', detected: 'contradicts' } : null
}

function checkCoreContract(
  outcome: BaselineOutcome,
  facts: Record<string, unknown> | undefined,
  version: string,
  serviceError?: string | null,
): ValidatorVerdict | null {
  if (serviceError) {
    return { halted: false, reason: null, detected: null, version, serviceErrorObserved: true }
  }
  if (!outcome.decision) {
    return { halted: true, reason: 'decision_not_extracted', detected: null, version }
  }
  if (!VALID_DECISIONS.includes(outcome.decision)) {
    return { halted: true, reason: 'decision_outside_enum', detected: null, version }
  }
  if (outcome.decision !== 'request_review') {
    const missing = missingRequiredFacts(facts)
    if (missing.length > 0) {
      return {
        halted: true,
        reason: `required_facts_missing:[${missing.join(',')}]`,
        detected: null,
        version,
      }
    }
  }
  return null
}

/** Preserved v2.0 validator (flat-string extraction + v2.0 composer guard). */
export function validateDirectModelV2_0(
  outcome: BaselineOutcome,
  facts: Record<string, unknown> | undefined,
  evidence: string,
  opts?: { serviceError?: string | null },
): ValidatorVerdict {
  const core = checkCoreContract(outcome, facts, VALIDATOR_V2_0_VERSION, opts?.serviceError)
  if (core) return core

  const serviceOut = extractServiceOutputV2_0(evidence)
  if (!serviceOut) {
    return { halted: false, reason: null, detected: null, version: VALIDATOR_V2_0_VERSION }
  }
  const err = validateSingleServiceOutput(
    serviceOut.stage,
    serviceOut.body,
    outcome.decision as DecisionContract['decision'],
    composerGuardV2_0,
  )
  if (err) {
    return { halted: true, reason: err.reason, detected: err.detected, version: VALIDATOR_V2_0_VERSION }
  }
  return { halted: false, reason: null, detected: null, version: VALIDATOR_V2_0_VERSION }
}

/**
 * Structural validator v2.1:
 * - Prefers explicit structured `serviceOutputs` over flat prompt parsing,
 *   preventing customer text in `CASE:` from spoofing or shadowing downstream
 *   service results.
 * - Also checks the Direct-LLM's own `draftResponse` (when supplied) against
 *   its formal `outcome.decision`.
 */
export function validateDirectModelV2_1(
  outcome: BaselineOutcome,
  facts: Record<string, unknown> | undefined,
  evidence: string,
  opts?: { serviceError?: string | null; serviceOutputs?: StructuredServiceOutput[]; draftResponse?: string | null },
): ValidatorVerdict {
  const core = checkCoreContract(outcome, facts, VALIDATOR_V2_1_VERSION, opts?.serviceError)
  if (core) return core

  const decision = outcome.decision as DecisionContract['decision']

  if (opts?.draftResponse !== undefined && opts.draftResponse !== null) {
    const draftErr = composerGuardV2_1(decision, opts.draftResponse)
    if (draftErr) {
      return {
        halted: true,
        reason: 'draft_response_contradiction',
        detected: 'contradicts',
        version: VALIDATOR_V2_1_VERSION,
      }
    }
  }

  if (opts?.serviceOutputs !== undefined) {
    for (const item of opts.serviceOutputs) {
      const err = validateSingleServiceOutput(item.stage ?? 'untagged', item.payload, decision, composerGuardV2_1)
      if (err) {
        return { halted: true, reason: err.reason, detected: err.detected, version: VALIDATOR_V2_1_VERSION }
      }
    }
    return { halted: false, reason: null, detected: null, version: VALIDATOR_V2_1_VERSION }
  }

  const serviceOut = extractServiceOutputAfterRecord(evidence)
  if (!serviceOut) {
    return { halted: false, reason: null, detected: null, version: VALIDATOR_V2_1_VERSION }
  }
  const err = validateSingleServiceOutput(serviceOut.stage, serviceOut.body, decision, composerGuardV2_1)
  if (err) {
    return { halted: true, reason: err.reason, detected: err.detected, version: VALIDATOR_V2_1_VERSION }
  }
  return { halted: false, reason: null, detected: null, version: VALIDATOR_V2_1_VERSION }
}

export const validateDirectModelV2 = validateDirectModelV2_1

export function validateDirectModel(
  outcome: BaselineOutcome,
  facts: Record<string, unknown> | undefined,
  evidence: string,
  opts?: ValidateDirectOpts,
): ValidatorVerdict {
  if (opts?.version === 'v1') {
    return validateDirectModelV1(outcome, facts, evidence)
  }
  if (opts?.version === 'v2.0') {
    return validateDirectModelV2_0(outcome, facts, evidence, { serviceError: opts?.serviceError })
  }
  return validateDirectModelV2_1(outcome, facts, evidence, {
    serviceError: opts?.serviceError,
    serviceOutputs: opts?.serviceOutputs,
    draftResponse: opts?.draftResponse,
  })
}

export function applyValidator(outcome: BaselineOutcome, verdict: ValidatorVerdict): BaselineOutcome {
  if (!verdict.halted) return outcome
  return { decision: 'halt', reasonCode: verdict.reason }
}

export { faultPayload, SERVICE_OUTPUT_LABEL }
