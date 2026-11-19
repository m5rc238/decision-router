// Fault-test diagnostic for the baseline arms (updated to grader-v2.0 and
// validator-v2.1-structured).
//
// Delivers identical fault evidence to every applicable arm:
//   direct-llm / direct-validator : SERVICE OUTPUT block + structured serviceOutputs
//   react                         : fault evidence delivered in initial prompt AND
//                                   recorded via sawFaultEvidence so ReAct cannot
//                                   silently bypass it by skipping tool calls
//
// Any upstream API error (`r.error`) is graded via `verdictForOutcome` and ALWAYS
// fails as `unrelated_service_error` rather than masking as a passing halt.
// Router reference is read from the committed sanitized bundle
// `results/offline-replay-bundle.v2.json`.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Scenario } from '../src/lib/live/types'
import { goldForScenario, GRADER_VERSION, verdictForOutcome, verdictForSavedRouterRun } from '../src/lib/live/gold'
import { loadEnvLocal } from './lib/env'
import { benchmarkScenarioSet } from './lib/scenarios'
import { APPLICABLE_TO_BASELINES, FAULT_KIND_LABEL, FAULT_SCENARIO_ID, faultPayload } from './lib/faults'
import { runCoT } from './lib/cot'
import { runReact } from './lib/react'
import {
  applyValidator,
  validateDirectModel,
  VALIDATOR_V2_1_VERSION,
} from './lib/validator'
import { runDeterministicPolicy } from './lib/rules'
import { MODEL_LABEL } from './lib/llm'
import type { BaselineOutcome } from './lib/types'
import type { ModelKey } from './lib/llm'
import { parseArgs } from './lib/parse'

loadEnvLocal()

const A = process.argv.slice(2)
const args = parseArgs(A)
if (!A.includes('--out')) args.out = 'fault-results.json'
if (args.out === 'eval-results.json') args.out = 'fault-results.json'

if (A.includes('--help')) {
  console.log(`usage: npm run fault-eval -- [flags]
  --concurrency N   parallel runs (default: 2)
  --model gemini|opencode   baseline model (default: gemini)
  --out path.json   output file (default: fault-results.json)
  --quiet           print tables only, no per-run lines`)
  process.exit(0)
}

const ARMS = {
  'direct-llm': { mode: 'not-told' as const, style: 'cot' as const, label: 'Direct-LLM (not-told, v1)' },
  'direct-llm-told': { mode: 'told' as const, style: 'cot' as const, label: 'Direct-LLM (told, v2)' },
  react: { mode: 'not-told' as const, style: 'react' as const, label: 'ReAct (not-told, v1)' },
  'react-told': { mode: 'told' as const, style: 'react' as const, label: 'ReAct (told, v2)' },
  'direct-validator': { mode: 'not-told' as const, style: 'cot' as const, label: 'Direct+validator (v2.1)' },
  'rules-only': { mode: 'not-told' as const, style: 'rules' as const, label: 'Deterministic rules' },
} as const
type ArmId = keyof typeof ARMS

interface FaultRun {
  arm: ArmId
  scenarioId: string
  faultKind: string
  mode: 'not-told' | 'told'
  model: ModelKey | 'deterministic'
  modelLabel: string
  gold: string
  decision: string | null
  reasonCode: string | null
  validatorVersion?: string
  validatorHalted?: boolean
  sawFaultEvidence: boolean
  pass: boolean
  classification: string
  ms: number
  tokensIn: number
  tokensOut: number
  error?: string
  evidence: string
  prompt: string
  injected: string
}

async function runArm(scenario: Scenario, arm: ArmId, injectFault: string): Promise<FaultRun> {
  const cfg = ARMS[arm]
  const gold = goldForScenario(scenario)
  const model: ModelKey = args.model
  const kind = injectFault as Parameters<typeof faultPayload>[0]
  const stage = scenario.fault?.stage ?? 'untagged'
  const base = {
    arm,
    scenarioId: scenario.id,
    faultKind: injectFault,
    mode: cfg.mode,
    model: cfg.style === 'rules' ? ('deterministic' as const) : model,
    modelLabel: cfg.style === 'rules' ? 'Deterministic TS Rules' : MODEL_LABEL[model],
    gold: 'stop',
  }

  if (cfg.style === 'rules') {
    const res = runDeterministicPolicy(scenario, {
      serviceOutputs: [{ stage, payload: faultPayload(kind) }],
    })
    const gv = verdictForOutcome(
      {
        decision: res.outcome.decision,
        reasonCode: res.outcome.reasonCode,
        halted: res.halted,
        validatorReason: res.reason,
      },
      gold,
    )
    return {
      ...base,
      decision: res.outcome.decision,
      reasonCode: res.outcome.reasonCode,
      validatorVersion: VALIDATOR_V2_1_VERSION,
      validatorHalted: res.halted,
      sawFaultEvidence: true,
      pass: gv.pass,
      classification: gv.classification,
      ms: res.ms,
      tokensIn: 0,
      tokensOut: 0,
      evidence: faultPayload(kind),
      prompt: '',
      injected: faultPayload(kind),
    }
  }

  if (cfg.style === 'react') {
    const rr = await runReact(scenario, {
      mode: cfg.mode,
      injectFault: kind,
      deliverEvidenceInPrompt: true,
      model,
    })
    const gv = verdictForOutcome(
      {
        decision: rr.outcome.decision,
        reasonCode: rr.outcome.reasonCode,
        halted: rr.outcome.decision === 'halt',
        serviceError: rr.error,
      },
      gold,
    )
    return {
      ...base,
      decision: rr.outcome.decision,
      reasonCode: rr.outcome.reasonCode,
      sawFaultEvidence: rr.sawFaultEvidence,
      pass: gv.pass,
      classification: gv.classification,
      ms: rr.ms,
      tokensIn: rr.tokensIn,
      tokensOut: rr.tokensOut,
      error: rr.error,
      evidence: rr.evidence,
      prompt: '',
      injected: faultPayload(kind),
    }
  }

  const r = await runCoT(scenario, { mode: cfg.mode, injectFault: kind, model })
  let outcome: BaselineOutcome = r.outcome
  let validatorHalted: boolean | undefined
  let validatorVersion: string | undefined
  let validatorReason: string | null | undefined

  if (arm === 'direct-validator') {
    const validator = validateDirectModel(outcome, scenario.facts, r.evidence, {
      version: 'v2.1',
      serviceError: r.error,
      serviceOutputs: [{ stage, payload: faultPayload(kind) }],
      draftResponse: r.draftResponse,
    })
    outcome = applyValidator(outcome, validator)
    validatorHalted = validator.halted
    validatorVersion = validator.version
    validatorReason = validator.reason
  }

  const gv = verdictForOutcome(
    {
      decision: outcome.decision,
      reasonCode: outcome.reasonCode,
      halted: outcome.decision === 'halt',
      validatorReason,
      serviceError: r.error,
    },
    gold,
  )

  return {
    ...base,
    decision: outcome.decision,
    reasonCode: outcome.reasonCode,
    ...(validatorVersion ? { validatorVersion } : {}),
    ...(validatorHalted !== undefined ? { validatorHalted } : {}),
    sawFaultEvidence: true,
    pass: gv.pass,
    classification: gv.classification,
    ms: r.ms,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    error: r.error,
    evidence: r.evidence,
    prompt: r.evidence,
    injected: faultPayload(kind),
  }
}

function readRouterReference(): {
  v1HistoricalPass: number
  v2ConfirmedPass: number
  v2Unverifiable: number
  total: number
} | null {
  try {
    const bundle = JSON.parse(readFileSync(resolve('results/offline-replay-bundle.v2.json'), 'utf8')) as {
      v1MainRuns: Array<{
        pipeline: string
        scenarioId: string
        decision: string | null
        reasonCode: string | null
        halted: boolean
        v1Pass: boolean
        actions?: string[]
        error?: string
      }>
    }
    const faultIds = new Set(Object.values(FAULT_SCENARIO_ID))
    const byId = new Map(benchmarkScenarioSet().map((s) => [s.id, s]))
    const runs = bundle.v1MainRuns.filter((x) => x.pipeline === 'router' && faultIds.has(x.scenarioId))
    let v2ConfirmedPass = 0
    let v2Unverifiable = 0
    for (const r of runs) {
      const s = byId.get(r.scenarioId)
      if (!s) continue
      const audit = verdictForSavedRouterRun(r, goldForScenario(s))
      if (!audit.verifiable) v2Unverifiable++
      else if (audit.pass) v2ConfirmedPass++
    }
    return {
      v1HistoricalPass: runs.filter((x) => x.v1Pass).length,
      v2ConfirmedPass,
      v2Unverifiable,
      total: runs.length,
    }
  } catch {
    return null
  }
}

const scenarioSet = benchmarkScenarioSet()
const byId = new Map(scenarioSet.map((s) => [s.id, s]))
const armsToRun = Object.keys(ARMS) as ArmId[]

const taskRows: Array<{ arm: ArmId; scenarioId: string; faultKind: string }> = []
for (const arm of armsToRun) {
  for (const kind of APPLICABLE_TO_BASELINES) {
    taskRows.push({ arm, scenarioId: FAULT_SCENARIO_ID[kind], faultKind: kind })
  }
}

async function mapPool<T>(items: Array<() => Promise<T>>, limit: number, fn: (t: () => Promise<T>) => Promise<void>): Promise<void> {
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (items.length > 0) {
      const next = items.shift()
      if (next) await fn(next)
    }
  })
  await Promise.all(workers)
}

const runs: FaultRun[] = []
const tasks = taskRows.map((row) => () => {
  const scenario = byId.get(row.scenarioId)
  if (!scenario) throw new Error(`missing scenario ${row.scenarioId}`)
  return runArm(scenario, row.arm, row.faultKind)
})

await mapPool(tasks, args.concurrency, async (task) => {
  const run = await task()
  runs.push(run)
  if (!args.quiet) {
    console.log(
      `${run.pass ? 'STOP' : 'FAIL'} ${String(run.arm).padEnd(16)} ${run.scenarioId.padEnd(22)} got=${run.decision ?? '—'} [${run.classification}] ${run.error ?? ''}`.trim(),
    )
  }
})

const NOT_TOLD: ArmId[] = ['direct-llm', 'react', 'direct-validator', 'rules-only']
const TOLD: ArmId[] = ['direct-llm-told', 'react-told']

function tableRows(arms: ArmId[]): string[] {
  const header = 'fault (injected) | ' + arms.map((arm) => ARMS[arm].label).join(' | ')
  const sep = '--- | ' + arms.map(() => '---').join(' | ')
  const lines = [header, sep]
  for (const kind of APPLICABLE_TO_BASELINES) {
    const cells = arms.map((arm) => {
      const row = runs.find((x) => x.arm === arm && x.faultKind === kind)
      if (!row) return '—'
      const mark = row.pass ? 'STOP ✓' : `${row.decision ?? 'error'} ✗`
      return `${mark}${row.error ? ` (err ${row.error})` : ''}`
    })
    lines.push(`${FAULT_KIND_LABEL[kind]} | ${cells.join(' | ')}`)
  }
  const ref = readRouterReference()
  if (ref) {
    const label = `v1 hist ${ref.v1HistoricalPass}/${ref.total}; v2 ${ref.v2ConfirmedPass}P/${ref.v2Unverifiable}U`
    lines.push(`${FAULT_KIND_LABEL['jev-500']} + all (router reference) | ${arms.map(() => label).join(' | ')}`)
  }
  return lines
}

const notToldTable = tableRows(NOT_TOLD)
const toldTable = tableRows(TOLD)

console.log(`\n— FAULT TEST (${GRADER_VERSION}, ${VALIDATOR_V2_1_VERSION}), NOT-TOLD —`)
console.log(notToldTable.join('\n'))
console.log(`\n— FAULT TEST (${GRADER_VERSION}), TOLD —`)
console.log(toldTable.join('\n'))

const out = {
  task: 'fault-test-diagnostic',
  graderVersion: GRADER_VERSION,
  validatorVersion: VALIDATOR_V2_1_VERSION,
  generatedAt: new Date().toISOString(),
  model: process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest',
  baselineModel: args.model,
  baselineModelLabel: MODEL_LABEL[args.model],
  injection: {
    vehicle: {
      'direct-llm': 'SERVICE OUTPUT block appended to prompt',
      'direct-llm-told': 'SERVICE OUTPUT block appended to prompt',
      react: 'SERVICE OUTPUT block delivered in initial prompt (sawFaultEvidence=true)',
      'react-told': 'SERVICE OUTPUT block delivered in initial prompt (sawFaultEvidence=true)',
      'direct-validator': 'Structured serviceOutputs + draftResponse checked by validator-v2.1-structured',
      'rules-only': 'Structured serviceOutputs checked deterministically',
    },
    applicableToBaselines: APPLICABLE_TO_BASELINES,
    notApplicableToBaselines: ['jev-500'],
  },
  gold: 'all fault scenarios expect stop; upstream serviceError always fails',
  tables: { notTold: notToldTable, told: toldTable },
  routerReference: readRouterReference(),
  runs,
}

const outPath = resolve(args.out)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 2))
console.log(`\nwrote ${outPath}`)
