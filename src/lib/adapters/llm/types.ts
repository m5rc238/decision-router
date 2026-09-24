// App's own contract for generative work (LLM). The LLM is NEVER asked to:
// retrieve data, calculate, check eligibility, or execute actions. It only
// receives already-resolved structured facts and decisions, and composes
// human-readable prose. The mock templated adapter satisfies this contract
// locally; a real adapter would swap in an actual LLM call with a prompt
// built from the same structured fields.

import type { AdapterInfo } from '../../../types'

export interface LlmRequest {
  /** Short label describing the generative task, e.g. "compose_explanation". */
  task: string
  /** Already-resolved facts/decisions. Never raw lookups or mid-calculation state. */
  structuredFacts: string[]
  customerName: string
}

export interface LlmOutput {
  text: string
  tokens: number
}

export interface LlmAdapter extends AdapterInfo {
  generate(request: LlmRequest): Promise<LlmOutput>
}