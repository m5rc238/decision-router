// Deterministic layer 3: eligibility rules. Every rule is a pure function of
// already-retrieved data. Jev never runs these; Jev only judges intent and
// escalation semantics.

import type { Customer, Payment, Refund } from '../../data/mockData'
import type { DuplicatePayment } from './repository'

const REFUND_WINDOW_DAYS = 90
const REFUNDABLE_METHODS: Payment['method'][] = ['card']

export interface RefundEligibility {
  eligible: boolean
  maxRefund: number
  reasons: string[]
  duplicate?: DuplicatePayment
  paymentIds: string[]
  paymentsToRefund: Payment[]
  refundAmount: number
}

// Deterministically pick which payments to refund: newest-first, collecting a
// total that covers exactly the overpaid surplus. If the surplus matches whole
// payments, those are refunded in full; otherwise the last payment is refunded
// partially (a prorated refund is a legitimate, well-defined operation).
export function selectRefundPayments(duplicate: DuplicatePayment): { payments: Payment[]; amount: number } {
  const sorted = [...duplicate.payments].sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt))
  const chosen: Payment[] = []
  let acc = 0
  for (const p of sorted) {
    if (acc >= duplicate.duplicatedAmount) break
    chosen.push(p)
    acc += p.amount
  }
  return { payments: chosen, amount: duplicate.duplicatedAmount }
}

export function checkRefundEligibility(args: {
  customer: Customer
  duplicates: DuplicatePayment[]
  payments: Payment[]
  refunds: Refund[]
}): RefundEligibility {
  const { duplicates, refunds } = args
  const reasons: string[] = []

  if (duplicates.length === 0) {
    return {
      eligible: false,
      maxRefund: 0,
      paymentIds: [],
      paymentsToRefund: [],
      refundAmount: 0,
      reasons: ['No duplicate or overpayment found on any invoice.'],
    }
  }

  const dup = duplicates[0]
  const now = Date.now()

  // Rule: overpayment must fall inside the refund window.
  const withinWindow = Date.parse(dup.caughtAt) > now - REFUND_WINDOW_DAYS * 86_400_000
  reasons.push(withinWindow ? 'Overpayment is inside the 90-day refund window.' : 'Overpayment is outside the 90-day refund window.')

  // Rule: refundable payment method.
  const refundable = dup.payments.every((p) => REFUNDABLE_METHODS.includes(p.method))
  reasons.push(refundable ? 'All duplicated payments were made by card (refundable).' : 'A duplicated payment used a non-refundable method.')

  // Rule: no refund already issued against those payments (idempotency).
  const alreadyRefunded = dup.payments.some((p) => refunds.some((r) => r.paymentIds.includes(p.id)))
  reasons.push(alreadyRefunded ? 'A refund already exists for one of these payments.' : 'No prior refund on record for these payments.')

  const eligible = withinWindow && refundable && !alreadyRefunded
  const selection = eligible ? selectRefundPayments(dup) : { payments: [], amount: 0 }
  return {
    eligible,
    maxRefund: selection.amount,
    duplicate: dup,
    paymentIds: dup.payments.map((p) => p.id),
    paymentsToRefund: selection.payments,
    refundAmount: selection.amount,
    reasons,
  }
}