// Shared domain + pipeline types.

export type Layer = 'input' | 'deterministic' | 'jev' | 'llm' | 'action' | 'output'

export type RuntimeKind = 'mock' | 'real'

export interface AdapterInfo {
  kind: RuntimeKind
  name: string
  swapHint: string
}

export interface TraceStep {
  id: string
  layer: Layer
  title: string
  detail?: string
  distribution?: { candidate: string; probability: number }[]
  confidence?: number
  chips?: string[]
}

export interface Cost {
  deterministicOps: number
  jevCalls: number
  llmCalls: number
  llmTokens: number
}

export interface ActionResult {
  type: string
  summary: string
  id?: string
  amount?: number
  status?: string
}

export interface PipelineResult {
  mode: 'composed' | 'llm-only'
  steps: TraceStep[]
  response: string
  action?: ActionResult
  cost: Cost
}