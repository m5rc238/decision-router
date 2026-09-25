// CoT baseline: one call, structured-output JSON. The record is handed over
// directly (no tool layer), so the ONLY thing separating it from the router is
// judgment discipline: it decides on the same evidence, with no pipeline, no
// guardrails and no separate verification stage.

import type { Scenario } from '../../src/lib/live/types'
import { callGemini } from './gemini'
import { getSupportRecord } from './facts'
import { policyRules, decisionSpace, recordToText } from './prompt'
import type { BaselineOutcome } from './types'
import { extractJsonBlock } from './parse'

const SYSTEM = [
  'You are a support decision assistant rendering a judgement on one case.',
  policyRules(),
  decisionSpace(),
  'Respond with ONLY a JSON object and nothing else:',
  '{ "decision": "...", "reason_code": "...", "confidence": 0.0, "rationale": "one sentence" }',
].join('\n\n')

async function parseOutcome(text: string): Promise<BaselineOutcome> {
  const data = (await Promise.resolve(extractJsonBlock(text))) as
    | { decision?: string; reason_code?: string; reasonCode?: string }
    | null
  if (!data) return { decision: null, reasonCode: null }
  const decision = typeof data.decision === 'string' ? data.decision.trim() : null
  const reasonCode = typeof data.reason_code === 'string'
    ? data.reason_code.trim()
    : typeof data.reasonCode === 'string'
      ? data.reasonCode.trim()
      : null
  return { decision, reasonCode }
}

export async function runCoT(scenario: Scenario): Promise<{
  outcome: BaselineOutcome
  text: string
  ms: number
  tokensIn: number
  tokensOut: number
  actions: string[]
  error?: string
}> {
  const record = getSupportRecord(scenario)
  const prompt = [
    'CASE:',
    scenario.userInput,
    '',
    'VERIFIED SUPPORT RECORD (the only source of truth):',
    recordToText(record),
    '',
    'Render your judgement on this case.',
  ].join('\n')
  try {
    const res = await callGemini({ system: SYSTEM, prompt, json: true })
    return {
      outcome: await parseOutcome(res.text),
      text: res.text,
      ms: res.ms,
      tokensIn: res.tokens.input ?? 0,
      tokensOut: res.tokens.output ?? 0,
      actions: [],
    }
  } catch (err) {
    return {
      outcome: { decision: null, reasonCode: null },
      text: '',
      ms: 0,
      tokensIn: 0,
      tokensOut: 0,
      actions: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}