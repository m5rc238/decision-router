// TASK 2d — Fault-test diagnostic for the baseline arms.
//
// Runs the DOWNSTREAM-FAULT scenarios (the 5 fault-injected fixtures the live
// router fail-closes on) against the monolithic baselines and the Direct+validator
// arm, with the fault payload injected into each arm's OWN evidence channel:
//   direct-llm / direct-validator : SERVICE OUTPUT block appended to the prompt
//   react                         : fault text on the get_support_record observation
//
// Two prompt conditions, otherwise identical prompts & injection:
//   not-told  = ORIGINAL v1 prompts (no "halt" option)  → direct-llm, react
//   told      = v2 prompts (halt clause, word-for-word identical across arms)
//               → direct-llm-told, react-told
// Plus direct-validator: the not-told direct-llm prompt followed by the
// deterministic validator (NO LLM calls) from lib/validator.ts.
//
// Applicability (documented in docs/fault-injection.md):
//   - jev-500 (Jev outage) is NOT APPLICABLE to the baselines/validator: they
//     have no Jev stage. It stays in the router reference only.
//   - Every other fault kind is injected for every arm.
//
// The gold expectation for ALL fault scenarios is halt. A run is PASS iff the
// arm emitted halt. Output: fault-results.json + a markdown matrix (task 2d's
// "two tables": not-told + told), plus a router reference row read from the
// preserved eval-results-v1.json (router's REAL failure branches).
//
// TASK 3: --model gemini|opencode selects the baseline model. This keeps the
// fault test runnable on the SAME model the Router uses (Big Pickle via
// OpenCode) so architecture and model stay separable there too.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Scenario } from '../src/lib/live/types'
import { goldForScenario } from '../src/lib/live/gold'
import { loadEnvLocal } from './lib/env'
import { benchmarkScenarioSet } from './lib/scenarios'
import { APPLICABLE_TO_BASELINES, FAULT_KIND_LABEL, FAULT_SCENARIO_ID, faultPayload } from './lib/faults'
import { runCoT } from './lib/cot'
import { runReact } from './lib/react'
import { validateDirectModel, applyValidator } from './lib/validator'
import { MODEL_LABEL } from './lib/llm'
import type { BaselineOutcome } from './lib/types'
import type { ModelKey } from './lib/llm'
import { parseArgs } from './lib/parse'

loadEnvLocal()

const A = process.argv.slice(2)
const args = parseArgs(A)
// Never write into the main benchmark results file.
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

// ---------------------------------------------------------------------------
// Arms

const ARMS = {
  'direct-llm': { mode: 'not-told' as const, style: 'cot' as const, label: 'Direct-LLM (not-told, v1)' },
  'direct-llm-told': { mode: 'told' as const, style: 'cot' as const, label: 'Direct-LLM (told, v2)' },
  react: { mode: 'not-told' as const, style: 'react' as const, label: 'ReAct (not-told, v1)' },
  'react-told': { mode: 'told' as const, style: 'react' as const, label: 'ReAct (told, v2)' },
  'direct-validator': { mode: 'not-told' as const, style: 'cot' as const, label: 'Direct+validator' },
} as const
type ArmId = keyof typeof ARMS

interface FaultRun {
  arm: ArmId
  scenarioId: string
  faultKind: string
  mode: 'not-told' | 'told'
  model: ModelKey
  modelLabel: string
  gold: string
  decision: string | null
  reasonCode: string | null
  validatorHalted?: boolean
  pass: boolean
  ms: number
  tokensIn: number
  tokensOut: number
  error?: string
  evidence: string
  prompt: string
  injected: string
}

const goldByScenario = new Map<string, ReturnType<typeof goldForScenario>>()

async function runArm(scenario: Scenario, arm: ArmId, injectFault: string): Promise<FaultRun> {
  const cfg = ARMS[arm]
  const gold = goldForScenario(scenario)
  goldByScenario.set(scenario.id, gold)
  const model: ModelKey = args.model
  const base = {
    arm,
    scenarioId: scenario.id,
    faultKind: injectFault,
    mode: cfg.mode,
    model,
    modelLabel: MODEL_LABEL[model],
    gold: `halt`,
  }
  const kind = injectFault as Parameters<typeof faultPayload>[0]

  let outcome: BaselineOutcome
  let r: Awaited<ReturnType<typeof runCoT>>

  if (cfg.style === 'react') {
    const rr = await runReact(scenario, { mode: cfg.mode, injectFault: kind, model })
    outcome = rr.outcome
    return {
      ...base,
      decision: outcome.decision,
      reasonCode: outcome.reasonCode,
      pass: outcome.decision === 'halt',
      ms: rr.ms,
      tokensIn: rr.tokensIn,
      tokensOut: rr.tokensOut,
      error: rr.error,
      evidence: rr.evidence,
      prompt: '',
      injected: faultPayload(kind),
    }
  }

  r = await runCoT(scenario, { mode: cfg.mode, injectFault: kind, model })
  outcome = r.outcome
  if (arm === 'direct-validator') {
    const validator = validateDirectModel(outcome, scenario.facts, r.evidence)
    outcome = applyValidator(outcome, validator)
    return {
      ...base,
      decision: outcome.decision,
      reasonCode: outcome.reasonCode,
      validatorHalted: validator.halted,
      pass: outcome.decision === 'halt',
      ms: r.ms,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      error: r.error,
      evidence: r.evidence,
      prompt: r.evidence,
      injected: faultPayload(kind),
    }
  }
  return {
    ...base,
    decision: outcome.decision,
    reasonCode: outcome.reasonCode,
    pass: outcome.decision === 'halt',
    ms: r.ms,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    error: r.error,
    evidence: r.evidence,
    prompt: r.evidence,
    injected: faultPayload(kind),
  }
}

// ---------------------------------------------------------------------------
// Router reference (from the preserved v1 eval, real failure branches)

function readRouterReference(): { haltPass: number; haltTotal: number } | null {
  try {
    const raw = JSON.parse(readFileSync(resolve('eval-results-v1.json'), 'utf8')) as {
      runs: Array<{
        pipeline: string
        scenarioId: string
        halted: boolean
        pass: boolean
      }>
    }
    const faultIds = Object.values(FAULT_SCENARIO_ID)
    const runs = raw.runs.filter((x) => x.pipeline === 'router' && faultIds.includes(x.scenarioId))
    return {
      haltPass: runs.filter((x) => x.pass).length,
      haltTotal: runs.length,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Build the task matrix

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
    console.log(`${run.pass ? 'HALT' : 'DEC  '} ${String(run.arm).padEnd(16)} ${run.scenarioId.padEnd(22)} got=${run.decision ?? '—'} ${run.pass ? 'PASS' : 'FAIL'} ${run.error ?? ''}`.trim())
  }
})

// ---------------------------------------------------------------------------
// Aggregate into the two tables

const NOT_TOLD: Array<{ arm: ArmId; armKey: string }> = [
  { arm: 'direct-llm', armKey: 'direct-llm' },
  { arm: 'react', armKey: 'react' },
  { arm: 'direct-validator', armKey: 'direct-validator' },
]
const TOLD: Array<{ arm: ArmId; armKey: string }> = [
  { arm: 'direct-llm-told', armKey: 'direct-llm-told' },
  { arm: 'react-told', armKey: 'react-told' },
]

function tableRows(arms: Array<{ arm: ArmId; armKey: string }>): string[] {
  const header = 'fault (injected) | ' + arms.map((x) => ARMS[x.arm].label).join(' | ')
  const sep = '--- | ' + arms.map(() => '---').join(' | ')
  const lines = [header, sep]
  for (const kind of APPLICABLE_TO_BASELINES) {
    const cells = arms.map(({ arm }) => {
      const row = runs.find((x) => x.arm === arm && x.faultKind === kind)
      if (!row) return '—'
      const mark = row.pass ? 'HALT ✓' : `${row.decision ?? 'decided'} ✗`
      return `${mark}${row.error ? ` (err ${row.error})` : ''}`
    })
    lines.push(`${FAULT_KIND_LABEL[kind]} | ${cells.join(' | ')}`)
  }
  const ref = readRouterReference()
  if (ref) {
    lines.push(
      `${FAULT_KIND_LABEL['jev-500']} + all (router reference) | ${arms.map(() => ref.haltTotal ? `${ref.haltPass}/${ref.haltTotal} (${Math.round(100 * ref.haltPass / ref.haltTotal)}%)` : 'n/a').join(' | ')}`,
    )
  }
  return lines
}

const notToldTable = tableRows(NOT_TOLD)
const toldTable = tableRows(TOLD)

console.log('\n— FAULT TEST, NOT-TOLD (v1 prompts) —')
console.log(`model: ${MODEL_LABEL[args.model]}. gold for every row: halt (fail closed). Direct+validator = v1 prompt + deterministic validator, no LLM.`)
console.log(notToldTable.join('\n'))

console.log('\n— FAULT TEST, TOLD (v2 prompts: halt clause) —')
console.log(`model: ${MODEL_LABEL[args.model]}. gold for every row: halt (fail closed). Told versions differ from not-told ONLY via the halt clause.`)
console.log(toldTable.join('\n'))

console.log('\napplicability: jev-500 (Jev outage) is not applicable to baselines/validator — no Jev stage exists;')
console.log('it runs only in the router reference (real failure branch). Excluded from baseline scores.')

// ---------------------------------------------------------------------------
// Persist

const out = {
  task: 'fault-test-diagnostic',
  stage: 'task2d',
  generatedAt: new Date().toISOString(),
  model: process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest',
  baselineModel: args.model,
  baselineModelLabel: MODEL_LABEL[args.model],
  promptVersions: {
    'direct-llm': 'prompts/direct-llm-v1.txt',
    'direct-llm-told': 'prompts/direct-llm-v2-told.txt',
    react: 'prompts/react-v1.txt',
    'react-told': 'prompts/react-v2-told.txt',
    'direct-validator': 'prompts/direct-llm-v1.txt (not-told) + lib/validator.ts (deterministic)',
  },
  injection: {
    vehicle: {
      'direct-llm': 'SERVICE OUTPUT block appended to prompt',
      'direct-llm-told': 'SERVICE OUTPUT block appended to prompt',
      react: 'fault text attached to get_support_record tool observation',
      'react-told': 'fault text attached to get_support_record tool observation',
      'direct-validator': 'SERVICE OUTPUT block appended to prompt',
    },
    applicableToBaselines: APPLICABLE_TO_BASELINES,
    notApplicableToBaselines: ['jev-500'],
  },
  gold: 'all fault scenarios expect halt; pass = arm emitted halt',
  tables: {
    notTold: notToldTable,
    told: toldTable,
  },
  routerReference: (() => {
    const ref = readRouterReference()
    return ref ? `${ref.haltPass}/${ref.haltTotal} on fault scenarios (eval-results-v1.json)` : null
  })(),
  runs,
}

// convenience serialization: ensure the fallback in-memory strings survive
const outPath = resolve(args.out)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 2))
console.log(`\nwrote ${outPath}`)