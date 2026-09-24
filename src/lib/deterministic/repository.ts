// Deterministic layer 1: retrieval + calculations. Pure, rule-based, no LLM,
// no Jev, no side effects. Errors on unknown customers so the pipeline fails
// loudly rather than guessing.

import {
  customers,
  invoices,
  payments,
  refunds,
  subscriptions,
  type Invoice,
  type Payment,
} from '../../data/mockData'

export function getCustomer(input: string): { customer: (typeof customers)[number] } {
  const customer = customers.find(
    (c) => c.id === input || c.email.toLowerCase() === input.toLowerCase(),
  )
  if (!customer) throw new Error(`Unknown customer: ${input}`)
  return { customer }
}

export function getInvoices(customerId: string): Invoice[] {
  return invoices.filter((i) => i.customerId === customerId)
}

export function getPayments(customerId: string): Payment[] {
  return payments.filter((p) => p.customerId === customerId)
}

export function getRefunds(customerId: string) {
  return refunds.filter((r) => r.customerId === customerId)
}

export function getSubscription(customerId: string) {
  const sub = subscriptions.find((s) => s.customerId === customerId)
  if (!sub) throw new Error(`No subscription for ${customerId}`)
  return sub
}

export interface BillingTotals {
  totalBilled: number
  totalPaid: number
  outstanding: number
  paymentsCount: number
}

export function calculateTotals(customerId: string): BillingTotals {
  const invs = getInvoices(customerId)
  const pays = getPayments(customerId)
  const totalBilled = invs.reduce((sum, i) => sum + i.total, 0)
  const totalPaid = pays.reduce((sum, p) => sum + p.amount, 0)
  return { totalBilled, totalPaid, outstanding: totalBilled - totalPaid, paymentsCount: pays.length }
}

export function getSubscriptionStatus(customerId: string) {
  const sub = getSubscription(customerId)
  return { plan: sub.plan, status: sub.status, monthlyPrice: sub.monthlyPrice, nextBillingDate: sub.nextBillingDate }
}

export interface DuplicatePayment {
  invoiceId: string
  invoiceNumber: string
  invoiceTotal: number
  payments: Payment[]
  duplicatedAmount: number
  caughtAt: string
}

// Detects an overpayment: two payments on the same invoice whose combined
// total exceeds the invoice total. No semantic guessing — pure accounting.
export function detectDuplicatePayments(customerId: string): DuplicatePayment[] {
  const invs = getInvoices(customerId)
  const pays = getPayments(customerId)
  const duplicates: DuplicatePayment[] = []

  for (const inv of invs) {
    const onInvoice = pays.filter((p) => p.invoiceId === inv.id)
    const paid = onInvoice.reduce((s, p) => s + p.amount, 0)
    if (onInvoice.length > 1 && paid > inv.total) {
      duplicates.push({
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        invoiceTotal: inv.total,
        payments: onInvoice,
        duplicatedAmount: paid - inv.total,
        caughtAt: new Date(Math.max(...onInvoice.map((p) => Date.parse(p.paidAt)))).toISOString(),
      })
    }
  }
  return duplicates
}