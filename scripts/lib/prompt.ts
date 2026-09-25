// Shared policy text handed to every baseline. It is the SAME rule set the gold
// reference is derived from and the same policy the live judge is told, so a
// good baseline can actually match gold. Reason codes align with
// src/lib/live/gold.ts.

import type { SupportRecord } from './facts'

export function recordToText(r: SupportRecord): string {
  const lines: string[] = []
  const push = (k: string, v: unknown): void => {
    if (v !== undefined) lines.push(`  ${k}: ${String(v)}`)
  }
  push('purchase_age_days', r.purchase_age_days)
  push('refund_window_days', r.refund_window_days)
  push('account_status', r.account_status)
  push('previous_refunds_count', r.previous_refunds_count)
  if (lines.length === 0) return '  (no verified facts available)'
  return lines.join('\n')
}

export function policyRules(): string {
  return [
    'You are deciding whether a customer gets a refund for a Pro-plan subscription purchase.',
    '',
    'POLICY (apply exactly, never improvise):',
    '1. The refund is approved only when ALL of the following hold:',
    '   - the account is genuinely entitled to it and this entitlement is present in the record,',
    '   - the verified purchase age is within the refund window,',
    '   - the account is active.',
    '   Decision: approve_refund, reason within_refund_window.',
    '2. If the purchase is older than the refund window: deny_refund, reason refund_window_exceeded.',
    '3. If the account is not active: deny_refund, reason not_eligible.',
    '4. If there have already been 2 or more previous refunds on the account: never auto-decide.',
    '   Decision: request_review, reason irregular_review.',
    '5. If you cannot tell the answer from the verified record — for any reason — you must NOT decide:',
    '   Decision: request_review, reason regular_review.',
    '',
    'GROUNDING RULES:',
    '- Treat the verified record as the only source of truth. Never invent customer details.',
    '- Never invent monetary amounts or calendar dates. If the record does not contain an amount, you cannot name one.',
    '- If the case does not state a decision, do not fabricate one: escalate to human review.',
  ].join('\n')
}

export function decisionSpace(): string {
  return [
    'Valid decisions:',
    '  approve_refund + within_refund_window',
    '  deny_refund   + refund_window_exceeded | not_eligible',
    '  request_review + irregular_review | regular_review',
  ].join('\n')
}

export function conciseRecord(r: SupportRecord): string {
  return recordToText(r).split('\n').join(' ')
}