// MOCK Jev adapter — heuristic stand-in so the app runs with no credentials.
//
// ⚠️ This is NOT the real Jev API and it does not run Jev. It approximates
// "bounded semantic judgment" with keyword scoring so the pipeline and UI can
// be built today. To go live, implement `src/lib/adapters/jev/types.ts`
// (`JevAdapter.classify`) against real Jev in a `realJevAdapter.ts` that
// returns the same ClassificationOutput shape. Nothing else changes.

import type { ClassificationOutput, JudgmentContext, JevAdapter } from './types'
import type { AdapterInfo } from '../../../types'

export interface LexicalSignal {
  words: string[]
  strength: number
}

interface SignalEntry {
  label: string
  signals: LexicalSignal[]
}

// Signals are ordered; the first matched signal wins the top probability.
// strength ∈ [0.5, 0.99] — realistic models rarely output >= 0.99.
const INTENT_SIGNALS: SignalEntry[] = [
  {
    label: 'refund_request',
    signals: [
      { words: ['refund', 'money back', 'charged twice', 'double charge', 'refund me'], strength: 0.95 },
      { words: ['charged', 'overcharged', 'billing mistake'], strength: 0.72 },
    ],
  },
  {
    label: 'billing_question',
    signals: [{ words: ['bill', 'invoice', 'charge', 'fee', 'subscription', 'plan'], strength: 0.65 }],
  },
  {
    label: 'cancellation_request',
    signals: [{ words: ['cancel', 'cancel my subscription', 'stop renewing', 'cancel plan'], strength: 0.94 }],
  },
  {
    label: 'technical_issue',
    signals: [{ words: ['broken', 'error', 'bug', 'not loading', 'export', 'portal', 'login'], strength: 0.8 }],
  },
]

const ESCALATION_SIGNALS: SignalEntry[] = [
  {
    label: 'handle_automatically',
    signals: [
      { words: ['charged twice', 'duplicate', 'money back'], strength: 0.9 },
      { words: ['billing', 'invoice', 'subscription'], strength: 0.62 },
    ],
  },
  {
    label: 'review',
    signals: [{ words: ['never got', 'promised', 'refund', 'charged'], strength: 0.55 }],
  },
  {
    label: 'escalate',
    signals: [{ words: ['lawsuit', 'lawyer', 'fraud', 'chargeback'], strength: 0.85 }],
  },
]

function softmax(scores: number[]): number[] {
  const max = Math.max(...scores)
  const exps = scores.map((s) => Math.exp(s - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((e) => e / sum)
}

// Sharpness: scores are passed through softmax with a scale factor so a
// strong signal reads as a high probability — the shape a well-calibrated
// classifier would show (a clear "charged twice" → ~90% refund_request, not a
// flat 40%).
const SCALE = 8
const FLOOR = 0.04
const TOP_CAP = 0.985

function scoreEntry(text: string, entry: SignalEntry, context: JudgmentContext): number {
  const lower = text.toLowerCase()
  const best = entry.signals.reduce((peak, s) => {
    const hit = s.words.some((w) => lower.includes(w))
    return hit && s.strength > peak ? s.strength : peak
  }, FLOOR)
  // Context facts bias only slightly — enough to reward a coherent story.
  const factHits = context.facts.filter((f) => f.toLowerCase().includes(entry.label.replaceAll('_', ' ')))
  return Math.min(0.99, best + factHits.length * 0.01)
}

function classifyMock(
  signalTable: SignalEntry[],
  context: JudgmentContext,
  extraBoost: Record<string, number> = {},
): ClassificationOutput {
  const scores = signalTable.map((entry) => {
    const base = scoreEntry(context.message, entry, context)
    return Math.min(0.99, base + (extraBoost[entry.label] ?? 0))
  })

  // softmax over (score × SCALE), then capped so the top class never reads as
  // a fake 100%.
  const probs = softmax(scores.map((s) => s * SCALE))
  const topIndex = probs.indexOf(Math.max(...probs))
  const capped: number[] = probs.map((p, i) => (i === topIndex ? Math.min(p, TOP_CAP) : p))
  const sum = capped.reduce((a, b) => a + b, 0)
  const normalized = capped.map((p) => p / sum)

  const out = signalTable.map((entry, i) => ({ candidate: entry.label, probability: normalized[i] }))
  const topP = normalized[topIndex]
  // Confidence trails the top probability slightly — a 94% call scores ~0.91.
  const confidence = Math.round(Math.min(0.96, Math.max(0.3, topP - 0.03)) * 100) / 100
  return { choice: out[topIndex].candidate, probabilities: out, confidence }
}

export const mockJevAdapter: JevAdapter & AdapterInfo = {
  kind: 'mock',
  name: 'Mock Jev (heuristic)',
  swapHint: 'Replace with realJevAdapter.ts — same interface, no pipeline changes.',
  async classify(question: string, _candidates: readonly string[], context: JudgmentContext) {
    if (question === 'intent') return classifyMock(INTENT_SIGNALS, context)
    if (question === 'escalation') {
      const flagged = context.facts.some((f) => f.includes('account_flagged=true'))
      return classifyMock(ESCALATION_SIGNALS, context, flagged ? { review: 0.12 } : {})
    }
    throw new Error(`Unsupported judgment question: ${question}`)
  },
}