// The composed system: Input → deterministic ops → Jev judgment →
// deterministic action → LLM only for prose. Every step records which layer
// produced it, so the UI can render responsibility at a glance.

import type { JevAdapter } from '../adapters/jev/types'
import type { LlmAdapter } from '../adapters/llm/types'
import type { Cost, PipelineResult, TraceStep } from '../../types'
import * as repo from '../deterministic/repository'
import { checkRefundEligibility } from '../deterministic/eligibility'
import { executeRefund } from '../deterministic/actions'

const money = (n: number) => `$${n.toFixed(2)}`

let stepSeq = 0
const step = (
  layer: TraceStep['layer'],
  title: string,
  extra: Partial<TraceStep> = {},
): TraceStep => ({ id: `s${stepSeq++}`, layer, title, ...extra })

const emptyCost = (): Cost => ({ deterministicOps: 0, jevCalls: 0, llmCalls: 0, llmTokens: 0 })

export async function runComposed(args: {
  message: string
  customerRef: string // id or email
  jev: JevAdapter
  llm: LlmAdapter
}): Promise<PipelineResult> {
  const { message, customerRef, jev, llm } = args
  const cost = emptyCost()
  const steps: TraceStep[] = []

  // ── 1. Input (no model involved) ────────────────────────────────────────
  steps.push(step('input', 'Input message', { detail: JSON.stringify(message) }))

  // ── 2. Deterministic: retrieval ─────────────────────────────────────────
  const { customer } = repo.getCustomer(customerRef)
  cost.deterministicOps += 1
  steps.push(
    step('deterministic', 'Retrieved customer', {
      detail: `${customer.name} (${customer.email}) · ${customer.tier} tier`,
      chips: [customer.id],
    }),
  )

  const invs = repo.getInvoices(customer.id)
  const pays = repo.getPayments(customer.id)
  cost.deterministicOps += 2
  steps.push(
    step('deterministic', 'Retrieved invoices & payments', {
      detail: `${invs.length} invoice(s), ${pays.length} payment(s) on record`,
    }),
  )

  const sub = repo.getSubscription(customer.id)
  const totals = repo.calculateTotals(customer.id)
  cost.deterministicOps += 2
  steps.push(
    step('deterministic', 'Checked subscription & totals', {
      detail: `${sub.plan} · ${sub.status} · ${money(sub.monthlyPrice)}/mo · paid ${money(totals.totalPaid)} of ${money(totals.totalBilled)}`,
    }),
  )

  const refunds = repo.getRefunds(customer.id)
  const duplicates = repo.detectDuplicatePayments(customer.id)
  cost.deterministicOps += 1
  if (duplicates.length > 0) {
    steps.push(
      step('deterministic', 'Detected duplicate payment', {
        detail: `${duplicates[0].payments.map((p) => p.id).join(' + ')} on ${duplicates[0].invoiceNumber} → overpaid ${money(duplicates[0].duplicatedAmount)}`,
        chips: [`${refunds.length} prior refund(s)`],
      }),
    )
  } else {
    steps.push(step('deterministic', 'Checked payment history — no duplicates', { detail: 'No invoice is overpaid.' }))
  }

  // ── 3. Jev: semantic judgment of intent ─────────────────────────────────
  const intentCtx = {
    message,
    customerName: customer.name,
    facts: [
      `overpayment ${money(duplicates[0]?.duplicatedAmount ?? 0)} on invoice ${duplicates[0]?.invoiceNumber ?? 'none'}`,
      `subscription ${sub.status}`,
    ],
  }
  const intent = await jev.classify(
    'intent',
    ['refund_request', 'billing_question', 'technical_issue', 'cancellation_request', 'other'],
    intentCtx,
  )
  cost.jevCalls += 1
  steps.push(
    step('jev', 'Interpreted intent', {
      distribution: intent.probabilities,
      confidence: intent.confidence,
      title: `Interpreted intent → ${intent.choice}`,
      detail: `confidence ${Math.round(intent.confidence * 100)}%`,
    }),
  )

  // ── 4. Route deterministically on the judgment ──────────────────────────
  const structuredFacts = [
    `customerName=${customer.name}`,
    `plan=${sub.plan}`,
    `subscriptionStatus=${sub.status}`,
    `nextBillingDate=${sub.nextBillingDate}`,
    `price=${money(sub.monthlyPrice)}`,
    `requestSnippet=${message.length > 60 ? `${message.slice(0, 60)}…` : message}`,
  ]

  switch (intent.choice) {
    case 'refund_request': {
      // Deterministic eligibility check — Jev never gates the money.
      const eligibility = checkRefundEligibility({ customer, duplicates, payments: pays, refunds })
      cost.deterministicOps += 1
      steps.push(
        step('deterministic', eligibility.eligible ? 'Checked refund eligibility — eligible' : 'Checked refund eligibility — not eligible', {
          detail: eligibility.reasons.join(' '),
          chips: [`max ${money(eligibility.maxRefund)}`],
        }),
      )

      if (!eligibility.eligible) {
        structuredFacts.push(`requested=${message.slice(0, 48)}`, `denialReason=${eligibility.reasons[0]}`)
        const explanation = await llm.generate({ task: 'refund_denied', structuredFacts, customerName: customer.name })
        cost.llmCalls += 1
        cost.llmTokens += explanation.tokens
        steps.push(step('llm', 'Generated explanation', { detail: `${explanation.tokens} tokens · why the refund cannot be auto-executed` }))
        steps.push(step('output', 'Response to customer'))
        return { mode: 'composed', steps, response: explanation.text, cost }
      }

      const duplicate = eligibility.duplicate!
      const flagged = customer.riskFlag
      const escalation = await jev.classify(
        'escalation',
        ['handle_automatically', 'review', 'escalate'],
        {
          message,
          customerName: customer.name,
          facts: [
            `overpayment ${money(eligibility.maxRefund)} verified`,
            flagged ? 'account_flagged=true' : 'account_flagged=false',
          ],
        },
      )
      cost.jevCalls += 1
      steps.push(
        step('jev', `Escalation judgment → ${escalation.choice}`, {
          distribution: escalation.probabilities,
          confidence: escalation.confidence,
          detail: `confidence ${Math.round(escalation.confidence * 100)}%`,
        }),
      )

      if (escalation.choice !== 'handle_automatically') {
        structuredFacts.push(`requested=${message.slice(0, 48)}`)
        const explanation = await llm.generate({ task: 'refund_review', structuredFacts, customerName: customer.name })
        cost.llmCalls += 1
        cost.llmTokens += explanation.tokens
        steps.push(step('llm', 'Generated explanation', { detail: `${explanation.tokens} tokens · routed to human review` }))
        steps.push(
          step('action', 'Flagged for human review', {
            detail: `No refund executed · specialist will reconcile ${money(eligibility.maxRefund)}`,
            chips: ['status: review'],
          }),
        )
        steps.push(step('output', 'Response to customer'))
        return {
          mode: 'composed', steps, response: explanation.text, cost,
          action: { type: 'flag_for_review', summary: `Refund of ${money(eligibility.maxRefund)} flagged for human review`, status: 'review' },
        }
      }

      const toRefund = eligibility.paymentsToRefund
      const refund = executeRefund({
        customer,
        paymentIds: toRefund.map((p) => p.id),
        amount: eligibility.refundAmount,
        reason: 'Duplicate billing — charged twice',
      })
      cost.deterministicOps += 1
      steps.push(
        step('action', 'Executed refund', {
          detail: `${refund.id} · ${money(refund.amount)} returned to ${toRefund.map((p) => p.cardLast4 ?? 'paypal').join(', ')}`,
          chips: ['status: completed'],
        }),
      )

      structuredFacts.push(
        `dupDescription=${money(duplicate.duplicatedAmount)} was drawn twice on ${duplicate.invoiceNumber}`,
        `refundAmount=${money(refund.amount)}`,
        `refundId=${refund.id}`,
        `refundStatus=${refund.status}`,
      )
      const explanation = await llm.generate({ task: 'refund_executed', structuredFacts, customerName: customer.name })
      cost.llmCalls += 1
      cost.llmTokens += explanation.tokens
      steps.push(step('llm', 'Generated explanation', { detail: `${explanation.tokens} tokens · composed from structured facts` }))
      steps.push(step('output', 'Response to customer'))
      return {
        mode: 'composed', steps, response: explanation.text, cost,
        action: { type: 'refund', id: refund.id, amount: refund.amount, summary: `${money(refund.amount)} refunded for duplicate billing`, status: refund.status },
      }
    }

    case 'billing_question': {
      const latest = invs[invs.length - 1]
      const previous = invs[invs.length - 2]
      const change = latest && previous ? latest.total - previous.total : 0
      structuredFacts.push(
        `invoiceTotal=${money(latest?.total ?? 0)}`,
        `lineItems=${latest?.lines.map((l) => l.description).join('; ') ?? '—'}`,
        `totalPaid=${money(totals.totalPaid)}`,
        `outstanding=${money(totals.outstanding)}`,
        `changeExplanation=${change > 0 ? `an increase of ${money(change)} from the previous cycle` : change < 0 ? `a decrease of ${money(-change)} from the previous cycle` : 'no change versus the previous cycle'}`,
      )
      const explanation = await llm.generate({ task: 'billing_explanation', structuredFacts, customerName: customer.name })
      cost.llmCalls += 1
      cost.llmTokens += explanation.tokens
      steps.push(step('llm', 'Generated explanation', { detail: `${explanation.tokens} tokens · composed from computed invoice facts` }))
      steps.push(step('output', 'Response to customer'))
      return { mode: 'composed', steps, response: explanation.text, cost }
    }

    case 'technical_issue': {
      structuredFacts.push(`issue=${message.slice(0, 48)}`)
      const explanation = await llm.generate({ task: 'technical_response', structuredFacts, customerName: customer.name })
      cost.llmCalls += 1
      cost.llmTokens += explanation.tokens
      steps.push(step('llm', 'Generated explanation', { detail: `${explanation.tokens} tokens` }))
      steps.push(step('output', 'Response to customer'))
      return { mode: 'composed', steps, response: explanation.text, cost }
    }

    case 'cancellation_request': {
      structuredFacts.push(
        `paidThrough=${sub.nextBillingDate}`,
      )
      const explanation = await llm.generate({ task: 'cancellation_response', structuredFacts, customerName: customer.name })
      cost.llmCalls += 1
      cost.llmTokens += explanation.tokens
      steps.push(step('llm', 'Generated explanation', { detail: `${explanation.tokens} tokens` }))
      steps.push(
        step('action', 'Awaiting confirmation', {
          detail: 'Cancellation not executed — pending explicit confirm from customer',
          chips: ['no action taken'],
        }),
      )
      steps.push(step('output', 'Response to customer'))
      return { mode: 'composed', steps, response: explanation.text, cost }
    }

    default: {
      const explanation = await llm.generate({ task: 'fallback', structuredFacts, customerName: customer.name })
      cost.llmCalls += 1
      cost.llmTokens += explanation.tokens
      steps.push(step('llm', 'Generated fallback response', { detail: `${explanation.tokens} tokens` }))
      steps.push(step('output', 'Response to customer'))
      return { mode: 'composed', steps, response: explanation.text, cost }
    }
  }
}