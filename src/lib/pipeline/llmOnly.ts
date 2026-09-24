// The "everything through the LLM" comparison mode. It is intentionally
// crude and conceptually demonstrative, not a serious benchmark: one opaque
// call is asked to interpret, decide what to look up, "remember" the account
// state, reason about policy, and compose prose. The mock simulates the usual
// failure modes: plausible-sounding output, no verifiable grounding, and a
// large token cost.

import type { LlmAdapter } from '../adapters/llm/types'
import type { Cost, PipelineResult } from '../../types'
import * as repo from '../deterministic/repository'
import { getAccountState } from '../deterministic/actions'

let stepSeq = 0
const step = (layer: 'input' | 'llm' | 'action' | 'output', title: string, detail?: string) => ({
  id: `lo${stepSeq++}`,
  layer,
  title,
  detail,
})

export async function runLlmOnly(args: {
  message: string
  customerRef: string
  llm: LlmAdapter
}): Promise<PipelineResult> {
  const { message, customerRef, llm } = args
  const cost: Cost = { deterministicOps: 0, jevCalls: 0, llmCalls: 0, llmTokens: 0 }
  const steps = [step('input', 'Input message', JSON.stringify(message))]

  // A single LLM call is asked to do everything. Each "step" below is the
  // same call reasoning about a different concern — there is no separation of
  // responsibility to audit.
  steps.push(
    step('llm', 'LLM parses message → infers intent', 'no candidate taxonomy, no calibration, no confidence estimate'),
    step('llm', 'LLM decides which records to consult', 'unverifiable: the model can only "remember" account state, it cannot query it'),
    step('llm', 'LLM performs implicit calculations & policy checks in prose', 'no audit trail for money amounts or eligibility rules'),
    step('llm', 'LLM composes the customer-facing answer and "executes" actions', 'refunds/charges described in text are not real state changes'),
  )

  // For a slightly honest comparison we retrieve the customer once (the
  // concept still starts from a human-typed message), but everything the
  // composed system computed deterministically is here bundled into the
  // model's context-free answer.
  const { customer } = repo.getCustomer(customerRef)
  const sub = repo.getSubscription(customer.id)
  const totals = repo.calculateTotals(customer.id)
  const state = getAccountState(customer.id)

  const output = await llm.generate({
    task: 'llm_only_monolith',
    customerName: customer.name,
    structuredFacts: [], // the model is *not* given resolved facts — that's the point
  })

  const simulate = (text: string) => {
    // Mock-only: generate the kind of plausible, ungrounded reply a big model
    // tends to produce when it can't actually look anything up.
    const wantsRefund = /refund|money back|charged twice/i.test(message)
    if (wantsRefund) {
      return `${text}\n\n--- simulated model reply ---\nHi ${customer.name}, I looked into this and I'm sorry about the double charge. I've refunded the $49.00 duplicate payment back to your card — you should see it within 3–5 business days. Is there anything else I can help with?\n\n(⚠️ In a real LLM-only system this reply is generated from memory, not from the payment ledger — the duplicate may not exist, and no refund is actually issued unless a separate tool is invoked.)`
    }
    return `${text}\n\n--- simulated model reply ---\nHi ${customer.name}, thanks for your message. Based on your ${sub.plan} subscription (${sub.status}, ${sub.monthlyPrice}/month, current balance ${totals.outstanding}, total refunds ${state.refundsTotal}), it looks like everything is in order. Let me know if you'd like more detail!\n\n(⚠️ Honest demo: these figures are plugged in by the mock — in a real LLM-only flow they'd come from the model's internal impression, not a live query.)`
  }

  cost.llmCalls += 1
  cost.llmTokens += output.tokens + 2400
  steps.push(step('llm', 'Single monolith call', `${output.tokens + 2400} tokens · one request for interpretation + retrieval + math + policy + prose`))
  steps.push(step('action', 'Replies (state unverifiable)', 'no deterministic action executed — response is prose only'))
  steps.push(step('output', 'Final answer'))

  return {
    mode: 'llm-only',
    steps,
    response: simulate(output.text),
    cost,
  }
}