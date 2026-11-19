import type {
  ExpectedOutcomeClass,
  ObservedOutcomeClass,
  SavedStageTrace,
  VerdictClassification,
} from '../../src/lib/live/gold'
import type { LiveRun, RunStatus, Scenario } from '../../src/lib/live/types'

// A decision outcome in the compact vocabulary used by the eval harness. Maps
// directly onto the gold reference (approve_refund / deny_refund /
// request_review + reason codes), so verdictForRun/verdictForOutcome apply.
export interface BaselineOutcome {
  decision: string | null
  reasonCode: string | null
}

export type PipelineKey = 'cot' | 'react' | 'router' | 'direct_validator' | 'rules_only'

export interface RunMetrics {
  pipeline: PipelineKey
  scenarioId: string
  repeat: number
  model?: string
  modelVersion?: string
  temperature?: number
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
  runStatus?: RunStatus
  route?: string | null
  haltStage?: string | null
  haltCode?: string | null
  stages?: SavedStageTrace[]
  expectedOutcome?: ExpectedOutcomeClass
  observedOutcome?: ObservedOutcomeClass
  outcomePass?: boolean
  stagePass?: boolean | null
  verdictClassification?: VerdictClassification
  validatorVersion?: string
  validatorHalted?: boolean
  validatorReason?: string | null
  faultInjected?: boolean
  applicable?: boolean
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