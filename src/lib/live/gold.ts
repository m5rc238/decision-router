// Benchmark "gold" reference (grader-v2.0).
//
// Evaluates runs in a common outcome vocabulary across architectures
// (approve_refund | deny_refund | escalate | stop) while keeping
// router-specific stage checks (route_contract, haltStage, haltCode,
// composerGuard) separate from outcome correctness.

import {
  REQUIRED_FACT_KEYS,
  type LiveRun,
  type RunStatus,
  type Scenario,
  type StageKey,
} from './types'
import { STAGE_LAYER } from './pipeline'

export const GRADER_VERSION = 'grader-v2.0'

export type GoldExpect = 'decide' | 'halt'

export type ExpectedOutcomeClass = 'approve_refund' | 'deny_refund' | 'escalate' | 'stop'

export type ObservedOutcomeClass = ExpectedOutcomeClass | 'service_error' | 'invalid'

export type VerdictClassification =
  | 'valid_decision'
  | 'valid_escalation'
  | 'valid_stop'
  | 'unrelated_service_error'
  | 'wrong_decision'
  | 'wrong_reason_code'
  | 'invalid_escalation_mechanism'
  | 'wrong_halt_stage'
  | 'wrong_halt_code'
  | 'unnecessary_stop'
  | 'missed_fault'
  | 'unverifiable_missing_trace'

export type ValidEscalationSpec =
  | { type: 'decision'; decision: 'request_review'; reasonCodes: string[] }
  | { type: 'triage'; stage: 'route_contract'; route: 'human_triage' }
  | { type: 'halt'; stage: 'verified_facts'; errorCode: 'facts_missing' }
  | { type: 'validator_halt'; reasonPrefix: 'required_facts_missing' }

export interface GoldExpectation {
  id: string
  label: string
  route: string
  expect: GoldExpect
  expectedOutcome: ExpectedOutcomeClass
  decision?: string
  reasonCode?: string
  rule: string
  haltStage?: string
  haltCode?: string
  validEscalations?: ValidEscalationSpec[]
  faultApplicableToBaselines?: boolean
}

export const GOLD_ROUTE = {
  refund: 'refund_request',
  triage: 'human_triage',
} as const

const UPSTREAM_SERVICE_ERROR_CODES = new Set([
  'opencode_timeout',
  'opencode_unreachable',
  'opencode_error',
  'opencode_auth_missing',
  'llm_unreachable',
  'jev_error',
  'jev_unreachable',
  'jev_timeout',
  'jev_auth',
  'jev_credits',
  'jev_inactive',
  'jev_api_key_missing',
  'http',
  'internal',
])

export function isUpstreamServiceErrorCode(code: string | null | undefined): boolean {
  return Boolean(code && UPSTREAM_SERVICE_ERROR_CODES.has(code))
}

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

  // Ambiguous intent, conflicting customer claims, or judgment-exception cases:
  // valid escalation is request_review/regular_review or clean route_contract human_triage.
  if (
    s.id === 'ambiguous-plan' ||
    s.id === 'edge-conflicting-claims' ||
    s.id.startsWith('chal-customer-contradicts-') ||
    s.id.startsWith('chal-judgment-')
  ) {
    return {
      ...base,
      route: s.id === 'ambiguous-plan' ? GOLD_ROUTE.triage : GOLD_ROUTE.refund,
      expectedOutcome: 'escalate',
      decision: 'request_review',
      reasonCode: 'regular_review',
      validEscalations: [
        { type: 'decision', decision: 'request_review', reasonCodes: ['regular_review'] },
        { type: 'triage', stage: 'route_contract', route: 'human_triage' },
      ],
      rule: 'Ambiguous intent, conflicting claims, or policy exception — valid escalation is request_review/regular_review or clean route_contract human_triage.',
    }
  }

  // Missing required facts (empty OR partial): never guess undisputed facts.
  const missingFacts = REQUIRED_FACT_KEYS.filter((k) => facts[k] === undefined || facts[k] === null)
  if (missingFacts.length > 0) {
    return {
      ...base,
      expectedOutcome: 'escalate',
      decision: 'request_review',
      reasonCode: 'regular_review',
      haltStage: 'verified_facts',
      haltCode: 'facts_missing',
      validEscalations: [
        { type: 'decision', decision: 'request_review', reasonCodes: ['regular_review'] },
        { type: 'halt', stage: 'verified_facts', errorCode: 'facts_missing' },
        { type: 'validator_halt', reasonPrefix: 'required_facts_missing' },
      ],
      rule: `Missing verified facts (${missingFacts.join(', ')}) — escalate via request_review/regular_review, verified_facts/facts_missing, or validator required_facts_missing.`,
    }
  }

  // Fault-injected stages must be caught at the affected stage.
  if (s.fault) {
    const faultMap = {
      invalidJson: s.fault.stage === 'semantic_router' && s.fault.kind === 'invalid-json',
      missingRoute: s.fault.stage === 'semantic_router' && s.fault.kind === 'missing-route',
      jevInvalid: s.fault.stage === 'jev_judgment' && s.fault.kind === 'jev-invalid-decision',
      jevOutage: s.fault.stage === 'jev_judgment',
    }
    if (faultMap.invalidJson) {
      return {
        ...base,
        expect: 'halt',
        expectedOutcome: 'stop',
        haltStage: 'semantic_router',
        haltCode: 'router_malformed_json',
        faultApplicableToBaselines: true,
        rule: 'Fault: malformed router JSON — fail closed at semantic_router (router_malformed_json).',
      }
    }
    if (faultMap.missingRoute) {
      return {
        ...base,
        route: GOLD_ROUTE.triage,
        expect: 'halt',
        expectedOutcome: 'stop',
        haltStage: 'route_contract',
        faultApplicableToBaselines: true,
        rule: 'Fault: unconfident route — fail closed via clean route_contract human_triage.',
      }
    }
    if (faultMap.jevInvalid) {
      return {
        ...base,
        expect: 'halt',
        expectedOutcome: 'stop',
        haltStage: 'jev_judgment',
        haltCode: 'jev_invalid_output',
        faultApplicableToBaselines: true,
        rule: 'Fault: unknown or mismatched judgment — fail closed at jev_judgment (jev_invalid_output).',
      }
    }
    if (faultMap.jevOutage) {
      return {
        ...base,
        expect: 'halt',
        expectedOutcome: 'stop',
        haltStage: 'jev_judgment',
        haltCode: 'jev_error',
        faultApplicableToBaselines: false,
        rule: 'Fault: Jev upstream unavailable — Router fails closed at jev_judgment (jev_error); N/A for baselines.',
      }
    }
    return {
      ...base,
      expect: 'halt',
      expectedOutcome: 'stop',
      haltStage: 'response_composer',
      haltCode: 'composer_contradiction',
      faultApplicableToBaselines: true,
      rule: 'Fault: composer prose contradicts decision — fail closed at response_composer (composer_contradiction).',
    }
  }

  // Repeated refund activity requires decision-stage escalation (irregular_review).
  if (typeof facts.previous_refunds_count === 'number' && facts.previous_refunds_count >= 2) {
    return {
      ...base,
      expectedOutcome: 'escalate',
      decision: 'request_review',
      reasonCode: 'irregular_review',
      validEscalations: [{ type: 'decision', decision: 'request_review', reasonCodes: ['irregular_review'] }],
      rule: `previous_refunds_count (${facts.previous_refunds_count}) ≥ 2 → policy requires request_review / irregular_review.`,
    }
  }

  if (active && age <= window) {
    return {
      ...base,
      expectedOutcome: 'approve_refund',
      decision: 'approve_refund',
      reasonCode: 'within_refund_window',
      rule: `purchase_age_days (${age}) ≤ refund_window_days (${window}) and account is active → approve_refund / within_refund_window.`,
    }
  }
  if (active) {
    return {
      ...base,
      expectedOutcome: 'deny_refund',
      decision: 'deny_refund',
      reasonCode: 'refund_window_exceeded',
      rule: `purchase_age_days (${age}) > refund_window_days (${window}) → deny_refund / refund_window_exceeded.`,
    }
  }
  return {
    ...base,
    expectedOutcome: 'deny_refund',
    decision: 'deny_refund',
    reasonCode: 'not_eligible',
    rule: 'Account is not active → deny_refund / not_eligible.',
  }
}

export interface GoldCheck {
  name: string
  expected: string
  actual: string | null
  ok: boolean
  scope?: 'outcome' | 'stage'
}

export interface GoldVerdict {
  pass: boolean
  outcomePass: boolean
  stagePass: boolean | null
  expectedOutcome: ExpectedOutcomeClass
  observedOutcome: ObservedOutcomeClass
  classification: VerdictClassification
  checks: GoldCheck[]
  outcomeChecks: GoldCheck[]
  stageChecks: GoldCheck[]
}

function chk(
  name: string,
  expected: string,
  actual: string | null,
  ok: boolean,
  scope: 'outcome' | 'stage',
): GoldCheck {
  return { name, expected, actual, ok, scope }
}

function parseReason(stage?: { output?: string }): string | null {
  if (!stage?.output) return null
  const m = stage.output.match(/"reasonCode"\s*:\s*"([^"]+)"/) ?? stage.output.match(/"reason_code"\s*:\s*"([^"]+)"/)
  return m ? m[1] : null
}

function observedFromDecision(decision: string | null): ObservedOutcomeClass {
  if (decision === 'approve_refund') return 'approve_refund'
  if (decision === 'deny_refund') return 'deny_refund'
  if (decision === 'request_review') return 'escalate'
  if (decision === 'halt') return 'stop'
  return 'invalid'
}

function buildVerdict(
  expectedOutcome: ExpectedOutcomeClass,
  observedOutcome: ObservedOutcomeClass,
  classification: VerdictClassification,
  outcomeChecks: GoldCheck[],
  stageChecks: GoldCheck[] | null,
): GoldVerdict {
  const outcomePass = outcomeChecks.every((c) => c.ok)
  const stagePass = stageChecks === null ? null : stageChecks.every((c) => c.ok)
  const checks = stageChecks ? [...outcomeChecks, ...stageChecks] : outcomeChecks
  return {
    pass: outcomePass && (stagePass ?? true),
    outcomePass,
    stagePass,
    expectedOutcome,
    observedOutcome,
    classification,
    checks,
    outcomeChecks,
    stageChecks: stageChecks ?? [],
  }
}

function matchRoute(gold: GoldExpectation, route: string | null): boolean {
  if (route === gold.route) return true
  const triageAllowsRefundRoute =
    gold.id === 'ambiguous-plan' ||
    gold.id === 'edge-conflicting-claims' ||
    gold.id.startsWith('chal-customer-contradicts-') ||
    gold.id.startsWith('chal-judgment-')
  return triageAllowsRefundRoute && (route === GOLD_ROUTE.refund || route === GOLD_ROUTE.triage)
}

function escalationAllowedDecisions(gold: GoldExpectation): {
  decisionSpec?: Extract<ValidEscalationSpec, { type: 'decision' }>
  triageSpec?: Extract<ValidEscalationSpec, { type: 'triage' }>
  haltSpec?: Extract<ValidEscalationSpec, { type: 'halt' }>
  validatorSpec?: Extract<ValidEscalationSpec, { type: 'validator_halt' }>
} {
  const allowed = gold.validEscalations ?? [
    { type: 'decision', decision: 'request_review', reasonCodes: gold.reasonCode ? [gold.reasonCode] : [] },
  ]
  return {
    decisionSpec: allowed.find((a): a is Extract<ValidEscalationSpec, { type: 'decision' }> => a.type === 'decision'),
    triageSpec: allowed.find((a): a is Extract<ValidEscalationSpec, { type: 'triage' }> => a.type === 'triage'),
    haltSpec: allowed.find((a): a is Extract<ValidEscalationSpec, { type: 'halt' }> => a.type === 'halt'),
    validatorSpec: allowed.find(
      (a): a is Extract<ValidEscalationSpec, { type: 'validator_halt' }> => a.type === 'validator_halt',
    ),
  }
}

export function verdictForRun(run: LiveRun, gold: GoldExpectation): GoldVerdict {
  const byKey = (key: StageKey) => run.stages.find((x) => x.key === key)
  const failed = run.stages.find((x) => x.status === 'error')
  const route = byKey('route_contract')?.highlight ?? null
  const decision = byKey('decision_contract')?.highlight ?? null
  const reason = parseReason(byKey('decision_contract'))
  const composerOk = byKey('response_composer')?.status === 'done'
  const userResponseDone = byKey('user_response')?.status === 'done'

  if (gold.expectedOutcome === 'stop') {
    if (gold.haltCode) {
      const stageMatched = failed?.key === gold.haltStage
      const codeMatched = failed?.errorCode === gold.haltCode
      const noUserDispatch = !userResponseDone

      if (run.status === 'error') {
        const unexpectedUpstream =
          isUpstreamServiceErrorCode(failed?.errorCode) &&
          !(isUpstreamServiceErrorCode(gold.haltCode) && stageMatched && codeMatched)

        if (stageMatched && codeMatched && noUserDispatch) {
          return buildVerdict(
            'stop',
            'stop',
            'valid_stop',
            [chk('common outcome', 'stop', 'stop', true, 'outcome')],
            [
              chk('halt stage', gold.haltStage ?? '—', failed?.key ?? null, true, 'stage'),
              chk('halt reason code', gold.haltCode, failed?.errorCode ?? null, true, 'stage'),
              chk('user response withheld', 'not_sent', 'not_sent', true, 'stage'),
            ],
          )
        }
        if (unexpectedUpstream) {
          return buildVerdict(
            'stop',
            'service_error',
            'unrelated_service_error',
            [chk('common outcome', 'stop (expected fault)', `service_error (${failed?.key ?? 'unknown'}:${failed?.errorCode ?? 'unknown'})`, false, 'outcome')],
            [
              chk('halt stage', gold.haltStage ?? '—', failed?.key ?? null, stageMatched, 'stage'),
              chk('halt reason code', gold.haltCode, failed?.errorCode ?? null, codeMatched, 'stage'),
            ],
          )
        }
        const cls: VerdictClassification = !stageMatched ? 'wrong_halt_stage' : 'wrong_halt_code'
        return buildVerdict(
          'stop',
          'stop',
          cls,
          [chk('common outcome', 'stop', noUserDispatch ? 'stop' : 'dispatched_user_response', noUserDispatch, 'outcome')],
          [
            chk('halt stage', gold.haltStage ?? '—', failed?.key ?? null, stageMatched, 'stage'),
            chk('halt reason code', gold.haltCode, failed?.errorCode ?? null, codeMatched, 'stage'),
            chk('user response withheld', 'not_sent', noUserDispatch ? 'not_sent' : 'sent', noUserDispatch, 'stage'),
          ],
        )
      }

      if (run.status === 'triage') {
        return buildVerdict(
          'stop',
          'escalate',
          'wrong_halt_stage',
          [chk('common outcome', 'stop', 'escalate (triage)', false, 'outcome')],
          [
            chk('halt stage', gold.haltStage ?? '—', 'route_contract', false, 'stage'),
            chk('halt reason code', gold.haltCode, 'human_triage', false, 'stage'),
          ],
        )
      }

      const obs = observedFromDecision(decision)
      return buildVerdict(
        'stop',
        obs,
        'missed_fault',
        [chk('common outcome', 'stop', `${obs} (${decision ?? 'none'})`, false, 'outcome')],
        [chk('halt stage', gold.haltStage ?? '—', 'none (completed)', false, 'stage')],
      )
    }

    // Missing route expects clean route_contract human_triage (never an error).
    if (run.status === 'triage' && !failed && route === 'human_triage' && !userResponseDone) {
      return buildVerdict(
        'stop',
        'stop',
        'valid_stop',
        [chk('common outcome', 'stop', 'stop (triage)', true, 'outcome')],
        [
          chk('halt stage', gold.haltStage ?? 'route_contract', 'route_contract', true, 'stage'),
          chk('route', 'human_triage', route, true, 'stage'),
        ],
      )
    }
    if (run.status === 'error') {
      const upstream = isUpstreamServiceErrorCode(failed?.errorCode)
      const obs: ObservedOutcomeClass = upstream ? 'service_error' : 'invalid'
      return buildVerdict(
        'stop',
        obs,
        upstream ? 'unrelated_service_error' : 'wrong_halt_stage',
        [chk('common outcome', 'stop (route triage)', `${obs} (${failed?.key ?? 'unknown'}:${failed?.errorCode ?? 'unknown'})`, false, 'outcome')],
        [chk('halt stage', gold.haltStage ?? 'route_contract', failed?.key ?? null, false, 'stage')],
      )
    }
    const obs = observedFromDecision(decision)
    return buildVerdict(
      'stop',
      obs,
      'missed_fault',
      [chk('common outcome', 'stop', `${obs} (${decision ?? 'none'})`, false, 'outcome')],
      [chk('halt stage', gold.haltStage ?? 'route_contract', 'none (completed)', false, 'stage')],
    )
  }

  if (gold.expectedOutcome === 'escalate') {
    const { decisionSpec, triageSpec, haltSpec } = escalationAllowedDecisions(gold)

    if (run.status === 'error') {
      if (haltSpec && failed?.key === haltSpec.stage && failed?.errorCode === haltSpec.errorCode && !userResponseDone) {
        return buildVerdict(
          'escalate',
          'stop',
          'valid_escalation',
          [chk('common outcome', 'escalate (or allowed halt)', `stop (${failed.errorCode})`, true, 'outcome')],
          [
            chk('escalation stage', haltSpec.stage, failed.key, true, 'stage'),
            chk('escalation error code', haltSpec.errorCode, failed.errorCode ?? null, true, 'stage'),
          ],
        )
      }
      const upstream = isUpstreamServiceErrorCode(failed?.errorCode)
      const obs: ObservedOutcomeClass = upstream ? 'service_error' : 'invalid'
      const detail = `${failed?.key ?? 'unknown'}:${failed?.errorCode ?? 'unknown'}`
      return buildVerdict(
        'escalate',
        obs,
        upstream ? 'unrelated_service_error' : 'invalid_escalation_mechanism',
        [chk('common outcome', 'escalate', `${obs} (${detail}${decision ? `; emitted ${decision}` : ''})`, false, 'outcome')],
        [chk('escalation mechanism', (gold.validEscalations ?? []).map((x) => x.type).join(' | '), `error (${detail})`, false, 'stage')],
      )
    }

    if (run.status === 'triage') {
      if (triageSpec && !failed && route === triageSpec.route && !userResponseDone) {
        return buildVerdict(
          'escalate',
          'escalate',
          'valid_escalation',
          [chk('common outcome', 'escalate', 'escalate (triage)', true, 'outcome')],
          [
            chk('escalation stage', triageSpec.stage, 'route_contract', true, 'stage'),
            chk('route', triageSpec.route, route, true, 'stage'),
          ],
        )
      }
      return buildVerdict(
        'escalate',
        'escalate',
        'invalid_escalation_mechanism',
        [chk('common outcome', decisionSpec ? `request_review (${decisionSpec.reasonCodes.join('/')})` : 'escalate', 'triage (policy requires judgment escalation)', false, 'outcome')],
        [chk('escalation mechanism', (gold.validEscalations ?? []).map((x) => x.type).join(' | '), `triage (${route ?? 'none'})`, false, 'stage')],
      )
    }

    const decOk = Boolean(decisionSpec && decision === decisionSpec.decision)
    const reasonOk = Boolean(decisionSpec && reason && decisionSpec.reasonCodes.includes(reason))
    const statusOk = run.status === 'done'
    const routeOk = matchRoute(gold, route)
    let cls: VerdictClassification = 'valid_escalation'
    if (!statusOk || !decOk) cls = 'wrong_decision'
    else if (!reasonOk) cls = 'wrong_reason_code'
    else if (!routeOk || !composerOk) cls = 'invalid_escalation_mechanism'

    return buildVerdict(
      'escalate',
      observedFromDecision(decision),
      cls,
      [
        chk('no service error', 'none', failed ? `${failed.key}:${failed.errorCode ?? 'error'}` : 'none', !failed, 'outcome'),
        chk('decision', decisionSpec?.decision ?? 'request_review', decision, decOk, 'outcome'),
        chk('reason code', decisionSpec?.reasonCodes.join(' | ') ?? gold.reasonCode ?? '', reason, reasonOk, 'outcome'),
      ],
      [
        chk('pipeline status', 'done', run.status, statusOk, 'stage'),
        chk('route', gold.route, route, routeOk, 'stage'),
        chk('final message consistent', 'guardrail passed', composerOk ? 'guardrail passed' : 'rejected', composerOk, 'stage'),
      ],
    )
  }

  // approve_refund | deny_refund
  if (run.status === 'error') {
    const upstream = isUpstreamServiceErrorCode(failed?.errorCode)
    const obs: ObservedOutcomeClass = upstream ? 'service_error' : 'stop'
    return buildVerdict(
      gold.expectedOutcome,
      obs,
      upstream ? 'unrelated_service_error' : 'unnecessary_stop',
      [chk('common outcome', gold.expectedOutcome, `${obs} (${failed?.key ?? 'unknown'}:${failed?.errorCode ?? 'unknown'})`, false, 'outcome')],
      [chk('pipeline status', 'done', `error (${failed?.key ?? 'unknown'}:${failed?.errorCode ?? 'unknown'})`, false, 'stage')],
    )
  }

  if (run.status === 'triage') {
    return buildVerdict(
      gold.expectedOutcome,
      'escalate',
      'unnecessary_stop',
      [chk('common outcome', gold.expectedOutcome, 'escalate (triage)', false, 'outcome')],
      [
        chk('pipeline status', 'done', 'triage', false, 'stage'),
        chk('route', gold.route, route, false, 'stage'),
      ],
    )
  }

  const decOk = decision === gold.decision
  const reasonOk = reason === gold.reasonCode
  const statusOk = run.status === 'done'
  const routeOk = route === gold.route
  let cls: VerdictClassification = 'valid_decision'
  if (!decOk) cls = 'wrong_decision'
  else if (!reasonOk) cls = 'wrong_reason_code'
  else if (!statusOk || !routeOk || !composerOk) cls = 'invalid_escalation_mechanism'

  return buildVerdict(
    gold.expectedOutcome,
    observedFromDecision(decision),
    cls,
    [
      chk('no service error', 'none', 'none', true, 'outcome'),
      chk('decision', gold.decision ?? '', decision, decOk, 'outcome'),
      chk('reason code', gold.reasonCode ?? '', reason, reasonOk, 'outcome'),
    ],
    [
      chk('pipeline status', 'done', run.status, statusOk, 'stage'),
      chk('route', gold.route, route, routeOk, 'stage'),
      chk('final message consistent', 'guardrail passed', composerOk ? 'guardrail passed' : 'rejected', composerOk, 'stage'),
    ],
  )
}

/** Common outcome grading for baseline / validator / rule-engine architectures. */
export interface OutcomeVerdict {
  decision: string | null
  reasonCode?: string | null
  halted?: boolean
  serviceError?: string | null
  validatorReason?: string | null
}

export function verdictForOutcome(outcome: OutcomeVerdict, gold: GoldExpectation): GoldVerdict {
  if (outcome.serviceError) {
    return buildVerdict(
      gold.expectedOutcome,
      'service_error',
      'unrelated_service_error',
      [chk('no service error', 'none', outcome.serviceError, false, 'outcome')],
      null,
    )
  }

  const isHalt = outcome.decision === 'halt' || outcome.halted === true

  if (gold.expectedOutcome === 'stop') {
    if (isHalt) {
      return buildVerdict(
        'stop',
        'stop',
        'valid_stop',
        [chk('stops on fault', 'stop (halt)', outcome.validatorReason ?? outcome.reasonCode ?? 'halt', true, 'outcome')],
        null,
      )
    }
    return buildVerdict(
      'stop',
      observedFromDecision(outcome.decision),
      'missed_fault',
      [chk('stops on fault', 'stop (halt)', outcome.decision ? `${outcome.decision} (${outcome.reasonCode ?? 'no reason'})` : 'no decision', false, 'outcome')],
      null,
    )
  }

  if (gold.expectedOutcome === 'escalate') {
    const { decisionSpec, validatorSpec } = escalationAllowedDecisions(gold)
    if (isHalt) {
      const reasonStr = outcome.validatorReason ?? outcome.reasonCode ?? ''
      const validatorMatch = Boolean(validatorSpec && reasonStr.startsWith(validatorSpec.reasonPrefix))
      return buildVerdict(
        'escalate',
        'stop',
        validatorMatch ? 'valid_escalation' : 'unnecessary_stop',
        [chk('escalation outcome', validatorSpec ? `request_review or ${validatorSpec.reasonPrefix}` : 'request_review', `halt (${reasonStr || 'no reason'})`, validatorMatch, 'outcome')],
        null,
      )
    }
    const decOk = Boolean(decisionSpec && outcome.decision === decisionSpec.decision)
    const reasonOk = Boolean(decisionSpec && outcome.reasonCode && decisionSpec.reasonCodes.includes(outcome.reasonCode))
    return buildVerdict(
      'escalate',
      observedFromDecision(outcome.decision),
      decOk && reasonOk ? 'valid_escalation' : !decOk ? 'wrong_decision' : 'wrong_reason_code',
      [
        chk('decision', decisionSpec?.decision ?? 'request_review', outcome.decision ?? '—', decOk, 'outcome'),
        chk('reason code', decisionSpec?.reasonCodes.join(' | ') ?? gold.reasonCode ?? '—', outcome.reasonCode ?? '—', reasonOk, 'outcome'),
      ],
      null,
    )
  }

  if (isHalt) {
    return buildVerdict(
      gold.expectedOutcome,
      'stop',
      'unnecessary_stop',
      [chk('no unnecessary stop', gold.decision ?? gold.expectedOutcome, `halt (${outcome.validatorReason ?? outcome.reasonCode ?? 'no reason'})`, false, 'outcome')],
      null,
    )
  }

  const decOk = outcome.decision === gold.decision
  const reasonOk = outcome.reasonCode === gold.reasonCode
  return buildVerdict(
    gold.expectedOutcome,
    observedFromDecision(outcome.decision),
    decOk && reasonOk ? 'valid_decision' : !decOk ? 'wrong_decision' : 'wrong_reason_code',
    [
      chk('decision', gold.decision ?? '—', outcome.decision ?? '—', decOk, 'outcome'),
      chk('reason code', gold.reasonCode ?? '—', outcome.reasonCode ?? '—', reasonOk, 'outcome'),
    ],
    null,
  )
}

export interface SavedStageTrace {
  key: StageKey
  status: 'idle' | 'running' | 'done' | 'error'
  highlight?: string
  output?: string
  error?: string
  errorCode?: string
  ms?: number
  faulted?: boolean
}

export interface SavedRouterRunRecord {
  scenarioId: string
  decision: string | null
  reasonCode: string | null
  halted: boolean
  pass?: boolean
  ms?: number
  actions?: string[]
  error?: string
  runStatus?: RunStatus
  route?: string | null
  haltStage?: string | null
  haltCode?: string | null
  stages?: SavedStageTrace[]
}

export interface SavedRunAuditResult {
  verifiable: boolean
  pass: boolean | null
  outcomePass: boolean | null
  stagePass: boolean | null
  expectedOutcome: ExpectedOutcomeClass
  observedOutcome: ObservedOutcomeClass | 'unverifiable'
  classification: VerdictClassification
  note: string
  verdict?: GoldVerdict
}

/**
 * Re-score a saved Router run from a result bundle.
 * When `stages` + `runStatus` are absent (historical v1 JSON), outcomes on
 * non-halted runs are scored with `stagePass: null` (stage trace was not saved),
 * provably invalid halts fail, and halts lacking `haltStage`/`haltCode` are
 * marked unverifiable rather than silently passed.
 */
export function verdictForSavedRouterRun(rec: SavedRouterRunRecord, gold: GoldExpectation): SavedRunAuditResult {
  if (rec.stages && rec.stages.length > 0 && rec.runStatus) {
    const liveRun: LiveRun = {
      scenarioId: rec.scenarioId,
      runId: 0,
      status: rec.runStatus,
      stages: rec.stages.map((s) => ({ ...s, layer: STAGE_LAYER[s.key] })),
      totalMs: rec.ms ?? 0,
      note: rec.actions?.find((a) => a.startsWith('note:'))?.slice(5),
    }
    const v = verdictForRun(liveRun, gold)
    return {
      verifiable: true,
      pass: v.pass,
      outcomePass: v.outcomePass,
      stagePass: v.stagePass,
      expectedOutcome: v.expectedOutcome,
      observedOutcome: v.observedOutcome,
      classification: v.classification,
      note: 'Verified from recorded stage trace.',
      verdict: v,
    }
  }

  const actions = rec.actions ?? []
  const hasTriageNote = actions.some((a) => a.startsWith('note:Route: human_triage'))

  if (rec.error) {
    return {
      verifiable: true,
      pass: false,
      outcomePass: false,
      stagePass: false,
      expectedOutcome: gold.expectedOutcome,
      observedOutcome: 'service_error',
      classification: 'unrelated_service_error',
      note: `Runner recorded error: ${rec.error}`,
    }
  }

  if (gold.expectedOutcome === 'approve_refund' || gold.expectedOutcome === 'deny_refund') {
    if (rec.halted) {
      return {
        verifiable: true,
        pass: false,
        outcomePass: false,
        stagePass: false,
        expectedOutcome: gold.expectedOutcome,
        observedOutcome: rec.decision ? 'stop' : hasTriageNote ? 'escalate' : 'stop',
        classification: rec.decision ? 'unrelated_service_error' : 'unnecessary_stop',
        note: rec.decision
          ? `Emitted ${rec.decision}/${rec.reasonCode ?? '—'} but halted downstream before completing response dispatch.`
          : 'Halted on a decidable scenario.',
      }
    }
    const ov = verdictForOutcome({ decision: rec.decision, reasonCode: rec.reasonCode, halted: false }, gold)
    return {
      verifiable: true,
      pass: ov.pass,
      outcomePass: ov.outcomePass,
      stagePass: null,
      expectedOutcome: gold.expectedOutcome,
      observedOutcome: ov.observedOutcome,
      classification: ov.classification,
      note: ov.pass
        ? 'Outcome verified from saved decision/reasonCode; stage trace (route/composer) was not persisted in v1.'
        : `Expected ${gold.decision}/${gold.reasonCode}, got ${rec.decision}/${rec.reasonCode}.`,
    }
  }

  if (gold.expectedOutcome === 'escalate') {
    const { triageSpec, haltSpec } = escalationAllowedDecisions(gold)
    if (!rec.halted) {
      const ov = verdictForOutcome({ decision: rec.decision, reasonCode: rec.reasonCode, halted: false }, gold)
      return {
        verifiable: true,
        pass: ov.pass,
        outcomePass: ov.outcomePass,
        stagePass: null,
        expectedOutcome: 'escalate',
        observedOutcome: ov.observedOutcome,
        classification: ov.classification,
        note: ov.pass
          ? 'Outcome verified from saved escalation decision/reasonCode; stage trace (route/composer) was not persisted in v1.'
          : `Expected ${gold.decision}/${gold.reasonCode}, got ${rec.decision}/${rec.reasonCode}.`,
      }
    }
    if (hasTriageNote && triageSpec) {
      return {
        verifiable: true,
        pass: true,
        outcomePass: true,
        stagePass: true,
        expectedOutcome: 'escalate',
        observedOutcome: 'escalate',
        classification: 'valid_escalation',
        note: 'Clean route_contract human_triage recorded in run note.',
      }
    }
    if (hasTriageNote && !triageSpec) {
      return {
        verifiable: true,
        pass: false,
        outcomePass: false,
        stagePass: false,
        expectedOutcome: 'escalate',
        observedOutcome: 'escalate',
        classification: 'invalid_escalation_mechanism',
        note: 'Triaged at router when policy required decision-stage request_review.',
      }
    }
    if (rec.decision !== null) {
      return {
        verifiable: true,
        pass: false,
        outcomePass: false,
        stagePass: false,
        expectedOutcome: 'escalate',
        observedOutcome: 'service_error',
        classification: 'unrelated_service_error',
        note: `Formed decision ${rec.decision}/${rec.reasonCode ?? '—'} then halted downstream (e.g. response_composer error/timeout), not a valid escalation.`,
      }
    }
    if (haltSpec) {
      return {
        verifiable: false,
        pass: null,
        outcomePass: null,
        stagePass: null,
        expectedOutcome: 'escalate',
        observedOutcome: 'unverifiable',
        classification: 'unverifiable_missing_trace',
        note: `Historical v1 record lacks haltStage/haltCode; cannot verify whether halt was ${haltSpec.stage}/${haltSpec.errorCode} vs an unrelated upstream outage.`,
      }
    }
    return {
      verifiable: true,
      pass: false,
      outcomePass: false,
      stagePass: false,
      expectedOutcome: 'escalate',
      observedOutcome: 'service_error',
      classification: 'invalid_escalation_mechanism',
      note: 'Halted with decision=null and no human_triage note when policy required request_review/irregular_review.',
    }
  }

  // gold.expectedOutcome === 'stop'
  if (!rec.halted) {
    return {
      verifiable: true,
      pass: false,
      outcomePass: false,
      stagePass: false,
      expectedOutcome: 'stop',
      observedOutcome: observedFromDecision(rec.decision),
      classification: 'missed_fault',
      note: `Did not halt on fault scenario; emitted ${rec.decision}/${rec.reasonCode}.`,
    }
  }
  if (!gold.haltCode && gold.haltStage === 'route_contract') {
    return hasTriageNote
      ? {
          verifiable: true,
          pass: true,
          outcomePass: true,
          stagePass: true,
          expectedOutcome: 'stop',
          observedOutcome: 'stop',
          classification: 'valid_stop',
          note: 'Clean route_contract human_triage recorded in run note.',
        }
      : {
          verifiable: true,
          pass: false,
          outcomePass: false,
          stagePass: false,
          expectedOutcome: 'stop',
          observedOutcome: 'service_error',
          classification: 'unrelated_service_error',
          note: 'Expected clean route_contract human_triage, but halted without triage note.',
        }
  }

  return {
    verifiable: false,
    pass: null,
    outcomePass: null,
    stagePass: null,
    expectedOutcome: 'stop',
    observedOutcome: 'unverifiable',
    classification: 'unverifiable_missing_trace',
    note: `Historical v1 record lacks haltStage/haltCode; cannot verify whether halt was ${gold.haltStage}/${gold.haltCode} vs an unrelated upstream error.`,
  }
}
