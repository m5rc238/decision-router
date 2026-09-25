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
import type { PipelineKey, RunMetrics } from './lib/types'

loadEnvLocal()

const A = process.argv.slice(2)
const args = parseArgs(A)

if (A.includes('--help')) {
  console.log(`usage: npm run eval -- [flags]
  --pipelines cot,react,router   which baselines to run (default: cot,react)
  --ids id1,id2                 restrict to scenarios (default: all incl. variants)
  --repeat N                    runs per scenario (default: 1)
  --concurrency N               parallel runs (default: 2)
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
      pipeline: 'router', scenarioId: scenario.id, repeat: 0, decision: null, reasonCode: null,
      halted: true, pass: false, ms, tokensIn: 0, tokensOut: 0, fabricated: false,
      illegalAction: false, actions: [], error: err instanceof Error ? err.message : String(err),
    }
  }
  const gold = goldForScenario(scenario)
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

async function runBaseline(pipeline: PipelineKey, scenario: Scenario, repeat: number): Promise<RunMetrics> {
  const gold = goldForScenario(scenario)
  const r = pipeline === 'cot'
    ? await runCoT(scenario)
    : await runReact(scenario)
  const verdict = r.outcome.decision ? verdictForOutcome(
    { decision: r.outcome.decision, reasonCode: r.outcome.reasonCode ?? '' },
    gold,
  ) : { pass: false }
  const illegal = pipeline === 'react' && r.actions.some((a) => a.startsWith('execute_refund')) &&
    !(gold.expect === 'decide' && gold.decision === 'approve_refund')
  return {
    pipeline,
    scenarioId: scenario.id,
    repeat,
    decision: r.outcome.decision,
    reasonCode: r.outcome.reasonCode,
    halted: false,
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
  router: 'router',
}
if (pipelines.includes('router') && args.liveBase) setLiveApiBase(args.liveBase)
if (pipelines.includes('router') && !args.liveBase) {
  console.error('router pipeline needs --live-base (a running dev server, e.g. http://localhost:5199)')
  process.exit(1)
}

const all = benchmarkScenarioSet()
const scenarios = all.filter((s) => (args.ids.length ? args.ids.includes(s.id) : true)).slice(0, args.limit ?? all.length)

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
    const g = goldForScenario(scenarios.find((s) => s.id === m.scenarioId)!)
    const want = g.expect === 'halt' ? `HALT(${g.haltCode ?? g.haltStage ?? '?'})` : `${g.decision}/${g.reasonCode}`
    console.log(
      `${m.error ? 'ERR ' : '  '} ${LABEL[m.pipeline] ?? m.pipeline} ${m.scenarioId.padEnd(20)} got=${m.decision ?? '—'}${m.reasonCode ? `/${m.reasonCode}` : ''} ${m.pass ? 'PASS' : 'FAIL'} want=${want} ${m.fabricated ? 'FABRICATED ' : ''}${m.illegalAction ? 'ILLEGAL ' : ''}${fmt(m.ms) ?? '-'}ms`,
    )
  }
})

// ---------------------------------------------------------------------------
// Aggregate + report

interface PerPipe {
  pipeline: string
  decideRuns: number
  decidePass: number
  haltRuns: number
  haltPass: number
  fabricated: number
  illegal: number
  avgMs: number
  avgTokens: number
  consistency: number
  errors: number
}

const per: Record<string, PerPipe> = {}
for (const p of pipelines) per[p] = { pipeline: p, decideRuns: 0, decidePass: 0, haltRuns: 0, haltPass: 0, fabricated: 0, illegal: 0, avgMs: 0, avgTokens: 0, consistency: 0, errors: 0 }

const goldByScenario = new Map(scenarios.map((s) => [s.id, goldForScenario(s)]))
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
      counts.set(key.split('|')[1], (counts.get(key.split('|')[1]) ?? 0) + 1)
    }
    const max = Math.max(...counts.values())
    agreements.push(max / repeats.length)
  }
  per[p].consistency = agreements.length ? agreements.reduce((a, b) => a + b, 0) / agreements.length : Number.NaN
}

console.log('\n— RESULTS —')
console.log(`scenarios evaluated: ${scenarios.length} (x${args.repeat} repeat), runs: ${runs.length}`)
console.log('architecture | decisionAcc (decide) | haltCorrect (halt) | fabricated | illegalAction | consistency | meanMs | avgTok | errors')
for (const p of pipelines) {
  const row = per[p]
  const dAcc = row.decideRuns ? (100 * row.decidePass / row.decideRuns).toFixed(0) : 'n/a'
  const hAcc = row.haltRuns ? (100 * row.haltPass / row.haltRuns).toFixed(0) : 'n/a'
  console.log(
    `${(LABEL[p] ?? p).padEnd(11)} | ${dAcc.padStart(8)}% (${row.decidePass}/${row.decideRuns}) | ${hAcc.padStart(9)}% (${row.haltPass}/${row.haltRuns}) | ` +
    `${String(row.fabricated).padStart(8)} | ${String(row.illegal).padStart(12)} | ${fmt(row.consistency as number)?.padStart(12) ?? 'n/a'.padStart(12)} | ${fmt(row.avgMs / Math.max(1, row.decideRuns + row.haltRuns))} | ${fmt(row.avgTokens / Math.max(1, row.decideRuns + row.haltRuns))} | ${row.errors}`,
  )
}

const out = {
  generatedAt: new Date().toISOString(),
  model: process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview',
  scenarios: scenarios.map((s) => ({ id: s.id, label: s.label, gold: goldByScenario.get(s.id) })),
  pipelines: Object.values(per).map((r) => ({
    ...r,
    decisionAccuracy: r.decideRuns ? r.decidePass / r.decideRuns : null,
    haltCorrect: r.haltRuns ? r.haltPass / r.haltRuns : null,
  })),
  runs,
}
const outPath = resolve(args.out)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 2))
console.log(`\nwrote ${outPath}`)