// Deterministic layer 5: actions. Executes a mock refund and mutates the
// in-memory store. This is the ONLY place the store is written during a run.

import { payments, refunds, type Customer, type Payment, type Refund } from '../../data/mockData'

// Cursor for human-looking refund ids.
let refundSeq = 4003

export function executeRefund(args: {
  customer: Customer
  paymentIds: string[]
  amount: number
  reason: string
}): Refund {
  const { customer, paymentIds, amount, reason } = args

  const refund: Refund = {
    id: `RFND-${String(refundSeq++).padStart(4, '0')}`,
    paymentIds,
    customerId: customer.id,
    amount,
    reason,
    issuedAt: new Date().toISOString(),
    status: 'completed',
  }
  refunds.push(refund)
  updateAccountState(customer.id, { refundsTotal: amount, note: reason })
  return refund
}

export interface AccountState {
  refundsTotal: number
  note?: string
}

// In-memory account ledger, keyed by customer.
const accountLedger = new Map<string, AccountState>()

export function getAccountState(customerId: string): AccountState {
  return accountLedger.get(customerId) ?? { refundsTotal: 0 }
}

export function updateAccountState(customerId: string, delta: Partial<AccountState>): AccountState {
  const current = getAccountState(customerId)
  const next: AccountState = { ...current, ...delta }
  accountLedger.set(customerId, next)
  return next
}

export function paymentById(id: string): Payment | undefined {
  return payments.find((p) => p.id === id)
}

// Restore a clean demo slate so re-running an example behaves identically
// (eligibility rules are idempotent — a second refund on the same payment is
// correctly denied, so we let you reset to observe the first-run path again).
const originalRefunds = [...refunds]
export function resetDemoState(): void {
  refunds.splice(0, refunds.length, ...originalRefunds)
  refundSeq = 4003
  accountLedger.clear()
}