import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runLivePipeline } from '../src/lib/live/pipeline'
import type { Scenario } from '../src/lib/live/types'
import { evaluateDeterministicRulesOnScenarios } from '../scripts/lib/challenge'

describe('Pipeline concurrency, partial missing facts, and deterministic rules baseline', () => {
  it('runs concurrent runLivePipeline calls independently without cancelling each other', async () => {
    const s1: Scenario = {
      id: 'refund-10-days',
      label: '10d approve',
      group: 'refund',
      userInput: 'Refund my 10-day Pro plan.',
      facts: { purchase_age_days: 10, refund_window_days: 30, account_status: 'active', previous_refunds_count: 0 },
    }
    const s2: Scenario = {
      id: 'refund-200-days',
      label: '200d deny',
      group: 'refund',
      userInput: 'Refund my 200-day Pro plan.',
      facts: { purchase_age_days: 200, refund_window_days: 30, account_status: 'active', previous_refunds_count: 0 },
    }

    const mkDeps = (decision: string, reasonCode: string, delayMs: number) => ({
      callLlm: async (prompt: string) => {
        await new Promise((r) => setTimeout(r, delayMs))
        if (prompt.includes('Semantic Router')) {
          return {
            text: JSON.stringify({
              route: 'refund_request',
              decision_space: 'plan_change_policy',
              extracted_entities: {},
              ambiguity: [],
            }),
            modelID: 'mock',
            providerID: 'mock',
            ms: delayMs,
            tokens: { input: 10, output: 10 },
          }
        }
        return {
          text:
            decision === 'approve_refund'
              ? 'Your refund has been approved within the 30-day window.'
              : 'Your refund request is denied because the purchase is outside the 30-day window.',
          modelID: 'mock',
          providerID: 'mock',
          ms: delayMs,
          tokens: { input: 10, output: 10 },
        }
      },
      callJev: async () => ({
        answers: {
          refund_decision: { type: 'choice', choice: decision, confidence: 0.99 },
          reason_code: { type: 'choice', choice: reasonCode, confidence: 0.99 },
        },
        ms: 5,
      }),
    })

    const [r1, r2] = await Promise.all([
      runLivePipeline({
        scenario: s1,
        onUpdate: () => {},
        deps: mkDeps('approve_refund', 'within_refund_window', 30),
      }),
      runLivePipeline({
        scenario: s2,
        onUpdate: () => {},
        deps: mkDeps('deny_refund', 'refund_window_exceeded', 5),
      }),
    ])

    assert.equal(r1.status, 'done')
    assert.equal(r2.status, 'done')
    assert.equal(r1.stages.find((s) => s.key === 'decision_contract')?.highlight, 'approve_refund')
    assert.equal(r2.stages.find((s) => s.key === 'decision_contract')?.highlight, 'deny_refund')
  })

  it('respects explicit AbortSignal and fails closed on partial missing facts', async () => {
    const partial: Scenario = {
      id: 'partial-facts',
      label: 'Missing account_status',
      group: 'refund',
      userInput: 'Refund my Pro plan.',
      facts: { purchase_age_days: 10, refund_window_days: 30, previous_refunds_count: 0 },
    }
    const partialRun = await runLivePipeline({
      scenario: partial,
      onUpdate: () => {},
      deps: {
        callLlm: async () => ({
          text: JSON.stringify({
            route: 'refund_request',
            decision_space: 'plan_change_policy',
            extracted_entities: {},
            ambiguity: [],
          }),
          modelID: 'mock',
          providerID: 'mock',
          ms: 1,
          tokens: {},
        }),
        callJev: async () => {
          throw new Error('should not call Jev when required facts are missing')
        },
      },
    })
    assert.equal(partialRun.status, 'error')
    const vf = partialRun.stages.find((s) => s.key === 'verified_facts')
    assert.equal(vf?.status, 'error')
    assert.equal(vf?.errorCode, 'facts_missing')

    const ac = new AbortController()
    const abortedRun = await runLivePipeline({
      scenario: {
        id: 'refund-10-days',
        label: 'abort',
        group: 'refund',
        userInput: 'Refund',
        facts: { purchase_age_days: 10, refund_window_days: 30, account_status: 'active' },
      },
      signal: ac.signal,
      onUpdate: () => {},
      deps: {
        callLlm: async () => {
          ac.abort()
          return { text: '{}', modelID: 'mock', providerID: 'mock', ms: 1, tokens: {} }
        },
      },
    })
    assert.equal(abortedRun.status, 'running')
  })

  it('deterministic rules baseline scores 13/15 on decide scenarios and 4/4 on shared faults', () => {
    const rb = evaluateDeterministicRulesOnScenarios()
    assert.equal(rb.uniqueDecideScenarios, 15)
    assert.equal(rb.decidePass, 13)
    assert.deepEqual(rb.failedDecideIds.sort(), ['ambiguous-plan', 'edge-conflicting-claims'])
    assert.equal(rb.uniqueSharedFaults, 4)
    assert.equal(rb.sharedFaultPass, 4)
    assert.equal(rb.judgmentCasesMechanicalFail, 2)
  })
})
