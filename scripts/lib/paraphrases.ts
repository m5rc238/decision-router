// Task 4 — Paraphrase robustness set.
//
// For every DECIDABLE / ESCALATION scenario (gold.expect === 'decide', i.e. a
// real decision or a human-review escalation) we provide 3 reworded phrasings of
// the user's request. The FACTS are byte-identical across phrasings, so the gold
// expectation (derived from id + facts) is identical too — only the everyday
// wording changes. Fault scenarios (group === 'failure') are deliberately NOT
// paraphrased: their gold is "halt", and rewording a fault fixture would change
// which downstream service error is being tested.
//
// Purpose: measure WORDING ROBUSTNESS — does a pipeline reach the same decision
// when the same case is phrased three natural ways? A decision that flips on
// wording is a weakness no accuracy score shows.
//
// The set deliberately includes a rephrasing for ambiguous-plan: each alternate
// keeps the request ambiguous (no purchase/refund verb), so the expected
// outcome stays human review.

import type { Scenario } from '../../src/lib/live/types'

export interface ParaphraseEntry {
  /** base scenario id this entry paraphrases. */
  id: string
  /** 3 natural rewordings of the base scenario's userInput. */
  variants: string[]
}

export const PARAPHRASES: ParaphraseEntry[] = [
  {
    id: 'ambiguous-plan',
    variants: [
      'Could you take a look at my plan for me?',
      'Hi, could you help me out with my plan here?',
      'I was hoping you could help with my plan — it does not look right.',
    ],
  },
  {
    id: 'refund-10-days',
    variants: [
      'I signed up for Pro ten days back and would like my money back, is that possible?',
      'Ten days ago I purchased the Pro plan. I want a refund please.',
      'I would like to cancel my Pro subscription from 10 days ago and get a refund.',
    ],
  },
  {
    id: 'refund-30-days',
    variants: [
      'It has been exactly 30 days since I paid for Pro, could you refund it?',
      'I bought the Pro plan a month ago today and want a refund.',
      'Please refund my Pro plan — the purchase is exactly 30 days old.',
    ],
  },
  {
    id: 'refund-31-days',
    variants: [
      'I paid for the Pro plan 31 days ago and need a refund now.',
      'Could I get a refund? It is day 31 since my Pro purchase.',
      'My Pro plan was bought 31 days back — kindly refund it.',
    ],
  },
  {
    id: 'refund-200-days',
    variants: [
      'It has been over six months since I bought Pro — I would like a refund.',
      'I would like my money back for the Pro plan I paid for 200 days ago.',
      'Refund me please — my Pro purchase was almost a year ago.',
    ],
  },
  {
    id: 'edge-just-bought',
    variants: [
      'I changed my mind right after buying Pro an hour ago — can I get a refund?',
      'Bought the Pro plan about an hour ago and already regret it. Refund please.',
      'Can you reverse my Pro purchase from an hour ago? I want a refund.',
    ],
  },
  {
    id: 'edge-boundary-30-days',
    variants: [
      'My purchase hit day 30 today — could you refund it?',
      'I would like a refund; today marks exactly 30 days since I bought it.',
      'The plan is 30 days old to the day, please process a refund.',
    ],
  },
  {
    id: 'edge-boundary-31-days',
    variants: [
      'Day 31 since my purchase — please refund the Pro plan.',
      'I want a refund for Pro, it has now been 31 days.',
      'Kindly issue a refund for my Pro plan bought 31 days ago.',
    ],
  },
  {
    id: 'edge-inactive-account',
    variants: [
      'I would like a refund on my Pro plan please.',
      'Please process a refund for the Pro subscription.',
      'Can you give me a refund for Pro?',
    ],
  },
  {
    id: 'edge-account-cancelled',
    variants: [
      'My account got cancelled — can I be refunded for my last charge?',
      'Since my account was cancelled, I would like the latest charge refunded.',
      'I cancelled my account, please refund the most recent payment.',
    ],
  },
  {
    id: 'edge-repeat-refunds',
    variants: [
      'Please issue me another refund — for Pro this time.',
      'I need a refund again, on the Pro plan now.',
      'Do a refund for me once more, Pro plan please.',
    ],
  },
  {
    id: 'edge-repeat-out-window',
    variants: [
      'I have been waiting weeks for this — please refund my Pro plan.',
      'My Pro plan still has no refund and it has been weeks. Please do it now.',
      'Please finally refund the Pro plan; this has dragged on for weeks.',
    ],
  },
  {
    id: 'edge-chargeback-threat',
    variants: [
      'Refund me right away or I will raise a chargeback with my bank.',
      'Process the refund immediately, otherwise I am filing a chargeback.',
      'I will dispute the charge unless you refund me now.',
    ],
  },
  {
    id: 'edge-conflicting-claims',
    variants: [
      'My dashboard claims 10 days ago but I actually bought this two months back — refund me!',
      'I purchased 2 months ago even though it says 10 days. Refund, please.',
      'There is a date mix-up — I bought months ago, not 10 days. Give me a refund.',
    ],
  },
]

/** id → synonyms for the eligible (paraphraseable) scenario ids. */
const byId = new Map(PARAPHRASES.map((p) => [p.id, p.variants]))

export function paraphraseable(id: string): boolean {
  return byId.has(id)
}

/** The base scenario id that a variation-id stems from, or null if none. */
export function baseOfId(id: string): string | null {
  const m = id.match(/^(.*)~p([1-3])$/)
  return m ? m[1] : null
}

/**
 * Expand the benchmark set into the FULL wording set when `variations` is true:
 * every decidable/escalation scenario appears 4 times — original + 3
 * paraphrases — with ids `id`, `id~p1`, `id~p2`, `id~p3`. Facts are identical
 * (same gold); only userInput changes. Fault scenarios and unclear-paraphrasables
 * are untouched (single entry, original id).
 */
export function expandWithParaphrases(set: Scenario[]): Scenario[] {
  const out: Scenario[] = []
  for (const s of set) {
    out.push(s)
    const variants = byId.get(s.id)
    if (!variants) continue
    variants.forEach((v, i) => {
      out.push({
        ...s,
        id: `${s.id}~p${i + 1}`,
        userInput: v,
      })
    })
  }
  return out
}

/** Resolve the gold lookup for a variation-id back to its base scenario. */
export function goldScenarioFor(s: Scenario, byId: Map<string, Scenario>): Scenario {
  const base = baseOfId(s.id)
  return base ? byId.get(base) ?? s : s
}