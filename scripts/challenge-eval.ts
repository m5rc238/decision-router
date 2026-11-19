// Offline 3-version challenge-set & audit evaluation (zero API keys required).
//
// Evaluates:
//   1. validator-v1.0-frozen + router-guards-v1
//   2. validator-v2.0-structural + router-guards-v2.0 (preserved audit snapshot)
//   3. validator-v2.1-structured + router-guards-v2.1 (plus direct-native & regex-stress)
//
// Usage:
//   npm run challenge-eval
//   npm run challenge-eval -- --write

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  evaluateDeterministicChallenge,
  type DeterministicEvalSummary,
} from './lib/challenge'

const writeFlag = process.argv.includes('--write')

function fmtCell(pass: number | null, fail: number | null, n: number): string {
  if (pass === null || fail === null) return 'n/a (not applicable)'
  return `${pass}/${n} pass (fail ${fail})`
}

function printSummary(label: string, s: DeterministicEvalSummary): void {
  console.log(`\n=== ${label} ===`)
  console.log(`validator: ${s.validatorVersion} | routerGuard: ${s.routerGuardVersion} | mode: ${s.evaluationMode}`)
  console.log('slice (unique scenarios)               | Direct+validator        | Router boundary')
  console.log('---------------------------------------+-------------------------+------------------------')
  for (const [name, c] of Object.entries(s.slices)) {
    console.log(
      `${`${name} (n=${c.uniqueScenarios})`.padEnd(38)} | ` +
        fmtCell(c.directValidatorPass, c.directValidatorFail, c.uniqueScenarios).padEnd(23) +
        ' | ' +
        fmtCell(c.routerPass, c.routerFail, c.uniqueScenarios),
    )
  }
  console.log(
    `${`component_outage (n=${s.componentOutagesSeparate.uniqueScenarios})`.padEnd(38)} | ` +
      'n/a (excl. baseline)'.padEnd(23) +
      ` | ${s.componentOutagesSeparate.routerCaught}/${s.componentOutagesSeparate.uniqueScenarios} pass (fail ${s.componentOutagesSeparate.routerMissed})`,
  )
  console.log(`Pending live model runs (${s.pendingLiveModelCases.length}): ${s.pendingLiveModelCases.join(', ')}`)

  const failures = s.rows.filter(
    (r) => !r.requiresLiveModel && ((r.applicableToDirectValidator && r.directValidatorPass === false) || (r.applicableToRouter && r.routerGuardPass === false)),
  )
  if (failures.length > 0) {
    console.log('Exposed failures:')
    for (const r of failures) {
      const dv = r.applicableToDirectValidator
        ? r.directValidatorPass
          ? 'PASS'
          : `FAIL(${r.directValidatorClassification})`
        : 'N/A'
      const rt = r.applicableToRouter
        ? r.routerGuardPass
          ? 'PASS'
          : `FAIL(${r.routerGuardClassification})`
        : 'N/A'
      console.log(`  - ${r.id}: direct_validator=${dv} | router=${rt}`)
    }
  }
}

const v1Eval = evaluateDeterministicChallenge('v1', { includeAudit: false, includeDirectAndStress: false })
const v20Eval = evaluateDeterministicChallenge('v2.0', { includeAudit: true, includeDirectAndStress: false })
const v21Eval = evaluateDeterministicChallenge('v2.1', { includeAudit: true, includeDirectAndStress: true })

printSummary('FROZEN V1 BASELINE', v1Eval)
printSummary('FROZEN V2.0 AUDIT (PRESERVED FAILURES)', v20Eval)
printSummary('V2.1 STRUCTURED + DIRECT-NATIVE + REGEX CEILING', v21Eval)

if (writeFlag) {
  mkdirSync(resolve('results'), { recursive: true })
  const legacyPath = resolve('results/challenge-eval-v2-structural.json')
  if (existsSync(legacyPath)) unlinkSync(legacyPath)

  writeFileSync(
    resolve('results/challenge-eval-v1-frozen.json'),
    JSON.stringify({ provenance: 'deterministic_offline_challenge_eval', ...v1Eval }, null, 2),
  )
  writeFileSync(
    resolve('results/challenge-eval-v2.0-audit.json'),
    JSON.stringify(
      {
        provenance: 'deterministic_offline_challenge_eval',
        note: 'Preserved v2.0 snapshot documenting the 3 weaknesses caught on post-v2-audit-v1.0 before v2.1.',
        ...v20Eval,
      },
      null,
      2,
    ),
  )
  writeFileSync(
    resolve('results/challenge-eval-v2.1-structured.json'),
    JSON.stringify(
      {
        provenance: 'deterministic_offline_challenge_eval',
        note: 'v2.1 structured validator + router-guards-v2.1, including direct-native faults and deliberately un-tuned regex-stress ceiling probe.',
        ...v21Eval,
      },
      null,
      2,
    ),
  )
  console.log(
    '\nwrote results/challenge-eval-v1-frozen.json, results/challenge-eval-v2.0-audit.json, results/challenge-eval-v2.1-structured.json',
  )
}
