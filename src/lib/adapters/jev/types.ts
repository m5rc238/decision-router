// The app's own adapter contract for semantic judgment (Jev).
//
// NOTE: This interface is OUR abstraction, not the Jev SDK. The mock in this
// repo exists so the app runs with zero credentials. When integrating real
// Jev, map Jev's actual APIs onto this interface in a separate adapter
// (e.g. src/lib/adapters/jev/realJevAdapter.ts) — do NOT treat the mock's
// internals below as Jev's API. Nothing in the pipeline should ever call
// adapters directly; it depends only on this interface.

import type { AdapterInfo } from '../../../types'

export type IntentChoice =
  | 'refund_request'
  | 'billing_question'
  | 'technical_issue'
  | 'cancellation_request'
  | 'other'

export type EscalationChoice = 'handle_automatically' | 'review' | 'escalate'

export interface ClassificationOutput {
  choice: string
  probabilities: { candidate: string; probability: number }[]
  confidence: number
}

// Deterministic facts about the request, computed BEFORE judgment, so the
// judge sees data but never has to fetch it or execute anything.
export interface JudgmentContext {
  message: string
  customerName: string
  facts: string[]
}

export interface JevAdapter extends AdapterInfo {
  /**
   * Bounded span-of-control classification. Given a fixed set of
   * candidate classes, return a probability distribution + confidence.
   * The mock scores keywords heuristically; a real adapter would be an
   * actual Jev classifier producing the same shape.
   */
  classify(
    question: string,
    candidates: readonly string[],
    context: JudgmentContext,
  ): Promise<ClassificationOutput>
}