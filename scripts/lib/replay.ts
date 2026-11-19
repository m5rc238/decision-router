// Offline deterministic replay of the published sanitized evaluation bundle
// (`results/offline-replay-bundle.v2.json`), 3-version challenge audits,
// deterministic rules baseline, confusion matrices, and illustrative error-cost
// analysis. Zero API keys required.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  goldForScenario,
  GRADER_VERSION,
  verdictForOutcome,
  verdictForRun,
  verdictForSavedRouterRun,
  type ExpectedOutcomeClass,
  type GoldExpectation,
  type ObservedOutcomeClass,
  type SavedRouterRunRecord,
  type VerdictClassification,
} from '../../src/lib/live/gold'
import type { LiveRun, Scenario } from '../../src/lib/live/types'
import {
  applyValidator,
  validateDirectModel,
  VALIDATOR_V1_VERSION,
  VALIDATOR_V2_0_VERSION,
  VALIDATOR_V2_1_VERSION,
} from './validator'
import {
  evaluateDeterministicRulesOnScenarios,
  type DeterministicEvalSummary,
} from './challenge'

export interface BundleScenario {
  id: string
  label: string
  group: 'refund' | 'failure'
  userInput: string
  facts: Record<string, unknown>
  fault: Scenario['fault']
  gold: GoldExpectation
}

export interface BundleV1MainRun extends SavedRouterRunRecord {
  index: number
  pipeline: 'cot' | 'react' | 'router'
  repeat: number
  model: string
  v1Pass: boolean
  faultInjected?: boolean
  traceNote: string
}

export interface BundleFaultMatrixRun {
  sourceFile: string
  arm: string
  scenarioId: string
  faultKind: string
  mode: string
  model: 'gemini' | 'opencode'
  modelLabel: string
  decision: string | null
  reasonCode: string | null
  validatorHalted: boolean
  v1Pass: boolean
  sawFaultEvidence: boolean
  ms: number
  tokensIn: number
  tokensOut: number
  error?: string
  evidence: string
  injected: string
}

export interface BundleRep5Run {
  sourceFile: string
  modelKey: 'gemini' | 'opencode'
  pipeline: 'cot' | 'react' | 'direct_validator'
  scenarioId: string
  repeat: number
  model: string
  modelVersion?: string
  temperature?: number
  decision: string | null
  reasonCode: string | null
  halted: boolean
  v1Pass: boolean
  faultInjected?: boolean
  ms: number
  tokensIn: number
  tokensOut: number
  fabricated: boolean
  illegalAction: boolean
  actions: string[]
  error?: string
}

export interface OfflineBundle {
  bundleVersion: string
  graderVersion: string
  provenance: string
  sanitized: boolean
  config: Record<string, unknown>
  scenarios: BundleScenario[]
  v1MainRuns: BundleV1MainRun[]
  faultMatrixRuns: BundleFaultMatrixRun[]
  rep5BaselineRuns: BundleRep5Run[]
}

export type OutcomeBucket = 'approve_refund' | 'deny_refund' | 'escalate' | 'stop_or_error'

export interface ConfusionCounts {
  matrix: Record<OutcomeBucket, Record<OutcomeBucket, number>>
  /** Illustrative asymmetric cost weights per misclassified decision (clearly labeled heuristic, not ground truth). */
  illustrativeCostTotal: number
  illustrativeCostPerRun: number
}

export interface V1PipeSummary {
  pipeline: 'router' | 'cot' | 'react'
  model: string
  uniqueScenarios: number
  totalRuns: number
  historicalReported: {
    decidePass: number
    decideTotal: number
    haltPass: number
    haltTotal: number
    overallPass: number
    overallTotal: number
  }
  rescoredV2: {
    decideConfirmedPass: number
    decideConfirmedFail: number
    decideUnverifiable: number
    decideTotal: number
    sharedFaultConfirmedPass: number
    sharedFaultConfirmedFail: number
    sharedFaultUnverifiable: number
    sharedFaultNotInjected: number
    sharedFaultTotal: number
    componentOutageConfirmedPass: number
    componentOutageUnverifiable: number
    componentOutageTotal: number
    unnecessaryStops: number
    stageConfirmedPass: number | null
    stageConfirmedFail: number | null
    stageUnverifiable: number | null
    stageUnknownNotSaved: number | null
    stageTotal: number | null
  }
  confusion: ConfusionCounts
}

export interface VerdictFlip {
  index: number
  pipeline: string
  scenarioId: string
  v1Pass: boolean
  v2Pass: boolean | null
  classification: VerdictClassification
  note: string
}

export interface Rep5RowSummary {
  modelKey: 'gemini' | 'opencode'
  modelLabel: string
  pipeline: 'cot' | 'react' | 'direct_validator'
  uniqueDecideScenarios: number
  uniqueDecideAllRepeatsPass: number
  decidePass: number
  decideTotal: number
  decideRate: number
  sharedFaultNotInjected: number
  componentOutagesExcluded: number
  unnecessaryStops: number
  errors: number
  meanMs: number
  meanTokens: number
  confusion: ConfusionCounts
}

export interface FaultArmSummary {
  modelKey: 'gemini' | 'opencode'
  arm: string
  uniqueScenarios: number
  totalRuns: number
  v1ReportedPass: number
  v2RecomputedPass: number
  sawFaultEvidenceCount: number
  usedProxyRawOutcome: boolean
}

export interface SyntheticTraceCheck {
  id: string
  scenarioId: string
  expectedPass: boolean
  actualPass: boolean
  expectedClassification: string
  actualClassification: VerdictClassification
  outcomePass: boolean
  stagePass: boolean | null
  match: boolean
}

export interface OfflineReplayReport {
  bundleVersion: string
  graderVersion: string
  illustrativeCostWeights: Record<string, number>
  rulesOnlyBaseline: ReturnType<typeof evaluateDeterministicRulesOnScenarios>
  v1Main: V1PipeSummary[]
  v1Flips: VerdictFlip[]
  v1UnverifiableRuns: Array<{
    index: number
    pipeline: string
    scenarioId: string
    note: string
  }>
  rep5: Rep5RowSummary[]
  faultMatrix: FaultArmSummary[]
  challengeV1: DeterministicEvalSummary
  challengeV2_0: DeterministicEvalSummary
  challengeV2_1: DeterministicEvalSummary
  syntheticTraces: {
    provenance: string
    total: number
    matched: number
    checks: SyntheticTraceCheck[]
  }
}

export const ILLUSTRATIVE_ERROR_COST_WEIGHTS = {
  wrongApproveRefund: 10,
  wrongDenyRefund: 4,
  missedFault: 10,
  unnecessaryEscalateOrStop: 1,
  serviceError: 6,
} as const

function emptyConfusion(): Record<OutcomeBucket, Record<OutcomeBucket, number>> {
  const row = (): Record<OutcomeBucket, number> => ({
    approve_refund: 0,
    deny_refund: 0,
    escalate: 0,
    stop_or_error: 0,
  })
  return {
    approve_refund: row(),
    deny_refund: row(),
    escalate: row(),
    stop_or_error: row(),
  }
}

function toBucket(cls: ExpectedOutcomeClass | ObservedOutcomeClass | 'unverifiable'): OutcomeBucket {
  if (cls === 'approve_refund') return 'approve_refund'
  if (cls === 'deny_refund') return 'deny_refund'
  if (cls === 'escalate') return 'escalate'
  return 'stop_or_error'
}

function errorCostForRun(
  expected: ExpectedOutcomeClass,
  observed: ObservedOutcomeClass | 'unverifiable',
  pass: boolean | null,
): number {
  if (pass !== false) return 0
  if (observed === 'service_error') return ILLUSTRATIVE_ERROR_COST_WEIGHTS.serviceError
  if (expected === 'stop') return ILLUSTRATIVE_ERROR_COST_WEIGHTS.missedFault
  if (observed === 'approve_refund') return ILLUSTRATIVE_ERROR_COST_WEIGHTS.wrongApproveRefund
  if (observed === 'deny_refund') return ILLUSTRATIVE_ERROR_COST_WEIGHTS.wrongDenyRefund
  return ILLUSTRATIVE_ERROR_COST_WEIGHTS.unnecessaryEscalateOrStop
}

function readJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(resolve(relPath), 'utf8')) as T
}

export function runOfflineReplay(): OfflineReplayReport {
  const bundle = readJson<OfflineBundle>('results/offline-replay-bundle.v2.json')
  const challengeV1 = readJson<DeterministicEvalSummary>('results/challenge-eval-v1-frozen.json')
  const challengeV2_0 = readJson<DeterministicEvalSummary>('results/challenge-eval-v2.0-audit.json')
  const challengeV2_1 = readJson<DeterministicEvalSummary>('results/challenge-eval-v2.1-structured.json')
  const synthetic = readJson<{
    provenance: string
    traces: Array<{
      id: string
      expectedPass: boolean
      expectedClassification: string
      run: LiveRun
    }>
  }>('results/synthetic-trace-fixtures.v2.json')

  const goldMap = new Map<string, GoldExpectation>()
  for (const sc of bundle.scenarios) {
    goldMap.set(
      sc.id,
      goldForScenario({
        id: sc.id,
        label: sc.label,
        group: sc.group,
        userInput: sc.userInput,
        facts: sc.facts as Scenario['facts'],
        fault: sc.fault,
      }),
    )
  }

  const rulesOnlyBaseline = evaluateDeterministicRulesOnScenarios()

  // 1. Re-score v1 Main Runs
  const pipeOrder: Array<'router' | 'cot' | 'react'> = ['router', 'cot', 'react']
  const v1Main: V1PipeSummary[] = []
  const v1Flips: VerdictFlip[] = []
  const v1UnverifiableRuns: OfflineReplayReport['v1UnverifiableRuns'] = []

  for (const pipe of pipeOrder) {
    const runs = bundle.v1MainRuns.filter((r) => r.pipeline === pipe)
    const uniqueScenarios = new Set(runs.map((r) => r.scenarioId)).size

    let histDecPass = 0
    let histDecTotal = 0
    let histHaltPass = 0
    let histHaltTotal = 0

    let decPass = 0
    let decFail = 0
    let decUnv = 0
    let decTot = 0
    let sfPass = 0
    let sfFail = 0
    let sfUnv = 0
    let sfNotInjected = 0
    let sfTot = 0
    let coPass = 0
    let coUnv = 0
    let coTot = 0
    let unnec = 0
    let stgPass = 0
    let stgFail = 0
    let stgUnv = 0
    let stgUnknown = 0
    let stgTot = 0

    const matrix = emptyConfusion()
    let costTotal = 0
    let costCount = 0

    for (const r of runs) {
      const gold = goldMap.get(r.scenarioId)
      if (!gold) throw new Error(`missing gold for ${r.scenarioId}`)

      if (gold.expect === 'decide') {
        histDecTotal++
        if (r.v1Pass) histDecPass++
      } else {
        histHaltTotal++
        if (r.v1Pass) histHaltPass++
      }

      if (pipe === 'router') {
        const audit = verdictForSavedRouterRun(r, gold)
        const isCompOutage = gold.expectedOutcome === 'stop' && gold.faultApplicableToBaselines === false

        stgTot++
        if (!audit.verifiable) stgUnv++
        else if (audit.stagePass === null) stgUnknown++
        else if (audit.stagePass) stgPass++
        else stgFail++

        if (audit.verifiable) {
          matrix[toBucket(gold.expectedOutcome)][toBucket(audit.observedOutcome)]++
          costTotal += errorCostForRun(gold.expectedOutcome, audit.observedOutcome, audit.pass)
          costCount++
        }

        if (gold.expect === 'decide') {
          decTot++
          if (!audit.verifiable) decUnv++
          else if (audit.pass) decPass++
          else {
            decFail++
            if (audit.classification === 'unnecessary_stop') unnec++
          }
        } else if (isCompOutage) {
          coTot++
          if (!audit.verifiable) coUnv++
          else if (audit.pass) coPass++
        } else {
          sfTot++
          if (!audit.verifiable) sfUnv++
          else if (audit.pass) sfPass++
          else sfFail++
        }

        if (!audit.verifiable) {
          v1UnverifiableRuns.push({
            index: r.index,
            pipeline: pipe,
            scenarioId: r.scenarioId,
            note: audit.note,
          })
        } else if (audit.pass !== r.v1Pass) {
          v1Flips.push({
            index: r.index,
            pipeline: pipe,
            scenarioId: r.scenarioId,
            v1Pass: r.v1Pass,
            v2Pass: audit.pass,
            classification: audit.classification,
            note: audit.note,
          })
        }
      } else {
        const gv = verdictForOutcome(
          {
            decision: r.decision,
            reasonCode: r.reasonCode,
            halted: r.halted,
            serviceError: r.error,
          },
          gold,
        )
        const isCompOutage = gold.expectedOutcome === 'stop' && gold.faultApplicableToBaselines === false

        if (gold.expect === 'decide') {
          decTot++
          matrix[toBucket(gold.expectedOutcome)][toBucket(gv.observedOutcome)]++
          costTotal += errorCostForRun(gold.expectedOutcome, gv.observedOutcome, gv.pass)
          costCount++
          if (gv.pass) decPass++
          else {
            decFail++
            if (gv.classification === 'unnecessary_stop') unnec++
          }
        } else if (isCompOutage) {
          coTot++
        } else {
          sfTot++
          if (r.faultInjected === false) {
            sfNotInjected++
          } else if (gv.pass) {
            sfPass++
          } else {
            sfFail++
          }
        }

        if (gv.pass !== r.v1Pass) {
          v1Flips.push({
            index: r.index,
            pipeline: pipe,
            scenarioId: r.scenarioId,
            v1Pass: r.v1Pass,
            v2Pass: gv.pass,
            classification: gv.classification,
            note: 'Baseline verdict changed under grader-v2.0',
          })
        }
      }
    }

    v1Main.push({
      pipeline: pipe,
      model: runs[0]?.model ?? '',
      uniqueScenarios,
      totalRuns: runs.length,
      historicalReported: {
        decidePass: histDecPass,
        decideTotal: histDecTotal,
        haltPass: histHaltPass,
        haltTotal: histHaltTotal,
        overallPass: histDecPass + histHaltPass,
        overallTotal: runs.length,
      },
      rescoredV2: {
        decideConfirmedPass: decPass,
        decideConfirmedFail: decFail,
        decideUnverifiable: decUnv,
        decideTotal: decTot,
        sharedFaultConfirmedPass: sfPass,
        sharedFaultConfirmedFail: sfFail,
        sharedFaultUnverifiable: sfUnv,
        sharedFaultNotInjected: sfNotInjected,
        sharedFaultTotal: sfTot,
        componentOutageConfirmedPass: coPass,
        componentOutageUnverifiable: coUnv,
        componentOutageTotal: coTot,
        unnecessaryStops: unnec,
        stageConfirmedPass: pipe === 'router' ? stgPass : null,
        stageConfirmedFail: pipe === 'router' ? stgFail : null,
        stageUnverifiable: pipe === 'router' ? stgUnv : null,
        stageUnknownNotSaved: pipe === 'router' ? stgUnknown : null,
        stageTotal: pipe === 'router' ? stgTot : null,
      },
      confusion: {
        matrix,
        illustrativeCostTotal: costTotal,
        illustrativeCostPerRun: costCount ? Number((costTotal / costCount).toFixed(2)) : 0,
      },
    })
  }

  // 2. Recompute Repeat-5 Baseline Summaries (clustered by scenario, NOT i.i.d. CI)
  const rep5: Rep5RowSummary[] = []
  for (const modelKey of ['gemini', 'opencode'] as const) {
    for (const pipe of ['cot', 'react', 'direct_validator'] as const) {
      const runs = bundle.rep5BaselineRuns.filter((r) => r.modelKey === modelKey && r.pipeline === pipe)
      if (runs.length === 0) continue

      let decidePass = 0
      let decideTotal = 0
      let sharedFaultNotInjected = 0
      let componentOutagesExcluded = 0
      let unnecessaryStops = 0
      let errors = 0
      let sumMs = 0
      let sumTok = 0
      const perScenarioPasses = new Map<string, { pass: number; total: number }>()
      const matrix = emptyConfusion()
      let costTotal = 0

      for (const r of runs) {
        const gold = goldMap.get(r.scenarioId)
        if (!gold) throw new Error(`missing gold for ${r.scenarioId}`)
        sumMs += r.ms
        sumTok += r.tokensIn + r.tokensOut
        if (r.error) errors++

        const gv = verdictForOutcome(
          {
            decision: r.decision,
            reasonCode: r.reasonCode,
            halted: r.halted,
            serviceError: r.error,
          },
          gold,
        )

        if (gold.expect === 'decide') {
          decideTotal++
          const entry = perScenarioPasses.get(r.scenarioId) ?? { pass: 0, total: 0 }
          entry.total++
          if (gv.pass) {
            decidePass++
            entry.pass++
          } else if (gv.classification === 'unnecessary_stop') {
            unnecessaryStops++
          }
          perScenarioPasses.set(r.scenarioId, entry)
          matrix[toBucket(gold.expectedOutcome)][toBucket(gv.observedOutcome)]++
          costTotal += errorCostForRun(gold.expectedOutcome, gv.observedOutcome, gv.pass)
        } else if (gold.faultApplicableToBaselines === false) {
          componentOutagesExcluded++
        } else {
          sharedFaultNotInjected++
        }
      }

      const uniqueDecideAllRepeatsPass = [...perScenarioPasses.values()].filter(
        (x) => x.total > 0 && x.pass === x.total,
      ).length

      rep5.push({
        modelKey,
        modelLabel: runs[0].model,
        pipeline: pipe,
        uniqueDecideScenarios: perScenarioPasses.size,
        uniqueDecideAllRepeatsPass,
        decidePass,
        decideTotal,
        decideRate: decideTotal ? decidePass / decideTotal : 0,
        sharedFaultNotInjected,
        componentOutagesExcluded,
        unnecessaryStops,
        errors,
        meanMs: Math.round(sumMs / runs.length),
        meanTokens: Math.round(sumTok / runs.length),
        confusion: {
          matrix,
          illustrativeCostTotal: costTotal,
          illustrativeCostPerRun: decideTotal ? Number((costTotal / decideTotal).toFixed(2)) : 0,
        },
      })
    }
  }

  // 3. Recompute Matched-Model Fault Matrix
  const faultMatrix: FaultArmSummary[] = []
  const armOrder = ['direct-llm', 'direct-llm-told', 'react', 'react-told', 'direct-validator']
  const scenarioById = new Map(bundle.scenarios.map((s) => [s.id, s]))

  for (const modelKey of ['gemini', 'opencode'] as const) {
    for (const arm of armOrder) {
      const runs = bundle.faultMatrixRuns.filter((r) => r.model === modelKey && r.arm === arm)
      if (runs.length === 0) continue

      let v1ReportedPass = 0
      let v2RecomputedPass = 0
      let sawFaultEvidenceCount = 0

      for (const r of runs) {
        if (r.v1Pass) v1ReportedPass++
        if (r.sawFaultEvidence) sawFaultEvidenceCount++

        const gold = goldMap.get(r.scenarioId)
        const sc = scenarioById.get(r.scenarioId)
        if (!gold || !sc) throw new Error(`missing scenario ${r.scenarioId}`)

        if (arm === 'direct-validator') {
          // Proxy raw decision from matching direct-llm run because fault-results*.json omitted pre-validator decision.
          const matchingCot = bundle.faultMatrixRuns.find(
            (x) => x.model === modelKey && x.arm === 'direct-llm' && x.scenarioId === r.scenarioId,
          )
          const rawOutcome = matchingCot
            ? { decision: matchingCot.decision, reasonCode: matchingCot.reasonCode }
            : { decision: r.decision, reasonCode: r.reasonCode }
          const v1Check = validateDirectModel(rawOutcome, sc.facts, r.evidence, {
            version: 'v1',
            serviceError: r.error,
          })
          const v21Check = validateDirectModel(rawOutcome, sc.facts, r.evidence, {
            version: 'v2.1',
            serviceError: r.error,
            serviceOutputs: [{ stage: sc.fault?.stage ?? 'untagged', payload: r.injected }],
          })
          const postV2 = applyValidator(rawOutcome, v21Check)
          const gv = verdictForOutcome(
            {
              decision: postV2.decision,
              reasonCode: postV2.reasonCode,
              halted: v21Check.halted,
              validatorReason: v21Check.reason,
              serviceError: r.error,
            },
            gold,
          )
          if (v1Check.halted && gv.pass) v2RecomputedPass++
        } else {
          const gv = verdictForOutcome(
            {
              decision: r.decision,
              reasonCode: r.reasonCode,
              halted: r.decision === 'halt',
              serviceError: r.error,
            },
            gold,
          )
          if (gv.pass) v2RecomputedPass++
        }
      }

      faultMatrix.push({
        modelKey,
        arm,
        uniqueScenarios: new Set(runs.map((r) => r.scenarioId)).size,
        totalRuns: runs.length,
        v1ReportedPass,
        v2RecomputedPass,
        sawFaultEvidenceCount,
        usedProxyRawOutcome: arm === 'direct-validator',
      })
    }
  }

  // 4. Verify Synthetic Demonstration Trace Fixtures
  const syntheticChecks: SyntheticTraceCheck[] = synthetic.traces.map((t) => {
    const gold = goldMap.get(t.run.scenarioId)
    if (!gold) throw new Error(`missing gold for synthetic trace ${t.run.scenarioId}`)
    const v = verdictForRun(t.run, gold)
    return {
      id: t.id,
      scenarioId: t.run.scenarioId,
      expectedPass: t.expectedPass,
      actualPass: v.pass,
      expectedClassification: t.expectedClassification,
      actualClassification: v.classification,
      outcomePass: v.outcomePass,
      stagePass: v.stagePass,
      match: v.pass === t.expectedPass && v.classification === t.expectedClassification,
    }
  })

  return {
    bundleVersion: bundle.bundleVersion,
    graderVersion: GRADER_VERSION,
    illustrativeCostWeights: { ...ILLUSTRATIVE_ERROR_COST_WEIGHTS },
    rulesOnlyBaseline,
    v1Main,
    v1Flips,
    v1UnverifiableRuns,
    rep5,
    faultMatrix,
    challengeV1,
    challengeV2_0,
    challengeV2_1,
    syntheticTraces: {
      provenance: synthetic.provenance,
      total: syntheticChecks.length,
      matched: syntheticChecks.filter((c) => c.match).length,
      checks: syntheticChecks,
    },
  }
}

export { VALIDATOR_V1_VERSION, VALIDATOR_V2_0_VERSION, VALIDATOR_V2_1_VERSION }
