import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  goldForScenario,
  verdictForOutcome,
  verdictForRun,
  verdictForSavedRouterRun,
} from '../src/lib/live/gold'
import { buildDecision, STAGE_KEYS, STAGE_LAYER } from '../src/lib/live/pipeline'
import type { LiveRun, LiveStage, RunStatus, Scenario, StageKey } from '../src/lib/live/types'
import { benchmarkScenarioSet } from '../scripts/lib/scenarios'
import { validateDirectModel } from '../scripts/lib/validator'

const BY_ID = new Map(benchmarkScenarioSet().map((s) => [s.id, s]))

function getScenario(id: string): Scenario {
  const s = BY_ID.get(id)
  assert.ok(s, `missing scenario ${id}`)
  return s
}

function makeRun(
  scenarioId: string,
  status: RunStatus,
  overrides: Partial<Record<StageKey, Partial<LiveStage>>> = {},
  note?: string,
): LiveRun {
  const stages: LiveStage[] = STAGE_KEYS.map((key) => ({
    key,
    layer: STAGE_LAYER[key],
    status: 'done',
    ...overrides[key],
  }))
  return { scenarioId, runId: 1, status, stages, totalMs: 1200, note }
}

describe('Grader v2: intentional handoff vs unrelated failure', () => {
  it('same refund scenario twice (edge-repeat-refunds): intentional handoff passes, unrelated Jev/LLM outage fails', () => {
    const scenario = getScenario('edge-repeat-refunds')
    const gold = goldForScenario(scenario)
    assert.equal(gold.expectedOutcome, 'escalate')

    // Run 1: deliberate policy-specified handoff (request_review / irregular_review)
    const intentional = makeRun('edge-repeat-refunds', 'done', {
      route_contract: { highlight: 'refund_request' },
      decision_contract: {
        highlight: 'request_review',
        output: JSON.stringify({ decision: 'request_review', reasonCode: 'irregular_review' }),
      },
      response_composer: { status: 'done', output: 'A specialist will review your request.' },
      user_response: { status: 'done', output: 'A specialist will review your request.' },
    })
    const passVerdict = verdictForRun(intentional, gold)
    assert.equal(passVerdict.pass, true)
    assert.equal(passVerdict.outcomePass, true)
    assert.equal(passVerdict.stagePass, true)
    assert.equal(passVerdict.classification, 'valid_escalation')

    // Run 2a: same scenario hits an unrelated Jev 502 outage -> MUST FAIL
    const jevOutage = makeRun('edge-repeat-refunds', 'error', {
      route_contract: { highlight: 'refund_request' },
      jev_judgment: { status: 'error', errorCode: 'jev_error', error: '502 Bad Gateway' },
      decision_contract: { status: 'idle' },
      response_composer: { status: 'idle' },
      user_response: { status: 'idle' },
    })
    const jevFailVerdict = verdictForRun(jevOutage, gold)
    assert.equal(jevFailVerdict.pass, false)
    assert.equal(jevFailVerdict.outcomePass, false)
    assert.equal(jevFailVerdict.stagePass, false)
    assert.equal(jevFailVerdict.observedOutcome, 'service_error')
    assert.equal(jevFailVerdict.classification, 'unrelated_service_error')

    // Run 2b: same scenario fails at OpenCode timeout in composer -> MUST FAIL
    const composerTimeout = makeRun('edge-repeat-refunds', 'error', {
      route_contract: { highlight: 'refund_request' },
      decision_contract: {
        highlight: 'request_review',
        output: JSON.stringify({ decision: 'request_review', reasonCode: 'irregular_review' }),
      },
      response_composer: { status: 'error', errorCode: 'opencode_timeout', error: 'Timed out' },
      user_response: { status: 'idle' },
    })
    const timeoutVerdict = verdictForRun(composerTimeout, gold)
    assert.equal(timeoutVerdict.pass, false)
    assert.equal(timeoutVerdict.classification, 'unrelated_service_error')

    // Run 2c: same scenario triages prematurely at route_contract -> MUST FAIL because policy requires irregular_review
    const wrongTriage = makeRun(
      'edge-repeat-refunds',
      'triage',
      {
        route_contract: { highlight: 'human_triage' },
        verified_facts: { status: 'idle' },
        jev_judgment: { status: 'idle' },
        decision_contract: { status: 'idle' },
        response_composer: { status: 'idle' },
        user_response: { status: 'idle' },
      },
      'Route: human_triage',
    )
    const triageVerdict = verdictForRun(wrongTriage, gold)
    assert.equal(triageVerdict.pass, false)
    assert.equal(triageVerdict.classification, 'invalid_escalation_mechanism')
  })

  it('injected outage passes ONLY when that exact outage is the expected fault condition', () => {
    const scenario = getScenario('failure-jev-down')
    const gold = goldForScenario(scenario)
    assert.equal(gold.expectedOutcome, 'stop')
    assert.equal(gold.haltStage, 'jev_judgment')
    assert.equal(gold.haltCode, 'jev_error')

    // Expected Jev outage at jev_judgment -> PASSES
    const expectedOutage = makeRun('failure-jev-down', 'error', {
      route_contract: { highlight: 'refund_request' },
      jev_judgment: { status: 'error', errorCode: 'jev_error', faulted: true },
      decision_contract: { status: 'idle' },
      response_composer: { status: 'idle' },
      user_response: { status: 'idle' },
    })
    const expectedVerdict = verdictForRun(expectedOutage, gold)
    assert.equal(expectedVerdict.pass, true)
    assert.equal(expectedVerdict.outcomePass, true)
    assert.equal(expectedVerdict.stagePass, true)
    assert.equal(expectedVerdict.classification, 'valid_stop')

    // Unrelated OpenCode timeout at semantic_router -> FAILS
    const unrelatedOutage = makeRun('failure-jev-down', 'error', {
      semantic_router: { status: 'error', errorCode: 'opencode_timeout' },
      route_contract: { status: 'idle' },
      verified_facts: { status: 'idle' },
      jev_judgment: { status: 'idle' },
      decision_contract: { status: 'idle' },
      response_composer: { status: 'idle' },
      user_response: { status: 'idle' },
    })
    const unrelatedVerdict = verdictForRun(unrelatedOutage, gold)
    assert.equal(unrelatedVerdict.pass, false)
    assert.equal(unrelatedVerdict.outcomePass, false)
    assert.equal(unrelatedVerdict.stagePass, false)
    assert.equal(unrelatedVerdict.observedOutcome, 'service_error')
    assert.equal(unrelatedVerdict.classification, 'unrelated_service_error')
  })

  it('reproduces and rejects the v1 bug on edge-conflicting-claims while accepting clean triage', () => {
    const scenario = getScenario('edge-conflicting-claims')
    const gold = goldForScenario(scenario)

    // Exact v1 bug: decision_contract wrongly emitted approve_refund, then response_composer timed out
    const v1BugRun = makeRun('edge-conflicting-claims', 'error', {
      route_contract: { highlight: 'refund_request' },
      decision_contract: {
        highlight: 'approve_refund',
        output: JSON.stringify({ decision: 'approve_refund', reasonCode: 'within_refund_window' }),
      },
      response_composer: { status: 'error', errorCode: 'opencode_timeout' },
      user_response: { status: 'idle' },
    })
    const bugVerdict = verdictForRun(v1BugRun, gold)
    assert.equal(bugVerdict.pass, false)
    assert.equal(bugVerdict.classification, 'unrelated_service_error')

    // Clean triage at route_contract -> PASSES
    const cleanTriage = makeRun(
      'edge-conflicting-claims',
      'triage',
      {
        route_contract: { highlight: 'human_triage' },
        verified_facts: { status: 'idle' },
        jev_judgment: { status: 'idle' },
        decision_contract: { status: 'idle' },
        response_composer: { status: 'idle' },
        user_response: { status: 'idle' },
      },
      'Route: human_triage',
    )
    const triageVerdict = verdictForRun(cleanTriage, gold)
    assert.equal(triageVerdict.pass, true)
    assert.equal(triageVerdict.classification, 'valid_escalation')
  })

  it('failure-missing-facts accepts verified_facts/facts_missing or regular_review, but rejects unrelated errors', () => {
    const scenario = getScenario('failure-missing-facts')
    const gold = goldForScenario(scenario)

    const validFactsHalt = makeRun('failure-missing-facts', 'error', {
      route_contract: { highlight: 'refund_request' },
      verified_facts: { status: 'error', errorCode: 'facts_missing' },
      jev_judgment: { status: 'idle' },
      decision_contract: { status: 'idle' },
      response_composer: { status: 'idle' },
      user_response: { status: 'idle' },
    })
    assert.equal(verdictForRun(validFactsHalt, gold).pass, true)

    const unrelatedError = makeRun('failure-missing-facts', 'error', {
      semantic_router: { status: 'error', errorCode: 'opencode_unreachable' },
      route_contract: { status: 'idle' },
      verified_facts: { status: 'idle' },
      jev_judgment: { status: 'idle' },
      decision_contract: { status: 'idle' },
      response_composer: { status: 'idle' },
      user_response: { status: 'idle' },
    })
    const errVerdict = verdictForRun(unrelatedError, gold)
    assert.equal(errVerdict.pass, false)
    assert.equal(errVerdict.classification, 'unrelated_service_error')

    // Baseline outputs: regular_review passes, required_facts_missing validator halt passes, API serviceError fails
    assert.equal(verdictForOutcome({ decision: 'request_review', reasonCode: 'regular_review' }, gold).pass, true)
    assert.equal(
      verdictForOutcome(
        {
          decision: 'halt',
          reasonCode: 'required_facts_missing:[purchase_age_days,refund_window_days,account_status]',
          halted: true,
        },
        gold,
      ).pass,
      true,
    )
    const apiErr = verdictForOutcome(
      { decision: 'halt', reasonCode: 'decision_not_extracted', halted: true, serviceError: '429 rate limited' },
      gold,
    )
    assert.equal(apiErr.pass, false)
    assert.equal(apiErr.classification, 'unrelated_service_error')
  })

  it('separates common outcome checks from router-specific stage checks', () => {
    const scenario = getScenario('refund-10-days')
    const gold = goldForScenario(scenario)

    // Outcome matches (approve_refund / within_refund_window) but router stage check fails (wrong route)
    const wrongRoute = makeRun('refund-10-days', 'done', {
      route_contract: { highlight: 'billing_dispute' },
      decision_contract: {
        highlight: 'approve_refund',
        output: JSON.stringify({ decision: 'approve_refund', reasonCode: 'within_refund_window' }),
      },
      response_composer: { status: 'done', output: 'Your refund is approved.' },
      user_response: { status: 'done', output: 'Your refund is approved.' },
    })
    const routerVerdict = verdictForRun(wrongRoute, gold)
    assert.equal(routerVerdict.outcomePass, true)
    assert.equal(routerVerdict.stagePass, false)
    assert.equal(routerVerdict.pass, false)

    // Baseline verdict leaves stagePass as null
    const baseVerdict = verdictForOutcome(
      { decision: 'approve_refund', reasonCode: 'within_refund_window' },
      gold,
    )
    assert.equal(baseVerdict.outcomePass, true)
    assert.equal(baseVerdict.stagePass, null)
    assert.equal(baseVerdict.pass, true)
  })

  it('never passes baseline API errors masked as halts (gemini-variations 429 pattern)', () => {
    const faultGold = goldForScenario(getScenario('failure-contradicts'))
    const masked429 = verdictForOutcome(
      {
        decision: 'halt',
        reasonCode: 'decision_not_extracted',
        halted: true,
        serviceError: 'gemini-flash-lite-latest throttled: 429 quota exceeded',
      },
      faultGold,
    )
    assert.equal(masked429.pass, false)
    assert.equal(masked429.observedOutcome, 'service_error')
    assert.equal(masked429.classification, 'unrelated_service_error')
  })

  it('verdictForSavedRouterRun flags missing haltStage/haltCode as unverifiable and sets stagePass=null on v1 completed runs', () => {
    const faultGold = goldForScenario(getScenario('failure-jev-down'))
    const audit = verdictForSavedRouterRun(
      {
        scenarioId: 'failure-jev-down',
        decision: null,
        reasonCode: null,
        halted: true,
        actions: [],
      },
      faultGold,
    )
    assert.equal(audit.verifiable, false)
    assert.equal(audit.pass, null)
    assert.equal(audit.classification, 'unverifiable_missing_trace')

    const decideGold = goldForScenario(getScenario('refund-200-days'))
    const completedV1 = verdictForSavedRouterRun(
      {
        scenarioId: 'refund-200-days',
        decision: 'deny_refund',
        reasonCode: 'refund_window_exceeded',
        halted: false,
        actions: [],
      },
      decideGold,
    )
    assert.equal(completedV1.verifiable, true)
    assert.equal(completedV1.outcomePass, true)
    assert.equal(completedV1.stagePass, null)
    assert.equal(completedV1.pass, true)
  })

  it('aligns gold.ts, pipeline.ts, and validator.ts on partial missing facts and regular_review', () => {
    const partialScenario: Scenario = {
      id: 'partial-facts-test',
      label: 'Partial facts',
      group: 'refund',
      userInput: 'Refund my Pro plan from 10 days ago.',
      facts: { purchase_age_days: 10, refund_window_days: 30, previous_refunds_count: 0 },
    }
    const gold = goldForScenario(partialScenario)
    assert.equal(gold.expectedOutcome, 'escalate')
    assert.equal(gold.haltCode, 'facts_missing')

    const val = validateDirectModel(
      { decision: 'approve_refund', reasonCode: 'within_refund_window' },
      partialScenario.facts,
      '',
      { version: 'v2.1' },
    )
    assert.equal(val.halted, true)
    assert.equal(
      verdictForOutcome({ decision: 'halt', reasonCode: val.reason, halted: true, validatorReason: val.reason }, gold).pass,
      true,
    )

    const built = buildDecision(
      {
        answers: {
          refund_decision: { type: 'choice', choice: 'request_review', confidence: 0.91 },
          reason_code: { type: 'choice', choice: 'regular_review', confidence: 0.91 },
        },
        ms: 0,
      },
      { purchase_age_days: 10, refund_window_days: 30, account_status: 'active', previous_refunds_count: 0 },
    )
    assert.ok(built)
    assert.equal(built.contract.decision, 'request_review')
    assert.equal(built.contract.reasonCode, 'regular_review')
  })
})
