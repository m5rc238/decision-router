import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateDeterministicChallenge,
  CHALLENGE_SET_VERSION,
  POST_V2_AUDIT_VERSION,
} from '../scripts/lib/challenge'
import {
  validateDirectModel,
  VALIDATOR_V1_VERSION,
  VALIDATOR_V2_0_VERSION,
  VALIDATOR_V2_1_VERSION,
} from '../scripts/lib/validator'

describe('Validator 3-version audit, prompt injection fix, and regex ceiling', () => {
  it('original 4 regression fixtures pass on v1, v2.0, and v2.1', () => {
    const v1 = evaluateDeterministicChallenge('v1')
    const v20 = evaluateDeterministicChallenge('v2.0')
    const v21 = evaluateDeterministicChallenge('v2.1')

    assert.equal(v1.validatorVersion, VALIDATOR_V1_VERSION)
    assert.equal(v1.challengeSetVersion, CHALLENGE_SET_VERSION)
    assert.equal(v20.validatorVersion, VALIDATOR_V2_0_VERSION)
    assert.equal(v20.auditSetVersion, POST_V2_AUDIT_VERSION)
    assert.equal(v21.validatorVersion, VALIDATOR_V2_1_VERSION)

    for (const s of [v1, v20, v21]) {
      assert.equal(s.slices.original_regression.uniqueScenarios, 4)
      assert.equal(s.slices.original_regression.directValidatorPass, 4)
      assert.equal(s.slices.original_regression.routerPass, 4)
    }
  })

  it('frozen v1 preserves 0/8 shared faults & 3/4 unnecessary stops; router-guards-v1 misses 1/8', () => {
    const v1 = evaluateDeterministicChallenge('v1')
    assert.equal(v1.slices.shared_fault.directValidatorPass, 0)
    assert.equal(v1.slices.shared_fault.directValidatorFail, 8)
    assert.equal(v1.slices.valid_resembling_fault.directValidatorPass, 1)
    assert.equal(v1.slices.valid_resembling_fault.directValidatorFail, 3)

    assert.equal(v1.slices.shared_fault.routerPass, 7)
    assert.equal(v1.slices.shared_fault.routerFail, 1)
    assert.equal(v1.slices.valid_resembling_fault.routerPass, 4)
    assert.equal(v1.componentOutagesSeparate.routerCaught, 1)
  })

  it('frozen v2.0 audit preserves all 3 exposed failures (handoff prose + 2 customer prompt injections)', () => {
    const v20 = evaluateDeterministicChallenge('v2.0')
    assert.equal(v20.slices.shared_fault.directValidatorPass, 8)
    assert.equal(v20.slices.valid_resembling_fault.directValidatorPass, 4)
    assert.equal(v20.slices.post_v2_audit_fault.directValidatorPass, 4)
    assert.equal(v20.slices.post_v2_audit_valid.directValidatorPass, 1)
    assert.equal(v20.slices.post_v2_audit_valid.directValidatorFail, 1)
    assert.equal(v20.slices.post_v2_audit_valid.routerPass, 1)
    assert.equal(v20.slices.post_v2_audit_valid.routerFail, 1)
    assert.equal(v20.slices.post_v2_prompt_injection.directValidatorPass, 0)
    assert.equal(v20.slices.post_v2_prompt_injection.directValidatorFail, 2)
  })

  it('v2.1 fixes v2.0 audit + prompt injections + direct-native faults while honestly exposing regex-stress ceiling (0/4)', () => {
    const v21 = evaluateDeterministicChallenge('v2.1')
    assert.equal(v21.slices.shared_fault.directValidatorPass, 8)
    assert.equal(v21.slices.shared_fault.routerPass, 8)
    assert.equal(v21.slices.valid_resembling_fault.directValidatorPass, 4)
    assert.equal(v21.slices.valid_resembling_fault.routerPass, 4)
    assert.equal(v21.slices.post_v2_audit_fault.directValidatorPass, 4)
    assert.equal(v21.slices.post_v2_audit_valid.directValidatorPass, 2)
    assert.equal(v21.slices.post_v2_audit_valid.routerPass, 2)
    assert.equal(v21.slices.post_v2_prompt_injection.directValidatorPass, 2)
    assert.equal(v21.slices.post_v2_prompt_injection.routerPass, 2)
    assert.equal(v21.slices.direct_native_fault.directValidatorPass, 3)
    assert.equal(v21.slices.direct_native_fault.directValidatorFail, 0)

    // Deliberately un-tuned regex ceiling probe: all 4 stress cases fail on BOTH architectures
    assert.equal(v21.slices.regex_stress.uniqueScenarios, 4)
    assert.equal(v21.slices.regex_stress.directValidatorFail, 4)
    assert.equal(v21.slices.regex_stress.routerFail, 4)

    assert.deepEqual(v21.pendingLiveModelCases, [
      'chal-customer-contradicts-timeline',
      'chal-customer-contradicts-status',
      'chal-judgment-outage-exception',
      'chal-judgment-legal-threat-first-refund',
    ])
  })

  it('validator-v2.1 never masks upstream API serviceError as a passing halt', () => {
    const res = validateDirectModel(
      { decision: null, reasonCode: null },
      { purchase_age_days: 200, refund_window_days: 30, account_status: 'active', previous_refunds_count: 0 },
      'CASE:\nRefund please.',
      { version: 'v2.1', serviceError: '429 Too Many Requests' },
    )
    assert.equal(res.halted, false)
    assert.equal(res.serviceErrorObserved, true)
    assert.equal(res.version, VALIDATOR_V2_1_VERSION)
  })
})
