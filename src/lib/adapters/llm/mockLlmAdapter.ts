// MOCK LLM adapter — templates prose from already-resolved structured facts.
//
// ⚠️ This is NOT a real LLM. It produces a human-readable response purely from
// the `structuredFacts` array it receives, which the pipeline has built from
// deterministic lookups/calculations + the judgment. A real adapter swaps
// these templates for an actual LLM call using the SAME structured fields — it
// still never performs lookups, math, or actions itself.

import type { LlmAdapter } from './types'

type Template = (facts: Record<string, string>) => string

const TEMPLATES: Record<string, Template> = {
  refund_executed: (f) =>
    `Hi ${f.customerName}, we found the duplicate billing you reported — ` +
    `we see ${f.dupDescription}, so the extra ${f.refundAmount} was charged twice. ` +
    `Because your payment was made by card and the overpayment falls inside the 90-day window, ` +
    `a refund of ${f.refundAmount} has been issued as ${f.refundId} and is now ${f.refundStatus}. ` +
    `It should appear on your statement in 3–5 business days. Anything else we can help with?`,

  refund_review: (f) =>
    `Hi ${f.customerName}, we looked into your refund request for ${f.requested}. ` +
    `We've flagged it for human review — a specialist will confirm eligibility and any adjustments ` +
    `within 1–2 business days. We'll email you as soon as it's resolved.`,

  refund_denied: (f) =>
    `Hi ${f.customerName}, thanks for reaching out. We checked the details: ${f.denialReason}. ` +
    `No refund was issued for ${f.requested}. If you believe this is in error, reply here and we'll take another look.`,

  billing_explanation: (f) =>
    `Hi ${f.customerName}, here's what's on your account. Your ${f.plan} plan is ${f.subscriptionStatus} at ` +
    `${f.price}/month. This month your total was ${f.invoiceTotal}, which includes: ${f.lineItems}. ` +
    `You've paid ${f.totalPaid} and have an outstanding balance of ${f.outstanding}. ` +
    `The ${f.changeExplanation} is what changed versus last month.`,

  technical_response: (f) =>
    `Hi ${f.customerName}, thanks for reporting the ${f.issue} issue. Our team is already debugging a matching ` +
    `report. For now, export PDFs are still available under Reports → Export. We'll update the status page once it's fixed.`,

  cancellation_response: (f) =>
    `Hi ${f.customerName}, your ${f.plan} subscription is currently ${f.subscriptionStatus}. ` +
    `To cancel, confirm here and we'll stop renewal on ${f.nextBillingDate}. ` +
    `Since it's ${f.paidThrough}, you keep access until the end of the current cycle.`,

  fallback: (f) =>
    `Hi ${f.customerName}, thanks for your message. We read it as: "${f.requestSnippet}". ` +
    `For the fastest resolution, note your account is on the ${f.plan} plan. ` +
    `If this is about billing or a specific charge, share the invoice number and we'll dig in.`,
}

export const mockLlmAdapter: LlmAdapter = {
  kind: 'mock',
  name: 'Mock LLM (template prose)',
  swapHint: 'Swap in a real model — it receives the same structured facts only.',
  async generate(request) {
    const facts: Record<string, string> = {}
    for (const fact of request.structuredFacts) {
      const eq = fact.indexOf('=')
      if (eq > 0) facts[fact.slice(0, eq).trim()] = fact.slice(eq + 1).trim()
    }

    const template = TEMPLATES[request.task] ?? TEMPLATES.fallback
    const text = template(facts)
    const tokens = Math.ceil(text.split(/\s+/).length * 1.35)

    return { text, tokens }
  },
}