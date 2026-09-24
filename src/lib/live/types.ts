// Types for the LIVE composed pipeline. This is the real execution model —
// every stage is recorded as it actually happens (spinners while in flight,
// actual JSON inputs/outputs, measured latency, token usage, or a visible
// failure). Nothing here is fake.

import type { Layer } from '../../types'

export interface VerifiedFacts {
  purchase_age_days?: number
  refund_window_days?: number
  account_status?: string
  previous_refunds_count?: number
  [key: string]: number | string | undefined
}

export type FaultStage = 'semantic_router' | 'jev_judgment' | 'response_composer'

export type FaultKind = 'invalid-json' | 'missing-route' | 'jev-500' | 'jev-invalid-decision' | 'contradicts'

export interface Fault {
  stage: FaultStage
  kind: FaultKind
}

export interface Scenario {
  id: string
  label: string
  group: 'refund' | 'failure'
  userInput: string
  facts?: VerifiedFacts
  fault?: Fault | null
}

export type StageKey =
  | 'user_input'
  | 'semantic_router'
  | 'route_contract'
  | 'verified_facts'
  | 'jev_judgment'
  | 'decision_contract'
  | 'response_composer'
  | 'user_response'

export type LiveStatus = 'idle' | 'running' | 'done' | 'error'

export interface LiveTokens {
  input?: number
  output?: number
  total?: number
  cacheRead?: number
}

export interface LiveStage {
  key: StageKey
  layer: Layer
  status: LiveStatus
  /** Human view of what the stage received. */
  input?: string
  /** Serialized JSON (or prose) form of what the stage produced. */
  output?: string
  /** Short highlighted result, e.g. the Jev decision. */
  highlight?: string
  error?: string
  errorCode?: string
  ms?: number
  tokens?: LiveTokens
  injected?: boolean
  /** demo fault injection short-circuit (only for fault scenarios). */
  faulted?: boolean
}

export type RunStatus = 'running' | 'done' | 'error' | 'triage'

export interface LiveRun {
  scenarioId: string
  /** Surrogate to distinguish runs in the UI. */
  runId: number
  status: RunStatus
  stages: LiveStage[]
  totalMs: number
  /** Short note for graceful halts (e.g. human triage). */
  note?: string
}

export interface JevSelected {
  choice: string
  reasonCode: string
  confidence: number
  probabilities?: Record<string, number>
}

export interface LlmCallResult {
  text: string
  modelID: string
  providerID: string
  ms: number
  tokens: LiveTokens
}

export interface JevCallResult {
  answers: {
    refund_decision?: { type?: string; choice?: string; confidence?: number; probabilities?: Record<string, number> }
    reason_code?: { type?: string; choice?: string; confidence?: number }
  }
  usage?: Record<string, unknown> | null
  ms: number
  costUsd?: number | null
}

export interface RouterContract {
  route: string
  decisionSpace: string
  extractedEntities: Record<string, string>
  ambiguity: string[]
}

export interface DecisionContract {
  decision: 'approve_refund' | 'deny_refund' | 'request_review'
  reasonCode: string
  confidence: number
  evidence: VerifiedFacts
}