// Research eval: compare the Decision Router (live) against a Direct LLM +
// Structured Output baseline and a ReAct tool-calling agent on the gold-labeled
// scenario set.
//
//   npm run eval -- --pipelines cot,react,router --live-base http://localhost:5199 --repeat 3
//
// Metrics per pipeline over gold-labeled runs:
//   - decision accuracy    (gold=decide cases only; exact decision+reason match)
//   - halt correctness     (gold=halt cases only; baseline false-decides → 0)
//   - fabricated value rate (amounts/dates invented — the facts domain has none)
//   - illegal action rate  (ReAct: execute_refund when gold forbids it)
//   - consistency          (agreement across repeats within a scenario)
// Latency is reported as the MEAN pipeline wall-time across runs.
// Output: a human table on stdout and results.json.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { LiveRun, Scenario } from '../src/lib/live/types'
import { goldForScenario, verdictForOutcome, verdictForRun } from '../src/lib/live/gold'
import { runLivePipeline, setLiveApiBase } from '../src/lib/live/pipeline'
import { loadEnvLocal } from './lib/env'
import { benchmarkScenarioSet } from './lib/scenarios'
import { hasFabricatedValue } from './lib/fabrication'
import { fmt, parseArgs } from './lib/parse'
import { runCoT } from './lib/cot'
import { runReact } from './lib/react'
import { validateDirectModel, applyValidator } from './lib/validator'
import { MODEL_LABEL, type ModelKey } from './lib/llm'
import { expandWithParaphrases, goldScenarioFor, baseOfId } from './lib/paraphrases'
import { wilson95, fmtWilson } from './lib/stats'
import type { PipelineKey, RunMetrics } from './lib/types'

loadEnvLocal()

const A = process.argv.slice(2)
const args = parseArgs(A)

if (A.includes('--help')) {
  console.log(`usage: npm run eval -- [flags]
  --pipelines cot,react,router,direct_validator   which baselines to run (default: cot,react)
  --ids id1,id2                 restrict to scenarios (default: all incl. variants)
  --repeat N                    runs per scenario (default: 1)
  --concurrency N               parallel runs (default: 2)
  --model gemini|opencode       baseline model (default: gemini — Big Pickle via opencode for the Router's model)
  --variations                  expand decidable/escalation scenarios with 3 paraphrases each (Task 4)
  --limit N                     cap total scenarios evaluated
  --live-base URL               dev server base URL when router is included
  --out path.json               output file (default: eval-results.json)
  --quiet                       print table only, no per-run lines`)
  process.exit(0)
}

function reasonFromOutput(output: string | undefined): string | null {
  if (!output) return null
  const m = output.match(/"reasonCode"\s*:\s*"([^"]+)"/)
  return m ? m[1] : output.match(/"reason_code"\s*:\s*"([^"]+)"/)?.[1] ?? null
}

async function runRouter(scenario: Scenario): Promise<RunMetrics> {
  let run: LiveRun | undefined
  const started = Date.now()
  try {
    run = await runLivePipeline({ scenario, onUpdate: (r) => { run = r } })
  } catch (err) {
    const ms = Date.now() - started
    return {
      pipeline: 'router', scenarioId: scenario.id, repeat: 0, model: MODEL_LABEL.opencode, decision: null, reasonCode: null,
      halted: true, pass: false, ms, tokensIn: 0, tokensOut: 0, fabricated: false,
      illegalAction: false, actions: [], error: err instanceof Error ? err.message : String(err),
    }
  }
  const gold = goldForScenario(goldScenarioFor(scenario, allById))
  const verdict = verdictForRun(run, gold)
  const decisionCard = run.stages.find((s) => s.key === 'decision_contract')
  const composer = run.stages.find((s) => s.key === 'response_composer')
  const tokensIn = run.stages.reduce((n, s) => n + (s.tokens?.input ?? 0), 0)
  const tokensOut = run.stages.reduce((n, s) => n + (s.tokens?.output ?? 0), 0)
  const scanned = [decisionCard?.output, composer?.output, composer?.highlight].filter(Boolean).join(' ')
  return {
    pipeline: 'router',
    scenarioId: scenario.id,
    repeat: 0,
    model: MODEL_LABEL.opencode,
    decision: decisionCard?.highlight ?? null,
    reasonCode: reasonFromOutput(decisionCard?.output),
    halted: run.status === 'error' || run.status === 'triage',
    pass: verdict.pass,
    ms: run.totalMs,
    tokensIn,
    tokensOut,
    fabricated: hasFabricatedValue(scanned),
    illegalAction: false,
    actions: run.note ? [`note:${run.note}`] : [],
  }
}

function verdictForBaseline(decision: string, reasonCode: string | null, gold: { expect: 'decide' | 'halt' }) {
  // A baseline arm that halts is correct only when gold expects a halt.
  if (decision === 'halt') {
    return gold.expect === 'halt' ? { pass: true } : { pass: false }
  }
  return verdictForOutcome({ decision, reasonCode: reasonCode ?? '' }, gold as ReturnType<typeof goldForScenario>)
}

async function runBaseline(pipeline: PipelineKey, scenario: Scenario, repeat: number): Promise<RunMetrics> {
  const modelKey: ModelKey = args.model
  const gold = goldForScenario(goldScenarioFor(scenario, allById))
  let outcome: { decision: string | null; reasonCode: string | null }
  if (pipeline === 'cot') {
    const r = await runCoT(scenario, { model: modelKey })
    outcome = r.outcome
    const verdict = verdictForBaseline(outcome.decision ?? '', outcome.reasonCode, gold)
    return {
      pipeline, scenarioId: scenario.id, repeat, model: MODEL_LABEL[modelKey],
      modelVersion: r.modelVersion, temperature: r.temperature,
      decision: outcome.decision, reasonCode: outcome.reasonCode,
      halted: outcome.decision === 'halt', pass: verdict.pass,
      ms: r.ms, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
      fabricated: hasFabricatedValue(r.text), illegalAction: false,
      actions: r.actions, error: r.error,
    }
  }
  if (pipeline === 'direct_validator') {
    const r = await runCoT(scenario, { model: modelKey })
    const validator = validateDirectModel(r.outcome, scenario.facts, r.evidence)
    outcome = applyValidator(r.outcome, validator)
    const verdict = verdictForBaseline(outcome.decision ?? '', outcome.reasonCode, gold)
    return {
      pipeline, scenarioId: scenario.id, repeat, model: MODEL_LABEL[modelKey],
      modelVersion: r.modelVersion, temperature: r.temperature,
      decision: outcome.decision, reasonCode: outcome.reasonCode,
      halted: outcome.decision === 'halt', pass: verdict.pass,
      ms: r.ms, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
      fabricated: hasFabricatedValue(r.text), illegalAction: false,
      actions: r.actions, error: r.error,
    }
  }
  // react
  const r = await runReact(scenario, { model: modelKey })
  outcome = r.outcome
  const verdict = verdictForBaseline(outcome.decision ?? '', outcome.reasonCode, gold)
  const illegal = r.actions.some((a) => a.startsWith('execute_refund')) &&
    !(gold.expect === 'decide' && gold.decision === 'approve_refund')
  return {
    pipeline,
    scenarioId: scenario.id,
    repeat,
    model: MODEL_LABEL[modelKey],
    modelVersion: r.modelVersion,
    temperature: r.temperature,
    decision: outcome.decision,
    reasonCode: outcome.reasonCode,
    halted: outcome.decision === 'halt',
    pass: verdict.pass,
    ms: r.ms,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    fabricated: hasFabricatedValue(r.text),
    illegalAction: illegal,
    actions: r.actions,
    error: r.error,
  }
}

// ---------------------------------------------------------------------------

const pipelines = (args.pipelines.length ? args.pipelines : ['cot', 'react']) as PipelineKey[]

// Short, report-consistent labels for stdout (the JSON keeps the pipeline keys).
const LABEL: Record<string, string> = {
  cot: 'direct-llm',
  react: 'react',
  direct_validator: 'direct+validator',
  router: 'router',
}
if (pipelines.includes('router') && args.liveBase) setLiveApiBase(args.liveBase)
if (pipelines.includes('router') && !args.liveBase) {
  console.error('router pipeline needs --live-base (a running dev server, e.g. http://localhost:5199)')
  process.exit(1)
}

const all = benchmarkScenarioSet()
const allById = new Map(all.map((s) => [s.id, s]))
// Task 4: expand decidable/escalation scenarios with 3 paraphrases each.
const base = args.variations ? expandWithParaphrases(all) : all
// --ids should match the base id (a variation id like "refund-10-days~p1" is
// selected by passing its base id).
function idMatched(scenarioId: string): boolean {
  if (!args.ids.length) return true
  const baseId = baseOfId(scenarioId) ?? scenarioId
  return args.ids.includes(baseId)
}
const scenarios = base.filter((s) => idMatched(s.id)).slice(0, args.limit ?? base.length)

// Gold must be resolved through the BASE scenario (variations share its facts).
const goldByScenario = new Map(
  scenarios.map((s) => [s.id, goldForScenario(goldScenarioFor(s, allById))]),
)

const tasks: Array<() => Promise<RunMetrics>> = []
for (const p of pipelines) {
  for (const s of scenarios) {
    for (let i = 0; i < args.repeat; i++) {
      tasks.push(() => (p === 'router' ? runRouter(s) : runBaseline(p, s, i + 1)))
    }
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

const runs: RunMetrics[] = []
await mapPool(tasks, args.concurrency, async (task) => {
  const m = await task()
  runs.push(m)
  if (!args.quiet) {
    const g = goldByScenario.get(m.scenarioId)
    if (g) {
      const want = g.expect === 'halt' ? `HALT(${g.haltCode ?? g.haltStage ?? '?'})` : `${g.decision}/${g.reasonCode}`
      console.log(
        `${m.error ? 'ERR ' : '  '} ${LABEL[m.pipeline] ?? m.pipeline}${m.model ? `/ ${m.model}` : ''} ${m.scenarioId.padEnd(20)} got=${m.decision ?? '—'}${m.reasonCode ? `/${m.reasonCode}` : ''} ${m.pass ? 'PASS' : 'FAIL'} want=${want} ${m.fabricated ? 'FABRICATED ' : ''}${m.illegalAction ? 'ILLEGAL ' : ''}${fmt(m.ms) ?? '-'}ms`,
      )
    }
  }
})

// ---------------------------------------------------------------------------
// Aggregate + report

interface PerPipe {
  pipeline: string
  model: string
  decideRuns: number
  decidePass: number
  haltRuns: number
  haltPass: number
  /** gold=decide runs that halted or escalated anyway (over-halt). */
  overHalt: number
  fabricated: number
  illegal: number
  avgMs: number
  avgTokens: number
  consistency: number
  errors: number
}

const per: Record<string, PerPipe> = {}
for (const p of pipelines) per[p] = { pipeline: p, model: p === 'router' ? MODEL_LABEL.opencode : MODEL_LABEL[args.model], decideRuns: 0, decidePass: 0, haltRuns: 0, haltPass: 0, overHalt: 0, fabricated: 0, illegal: 0, avgMs: 0, avgTokens: 0, consistency: 0, errors: 0 }

for (const r of runs) {
  const g = goldByScenario.get(r.scenarioId)
  const row = per[r.pipeline]
  if (!g) continue
  row.avgMs += r.ms
  row.avgTokens += r.tokensIn + r.tokensOut
  if (r.error) row.errors++
  if (g.expect === 'decide') {
    row.decideRuns++
    if (r.pass) row.decidePass++
    // Over-halt: gold expects a decision (incl. escalate-to-review as a decision),
    // the arm withheld (halted) AND that withholding was NOT accepted by the gold
    // reference (router triage on request_review gold passes, so it is not counted).
    const withheld = r.halted || (r.decision === 'halt')
    if (withheld && !r.pass) row.overHalt++
  } else {
    row.haltRuns++
    if (r.pass) row.haltPass++
  }
  if (r.fabricated) row.fabricated++
  if (r.illegalAction) row.illegal++
}

const consistencyMap: Record<string, Record<string, number>> = {}
for (const r of runs) {
  consistencyMap[r.pipeline] ??= {}
  const key = `${r.scenarioId}|${r.decision ?? '∅'}/${r.reasonCode ?? ''}`
  consistencyMap[r.pipeline][key] = (consistencyMap[r.pipeline][key] ?? 0) + 1
}
for (const p of pipelines) {
  if (args.repeat < 2) {
    per[p].consistency = Number.NaN
    continue
  }
  const byScenario = new Map<string, number[]>()
  for (const r of runs) {
    if (r.pipeline !== p) continue
    byScenario.set(r.scenarioId, [...(byScenario.get(r.scenarioId) ?? []), r.pipeline === 'router' ? 0 : r.repeat])
  }
  const agreements: number[] = []
  for (const [sid, repeats] of byScenario) {
    if (repeats.length < 2) continue
    const counts = new Map<string, number>()
    for (const key of Object.keys(consistencyMap[p]).filter((k) => k.startsWith(sid + '|'))) {
      const pair = key.split('|')[1]
      counts.set(pair, (counts.get(pair) ?? 0) + consistencyMap[p][key])
    }
    const max = Math.max(...counts.values())
    agreements.push(max / repeats.length)
  }
  per[p].consistency = agreements.length ? agreements.reduce((a, b) => a + b, 0) / agreements.length : Number.NaN
}

console.log('\n— RESULTS —')
console.log(`scenarios evaluated: ${scenarios.length}${args.variations ? ' (incl. paraphrases)' : ''} (x${args.repeat} repeat), runs: ${runs.length}, baseline model: ${MODEL_LABEL[args.model]}`)
console.log('architecture | model | decisionAcc ±95%CI (decide) | haltCorrect (halt) | over-halt | fabricated | illegalAction | consistency | meanMs | avgTok | errors')
for (const p of pipelines) {
  const row = per[p]
  const dAcc = row.decideRuns ? fmtWilson(row.decidePass, row.decideRuns) : 'n/a'
  const hAcc = row.haltRuns ? `${Math.round(100 * row.haltPass / row.haltRuns)}% (${row.haltPass}/${row.haltRuns})` : 'n/a'
  const ohR = row.decideRuns ? `${row.overHalt}/${row.decideRuns} (${Math.round(100 * row.overHalt / row.decideRuns)}%)` : 'n/a'
  console.log(
    `${(LABEL[p] ?? p).padEnd(15)} | ${row.model.padEnd(18)} | ${dAcc.padStart(16)} | ${hAcc.padStart(9)} | ${ohR.padStart(12)} | ` +
    `${String(row.fabricated).padStart(8)} | ${String(row.illegal).padStart(12)} | ${fmt(row.consistency as number)?.padStart(12) ?? 'n/a'.padStart(12)} | ${fmt(row.avgMs / Math.max(1, row.decideRuns + row.haltRuns))} | ${fmt(row.avgTokens / Math.max(1, row.decideRuns + row.haltRuns))} | ${row.errors}`,
  )
}

// Per-scenario table: each decidable scenario, decision pass-rate per pipeline
// (across the paraphrases when --variations, else across repeats for that scenario).
console.log('\n— PER-SCENARIO —')
console.log('scenario | gold | ' + pipelines.map((p) => `${(LABEL[p] ?? p).padEnd(18)} pass/decide`).join(' | '))
for (const s of scenarios) {
  const g = goldByScenario.get(s.id)
  if (!g || g.expect !== 'decide') continue
  const cells = pipelines.map((p) => {
    const rs = runs.filter((r) => r.pipeline === p && r.scenarioId === s.id)
    const pass = rs.filter((r) => r.pass).length
    return `${String(pass).padEnd(10)}/${rs.length}`
  })
  const goldLabel = `${g.decision}/${g.reasonCode}`
  console.log(`${s.id.padEnd(24)} | ${goldLabel.padEnd(14)} | ${cells.join(' | ')}`)
}

const out = {
  generatedAt: new Date().toISOString(),
  task: 'arch-vs-model',
  baselineModel: args.model,
  modelLabel: MODEL_LABEL[args.model],
  model: process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest',
  temperature: Number(process.env.GEMINI_TEMPERATURE ?? 0.7),
  variations: args.variations,
  scenarios: scenarios.map((s) => ({ id: s.id, label: s.label, gold: goldByScenario.get(s.id) })),
  pipelines: Object.values(per).map((r) => ({
    ...r,
    decisionAccuracy: r.decideRuns ? r.decidePass / r.decideRuns : null,
    decisionCI95: r.decideRuns ? wilson95(r.decidePass, r.decideRuns) : null,
    haltCorrect: r.haltRuns ? r.haltPass / r.haltRuns : null,
    overHaltRate: r.decideRuns ? r.overHalt / r.decideRuns : null,
  })),
  runs,
}
const outPath = resolve(args.out)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 2))
console.log(`\nwrote ${outPath}`)