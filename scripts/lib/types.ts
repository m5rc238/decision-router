import type { LiveRun, Scenario } from '../../src/lib/live/types'

// A decision outcome in the compact vocabulary used by the eval harness. Maps
// directly onto the gold reference (approve_refund / deny_refund /
// request_review + reason codes), so verdictForRun/verdictForOutcome apply.
export interface BaselineOutcome {
  decision: string | null
  reasonCode: string | null
}

export type PipelineKey = 'cot' | 'react' | 'router'

export interface RunMetrics {
  pipeline: PipelineKey
  scenarioId: string
  repeat: number
  decision: string | null
  reasonCode: string | null
  halted: boolean
  pass: boolean
  ms: number
  tokensIn: number
  tokensOut: number
  fabricated: boolean
  illegalAction: boolean
  actions: string[]
  error?: string
}

export type RunImpl = (scenario: Scenario) => Promise<{
  outcome: BaselineOutcome
  liveRun?: LiveRun // decision-router path
  text?: string
  ms: number
  tokensIn: number
  tokensOut: number
  actions: string[]
  error?: string
}>