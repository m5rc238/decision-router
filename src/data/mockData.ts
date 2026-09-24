// Local mock data for a fake customer-support/billing system.
// No database — this module is the entire persistence layer for the demo.

export interface Customer {
  id: string
  name: string
  email: string
  tier: string
  riskFlag: boolean
  signupDate: string
}

export interface Subscription {
  id: string
  customerId: string
  plan: string
  monthlyPrice: number
  status: 'active' | 'past_due' | 'canceled'
  nextBillingDate: string
}

export interface InvoiceLine {
  description: string
  amount: number
}

export interface Invoice {
  id: string
  customerId: string
  number: string
  issuedAt: string
  dueAt: string
  status: 'paid' | 'open' | 'void'
  lines: InvoiceLine[]
  total: number
}

export type PaymentMethod = 'card' | 'paypal'

export interface Payment {
  id: string
  invoiceId: string
  customerId: string
  amount: number
  method: PaymentMethod
  cardLast4?: string
  paidAt: string
}

export interface Refund {
  id: string
  paymentIds: string[]
  customerId: string
  amount: number
  reason: string
  issuedAt: string
  status: 'completed' | 'pending'
}

export const customers: Customer[] = [
  { id: 'CUST-1001', name: 'Alice Chen', email: 'alice@acme.test', tier: 'core', riskFlag: false, signupDate: '2025-11-02' },
  { id: 'CUST-1002', name: 'Bob Alvarez', email: 'bob@acme.test', tier: 'core', riskFlag: false, signupDate: '2025-08-19' },
  { id: 'CUST-1003', name: 'Dana Lee', email: 'dana@acme.test', tier: 'pro', riskFlag: true, signupDate: '2025-01-13' },
]

export const subscriptions: Subscription[] = [
  { id: 'SUB-3001', customerId: 'CUST-1001', plan: 'core', monthlyPrice: 49, status: 'active', nextBillingDate: '2026-10-01' },
  { id: 'SUB-3002', customerId: 'CUST-1002', plan: 'core', monthlyPrice: 79, status: 'active', nextBillingDate: '2026-10-03' },
  { id: 'SUB-3003', customerId: 'CUST-1003', plan: 'pro', monthlyPrice: 129, status: 'active', nextBillingDate: '2026-10-15' },
]

// Alice: INV-2034 was paid twice (PAY-9102 + PAY-9103, same amount, 2 min
// apart) -> detectable duplicate. This is the "charged twice" demo.
// Dana: INV-4002 also double-paid (PAY-9401 + PAY-9402) and her account is
// risk-flagged, which drives the "review" escalation path.
export const invoices: Invoice[] = [
  {
    id: 'INV-1001', customerId: 'CUST-1001', number: '2026-06-1001',
    issuedAt: '2026-06-01', dueAt: '2026-06-15', status: 'paid',
    lines: [{ description: 'Monthly — core plan', amount: 49 }], total: 49,
  },
  {
    id: 'INV-2034', customerId: 'CUST-1001', number: '2026-09-2034',
    issuedAt: '2026-09-02', dueAt: '2026-09-16', status: 'paid',
    lines: [{ description: 'Monthly — core plan', amount: 49 }], total: 49,
  },
  {
    id: 'INV-2100', customerId: 'CUST-1001', number: '2026-08-2100',
    issuedAt: '2026-08-01', dueAt: '2026-08-15', status: 'open',
    lines: [{ description: 'Monthly — core plan', amount: 49 }], total: 49,
  },
  {
    id: 'INV-3002', customerId: 'CUST-1002', number: '2026-05-3002',
    issuedAt: '2026-05-03', dueAt: '2026-05-17', status: 'paid',
    lines: [{ description: 'Monthly — core plan', amount: 69 }], total: 69,
  },
  {
    id: 'INV-3003', customerId: 'CUST-1002', number: '2026-06-3003',
    issuedAt: '2026-06-03', dueAt: '2026-06-17', status: 'paid',
    lines: [
      { description: 'Monthly — core plan', amount: 69 },
      { description: 'Plan upgrade proration (Jun 3)', amount: 10 },
    ], total: 79,
  },
  {
    id: 'INV-4001', customerId: 'CUST-1003', number: '2026-08-4001',
    issuedAt: '2026-08-15', dueAt: '2026-08-29', status: 'paid',
    lines: [{ description: 'Monthly — pro plan', amount: 129 }], total: 129,
  },
  {
    id: 'INV-4002', customerId: 'CUST-1003', number: '2026-09-4002',
    issuedAt: '2026-09-05', dueAt: '2026-09-19', status: 'paid',
    lines: [{ description: 'Monthly — pro plan', amount: 129 }], total: 129,
  },
]

export const payments: Payment[] = [
  { id: 'PAY-9001', invoiceId: 'INV-1001', customerId: 'CUST-1001', amount: 49, method: 'card', cardLast4: '4281', paidAt: '2026-06-01T09:00:00Z' },
  { id: 'PAY-9102', invoiceId: 'INV-2034', customerId: 'CUST-1001', amount: 49, method: 'card', cardLast4: '4281', paidAt: '2026-09-02T09:12:00Z' },
  { id: 'PAY-9103', invoiceId: 'INV-2034', customerId: 'CUST-1001', amount: 49, method: 'card', cardLast4: '4281', paidAt: '2026-09-02T09:14:00Z' },
  { id: 'PAY-9250', invoiceId: 'INV-3002', customerId: 'CUST-1002', amount: 69, method: 'card', cardLast4: '7731', paidAt: '2026-05-03T08:00:00Z' },
  { id: 'PAY-9260', invoiceId: 'INV-3003', customerId: 'CUST-1002', amount: 79, method: 'card', cardLast4: '7731', paidAt: '2026-06-03T08:01:00Z' },
  { id: 'PAY-9400', invoiceId: 'INV-4001', customerId: 'CUST-1003', amount: 129, method: 'card', cardLast4: '8812', paidAt: '2026-08-15T10:30:00Z' },
  { id: 'PAY-9401', invoiceId: 'INV-4002', customerId: 'CUST-1003', amount: 129, method: 'card', cardLast4: '8812', paidAt: '2026-09-05T10:20:00Z' },
  { id: 'PAY-9402', invoiceId: 'INV-4002', customerId: 'CUST-1003', amount: 129, method: 'card', cardLast4: '8812', paidAt: '2026-09-05T10:22:00Z' },
]

export const refunds: Refund[] = [
  { id: 'RFND-4001', paymentIds: ['PAY-9001'], customerId: 'CUST-1001', amount: 20, reason: 'Adjustment', issuedAt: '2026-06-05', status: 'completed' },
  { id: 'RFND-4002', paymentIds: ['PAY-9250'], customerId: 'CUST-1002', amount: 10, reason: 'Downgrade proration', issuedAt: '2026-06-06', status: 'completed' },
]