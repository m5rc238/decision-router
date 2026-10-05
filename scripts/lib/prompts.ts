// System prompts for the monolithic baselines. Two conditions:
//   - not-told = the ORIGINAL v1 prompt (no "halt" option). Reproduces exactly
//     what scripts/lib/cot.ts and scripts/lib/react.ts sent before Task 2.
//   - told     = v1 plus ONE addition: the halt clause, word-for-word identical
//     across both arms (see prompts/*.txt for the archived snapshots).
// The additions are pure appends to the shared text so the told-vs-not-told
// comparison isolates the halt instruction.
//
// policyRules()/decisionSpace() come from ./prompt.ts (unchanged, shared with
// the live pipelines and the gold reference).

import { policyRules, decisionSpace } from './prompt'

export const HALT_CLAUSE =
  'If the input is corrupt, incomplete, or the intent is ambiguous, output halt instead of a decision.'

export type PromptMode = 'not-told' | 'told'

// The original v1 prompt joined policyRules() and decisionSpace() with a
// single blank line for the CoT arm and a single '\n' for the ReAct arm. Keep
// the exact join per arm so the not-told conditions are byte-identical to the
// pre-Task-2 prompts.

function policyBlock(arm: 'cot' | 'react'): string {
  const sep = arm === 'cot' ? '\n\n' : '\n'
  return [policyRules(), decisionSpace()].join(sep)
}

// --- Direct-LLM (CoT + JSON) ---------------------------------------------

export function directLlmSystem(mode: PromptMode): string {
  const lines = [
    'You are a support decision assistant rendering a judgement on one case.',
    policyBlock('cot'),
  ]
  if (mode === 'told') {
    lines.push(
      HALT_CLAUSE,
      'Valid "halt" decisions:',
      '  halt + halt_reason: system_error | incomplete_input | ambiguous_input',
    )
  }
  lines.push(
    'Respond with ONLY a JSON object and nothing else:',
    '{ "decision": "...", "reason_code": "...", "confidence": 0.0, "rationale": "one sentence" }',
  )
  return lines.join('\n\n')
}

// --- ReAct (tool-calling agent) ------------------------------------------

export function reactSystem(mode: PromptMode): string {
  const lines = [
    'You are a support agent. Every reply is EXACTLY ONE JSON tool call — never prose, never a case summary, never analysis.',
    policyBlock('react'),
  ]
  if (mode === 'told') {
    lines.push(
      HALT_CLAUSE,
      'To halt, finish with decision "halt" and reason_code "system_error" | "incomplete_input" | "ambiguous_input".',
    )
  }
  lines.push(
    '',
    'Reply format (one object only):',
    '{"thought":"brief reason","action":"get_support_record|execute_refund|finish","args":{}}',
    '',
    '  get_support_record  args {}                          → returns the verified support record.',
    '  execute_refund      args {"amount":N,"reason":"..."} → ALWAYS invalid unless the approved amount',
    '                                                         appears verbatim in the record.',
    '  finish              args {}                          → final, with the decision in top-level keys:',
    '      {"thought":"...","action":"finish","decision":"approve_refund|deny_refund|request_review","reason_code":"..."}',
    '',
    'DECIDE FROM POLICY: apply the REFUND POLICY to the record and finish. Routine within-window refunds',
    'are approve_refund (with reason within_refund_window) — escalation is ONLY for policy-specified review',
    'cases (irregular_review) or an indeterminate record (regular_review). Never stall with request_review',
    'when the policy clearly approves or denies.',
  )
  return lines.join('\n')
}