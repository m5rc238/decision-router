// Scenario fixtures for the live pipeline. Data lives in JSON files under
// this directory (system facts are fixture data — the same role a real
// database/API would play). The pipeline executes these end-to-end.
//
// `fault` entries are demo controls that deliberately feed a stage bad
// output so the REAL failure branches can be shown deterministically.

import type { Scenario } from '../../lib/live/types'
import refund200 from './refund-200-days.json'
import refund31 from './refund-31-days.json'
import refund30 from './refund-30-days.json'
import refund10 from './refund-10-days.json'
import ambiguous from './ambiguous-plan.json'
import failInvalidJson from './failure-invalid-json.json'
import failMissingRoute from './failure-missing-route.json'
import failJevDown from './failure-jev-down.json'
import failInvalidDecision from './failure-invalid-decision.json'
import failContradicts from './failure-contradicts.json'
import failMissingFacts from './failure-missing-facts.json'

export const SCENARIOS: Scenario[] = [
  refund200,
  refund31,
  refund30,
  refund10,
  ambiguous,
  failInvalidJson,
  failMissingRoute,
  failJevDown,
  failInvalidDecision,
  failContradicts,
  failMissingFacts,
] as Scenario[]

export function findScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]
}