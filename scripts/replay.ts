// Offline reproducible evaluation replay CLI (zero API keys required).
//
// Usage:
//   npm run replay
//   npm run replay -- --json

import { runOfflineReplay } from './lib/replay'

const report = runOfflineReplay()

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

function pct(k: number, n: number): string {
  return n ? `${((100 * k) / n).toFixed(1)}%` : 'n/a'
}

console.log(`=== OFFLINE REPLAY (${report.graderVersion}, bundle v${report.bundleVersion}, zero API keys) ===`)

console.log('\n0. DETERMINISTIC RULE-ENGINE BASELINE (zero LLM, zero Jev, <1 ms)')
const rb = report.rulesOnlyBaseline
console.log(
  `   rules_only: ${rb.decidePass}/${rb.uniqueDecideScenarios} unique decide scenarios (${pct(rb.decidePass, rb.uniqueDecideScenarios)}), ` +
    `${rb.sharedFaultPass}/${rb.uniqueSharedFaults} shared faults; fails only semantic/contradiction cases (${rb.failedDecideIds.join(', ')}) ` +
    `+ ${rb.judgmentCasesMechanicalFail}/2 judgment-needed live cases.`,
)

console.log('\n1. V1 MAIN BENCHMARK (eval-results-v1.json -> offline-replay-bundle.v2.json)')
console.log('   20 unique scenarios x 2 repeats = 40 runs per architecture (N = 120)')
console.log('architecture  | v1 decide (hist) | v2 decide (pass/fail/unverif) | v2 shared fault (n=8)           | v2 comp. outage | router stage checks | cost/decideRun*')
console.log('--------------+------------------+-------------------------------+---------------------------------+-----------------+---------------------+----------------')
for (const p of report.v1Main) {
  const h = p.historicalReported
  const r = p.rescoredV2
  const histStr = `${h.decidePass}/${h.decideTotal} (${pct(h.decidePass, h.decideTotal)})`.padEnd(16)
  const decStr = `${r.decideConfirmedPass}P / ${r.decideConfirmedFail}F / ${r.decideUnverifiable}U (n=${r.decideTotal})`.padEnd(29)
  const sfStr = (
    r.sharedFaultNotInjected === r.sharedFaultTotal
      ? `not injected (N/A; ${r.sharedFaultNotInjected} runs)`
      : `${r.sharedFaultConfirmedPass}P / ${r.sharedFaultConfirmedFail}F / ${r.sharedFaultUnverifiable}U`
  ).padEnd(31)
  const coStr = (
    p.pipeline === 'router'
      ? `${r.componentOutageConfirmedPass}P / ${r.componentOutageUnverifiable}U (n=${r.componentOutageTotal})`
      : `n/a (excl. ${r.componentOutageTotal})`
  ).padEnd(15)
  const stgStr = (
    r.stageTotal !== null
      ? `${r.stageConfirmedPass}P/${r.stageConfirmedFail}F/${r.stageUnverifiable}U/${r.stageUnknownNotSaved}ns`
      : 'n/a (outcome only)'
  ).padEnd(19)
  console.log(
    `${p.pipeline.padEnd(13)} | ${histStr} | ${decStr} | ${sfStr} | ${coStr} | ${stgStr} | ${String(p.confusion.illustrativeCostPerRun).padStart(6)}`,
  )
}
console.log('   *stage checks legend for v1 router: P=verified pass, F=verified fail, U=unverifiable halt, ns=stage trace not saved in v1 JSON.')
console.log('   *illustrative heuristic cost weights (decide runs): wrongApprove=10, missedFault=10, serviceError=6, wrongDeny=4, unnecEscalate/Stop=1.')

console.log(`\n   Confirmed verdict flips under ${report.graderVersion} (${report.v1Flips.length}):`)
for (const f of report.v1Flips) {
  console.log(`   - [${f.pipeline}#${f.index}] ${f.scenarioId}: v1=${f.v1Pass ? 'PASS' : 'FAIL'} -> v2=${f.v2Pass ? 'PASS' : 'FAIL'} (${f.classification}) — ${f.note}`)
}

console.log(`\n   Unverifiable historical v1 Router halt runs (${report.v1UnverifiableRuns.length} due to missing stage trace):`)
const unvCounts = new Map<string, number>()
for (const u of report.v1UnverifiableRuns) {
  unvCounts.set(u.scenarioId, (unvCounts.get(u.scenarioId) ?? 0) + 1)
}
for (const [sid, count] of unvCounts) {
  console.log(`   - ${sid}: ${count} run(s)`)
}

console.log('\n2. REPEAT-5 BASELINES (15 decide scenarios x 5 repeats = 75 runs; faults not injected in eval.ts)')
console.log('model    | architecture     | unique scenarios 5/5 | decide runs      | shared faults     | cost/run* | meanMs | meanTok**')
console.log('---------+------------------+----------------------+------------------+-------------------+-----------+--------+----------')
for (const row of report.rep5) {
  const uniqStr = `${row.uniqueDecideAllRepeatsPass}/${row.uniqueDecideScenarios} (${pct(row.uniqueDecideAllRepeatsPass, row.uniqueDecideScenarios)})`.padEnd(20)
  const dStr = `${row.decidePass}/${row.decideTotal} (${pct(row.decidePass, row.decideTotal)})`.padEnd(16)
  const fStr = `not injected (${row.sharedFaultNotInjected})`.padEnd(17)
  console.log(
    `${row.modelKey.padEnd(8)} | ${row.pipeline.padEnd(16)} | ${uniqStr} | ${dStr} | ${fStr} | ${String(row.confusion.illustrativeCostPerRun).padStart(9)} | ${String(row.meanMs).padStart(6)} | ${String(row.meanTokens).padStart(6)}`,
  )
}
console.log('   **OpenCode runs through an agent runtime with caching/system context; its token telemetry is non-comparable to Gemini.')

console.log('\n3. MATCHED-MODEL FAULT MATRIX (4 shared faults x 1 repeat = 4 runs per arm; jev-500 excluded)')
console.log('model    | arm              | v1 reported | v2 recomputed | saw SERVICE OUTPUT | proxy raw outcome')
console.log('---------+------------------+-------------+---------------+--------------------+------------------')
for (const f of report.faultMatrix) {
  console.log(
    `${f.modelKey.padEnd(8)} | ${f.arm.padEnd(16)} | ${f.v1ReportedPass}/${f.totalRuns}         | ${f.v2RecomputedPass}/${f.totalRuns}           | ${f.sawFaultEvidenceCount}/${f.totalRuns}                | ${f.usedProxyRawOutcome ? 'yes (from direct-llm)' : 'no'}`,
  )
}

console.log('\n4. CHALLENGE SET & 3-VERSION AUDIT (deterministic contract layers with oracle raw decisions; unique scenarios)')
for (const [tag, s] of [
  ['v1.0-frozen', report.challengeV1],
  ['v2.0-audit (preserved failures)', report.challengeV2_0],
  ['v2.1-structured + direct-native + regex-stress', report.challengeV2_1],
] as const) {
  console.log(`   [${tag}] ${s.validatorVersion} / ${s.routerGuardVersion}:`)
  for (const [k, c] of Object.entries(s.slices)) {
    const dv = c.directValidatorPass === null ? 'n/a' : `${c.directValidatorPass}/${c.uniqueScenarios} (fail ${c.directValidatorFail})`
    const rt = c.routerPass === null ? 'n/a' : `${c.routerPass}/${c.uniqueScenarios} (fail ${c.routerFail})`
    console.log(`     - ${k.padEnd(26)}: Direct+val=${dv.padEnd(16)} | Router=${rt}`)
  }
  console.log(`     - component_outage (Router-only): ${s.componentOutagesSeparate.routerCaught}/${s.componentOutagesSeparate.uniqueScenarios}`)
}
console.log(`   Pending live LLM/Jev runs (${report.challengeV2_1.pendingLiveModelCases.length}): ${report.challengeV2_1.pendingLiveModelCases.join(', ')}`)

console.log(`\n5. [SYNTHETIC TRACE FIXTURES — NOT EMPIRICAL] (${report.syntheticTraces.provenance})`)
console.log(`   Matched ${report.syntheticTraces.matched}/${report.syntheticTraces.total} stage-trace assertions.`)
for (const c of report.syntheticTraces.checks) {
  console.log(`   - ${c.id} (${c.scenarioId}): pass=${c.actualPass} class=${c.actualClassification}`)
}
