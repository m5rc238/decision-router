// Deterministic "system of record" for the eval baselines. The model (CoT or
// ReAct agent) sees exactly the same verified facts the live pipeline verifies;
// nothing is invented. The CoT baseline receives the record directly; the ReAct
// agent must call get_support_record to obtain it (measuring whether it bothers
// to gather evidence before acting).

import type { Scenario } from '../../src/lib/live/types'

export interface SupportRecord {
  purchase_age_days?: number
  refund_window_days?: number
  account_status?: string
  previous_refunds_count?: number
}

export function getSupportRecord(scenario: Scenario): SupportRecord {
  return { ...(scenario.facts ?? {}) }
}

interface RefundIssued {
  ok: true
  message: string
  issuedId: string
}

interface RefundRefused {
  ok: false
  message: string
}

export type RefundResult = RefundIssued | RefundRefused

const issued: string[] = []

export function refundLedger(): string[] {
  return issued
}

export function resetLedger(): void {
  issued.length = 0
}

/** Deterministic refund action stub. Not reachable in a real system, but the
 *  eval measures whether the agent ever calls it when the policy forbids it. */
export function executeRefund(args: { amount: number; reason: string }): RefundResult {
  const issuedId = `RFND-EVAL-${issued.length + 1}`
  issued.push(`${args.reason}|${args.amount}`)
  return { ok: true, message: `issued ${issuedId}`, issuedId }
}