import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { runOfflineReplay } from '../scripts/lib/replay'
import { evaluateDeterministicChallenge } from '../scripts/lib/challenge'

describe('Published offline bundle & independent replay', () => {
  it('all files under results/ are sanitized and match the expected file list', () => {
    const dir = resolve('results')
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    assert.deepEqual(files, [
      'challenge-eval-v1-frozen.json',
      'challenge-eval-v2.0-audit.json',
      'challenge-eval-v2.1-structured.json',
      'offline-replay-bundle.v2.json',
      'synthetic-trace-fixtures.v2.json',
    ])

    const forbidden = [/apikey_/i, /jv_live_/i, /AIza[0-9A-Za-z_-]{10,}/, /\/Users\//, /OPENCODE_SERVER_PASSWORD/]
    for (const file of files) {
      const content = readFileSync(resolve(dir, file), 'utf8')
      for (const pattern of forbidden) {
        assert.equal(pattern.test(content), false, `Forbidden pattern ${pattern} found in results/${file}`)
      }
    }
  })

  it('recomputes rules_only baseline, historical v1 counts, exact 3 flips, 10 unverifiable halts, and 20 stage-unknown runs', () => {
    const report = runOfflineReplay()

    assert.equal(report.bundleVersion, '2.1.0')
    assert.equal(report.graderVersion, 'grader-v2.0')
    assert.equal(report.rulesOnlyBaseline.decidePass, 13)
    assert.equal(report.rulesOnlyBaseline.uniqueDecideScenarios, 15)
    assert.equal(report.rulesOnlyBaseline.sharedFaultPass, 4)

    const router = report.v1Main.find((p) => p.pipeline === 'router')
    const cot = report.v1Main.find((p) => p.pipeline === 'cot')
    const react = report.v1Main.find((p) => p.pipeline === 'react')
    assert.ok(router && cot && react)

    assert.equal(router.historicalReported.decidePass, 26)
    assert.equal(router.historicalReported.haltPass, 10)
    assert.equal(router.rescoredV2.decideConfirmedPass, 21)
    assert.equal(router.rescoredV2.decideConfirmedFail, 7)
    assert.equal(router.rescoredV2.decideUnverifiable, 2)
    assert.equal(router.rescoredV2.sharedFaultConfirmedPass, 2)
    assert.equal(router.rescoredV2.sharedFaultUnverifiable, 6)
    assert.equal(router.rescoredV2.componentOutageUnverifiable, 2)
    assert.equal(router.rescoredV2.stageConfirmedPass, 4)
    assert.equal(router.rescoredV2.stageConfirmedFail, 6)
    assert.equal(router.rescoredV2.stageUnverifiable, 10)
    assert.equal(router.rescoredV2.stageUnknownNotSaved, 20)

    // Un-injected baseline fault rows are accurately classified as notInjected (NOT missed faults)
    assert.equal(cot.rescoredV2.decideConfirmedPass, 26)
    assert.equal(cot.rescoredV2.sharedFaultNotInjected, 8)
    assert.equal(cot.rescoredV2.sharedFaultConfirmedFail, 0)
    assert.equal(react.rescoredV2.decideConfirmedPass, 23)
    assert.equal(react.rescoredV2.sharedFaultNotInjected, 8)

    assert.equal(report.v1Flips.length, 3)
    assert.equal(report.v1UnverifiableRuns.length, 10)
  })

  it('recomputes repeat-5 unique-scenario counts, confusion matrices, illustrative costs, and fault matrix', () => {
    const report = runOfflineReplay()

    assert.equal(report.rep5.length, 6)
    const gCot = report.rep5.find((r) => r.modelKey === 'gemini' && r.pipeline === 'cot')
    const gVal = report.rep5.find((r) => r.modelKey === 'gemini' && r.pipeline === 'direct_validator')
    const gReact = report.rep5.find((r) => r.modelKey === 'gemini' && r.pipeline === 'react')
    const oCot = report.rep5.find((r) => r.modelKey === 'opencode' && r.pipeline === 'cot')
    const oVal = report.rep5.find((r) => r.modelKey === 'opencode' && r.pipeline === 'direct_validator')
    const oReact = report.rep5.find((r) => r.modelKey === 'opencode' && r.pipeline === 'react')

    assert.equal(gCot?.uniqueDecideAllRepeatsPass, 13)
    assert.equal(gVal?.uniqueDecideAllRepeatsPass, 13)
    assert.equal(gReact?.uniqueDecideAllRepeatsPass, 6)
    assert.equal(oCot?.uniqueDecideAllRepeatsPass, 13)
    assert.equal(oVal?.uniqueDecideAllRepeatsPass, 13)
    assert.equal(oReact?.uniqueDecideAllRepeatsPass, 11)
    assert.equal(gCot?.confusion.illustrativeCostPerRun, 1.33)
    assert.equal(gReact?.confusion.illustrativeCostPerRun, 0.76)

    for (const row of report.rep5) {
      assert.equal(row.sharedFaultNotInjected, 20)
      assert.equal(row.componentOutagesExcluded, 5)
    }

    for (const row of report.faultMatrix) {
      assert.equal(row.v2RecomputedPass, row.arm === 'direct-validator' ? 4 : 0)
      assert.equal(row.usedProxyRawOutcome, row.arm === 'direct-validator')
    }
  })

  it('published 3-version challenge JSONs match deterministic recomputation and synthetic trace fixtures pass 6/6', () => {
    const report = runOfflineReplay()
    assert.deepEqual(report.challengeV1.slices, evaluateDeterministicChallenge('v1').slices)
    assert.deepEqual(report.challengeV2_0.slices, evaluateDeterministicChallenge('v2.0').slices)
    assert.deepEqual(report.challengeV2_1.slices, evaluateDeterministicChallenge('v2.1').slices)

    assert.equal(report.syntheticTraces.provenance, 'synthetic_demonstration_fixture')
    assert.equal(report.syntheticTraces.total, 6)
    assert.equal(report.syntheticTraces.matched, 6)
  })
})
