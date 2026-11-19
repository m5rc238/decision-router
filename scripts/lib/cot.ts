// CoT baseline: one call, structured-output JSON. The record is handed over
// directly (no tool layer), so the ONLY thing separating it from the router is
// judgment discipline: it decides on the same evidence, with no pipeline, no
// guardrails and no separate verification stage.
//
// Task 2: optional second argument adds (a) the "told" prompt variant (halt
// clause) and (b) fault injection — the same downstream-service fault payloads
// the router exercises, appended to the evidence channel. Default behavior
// (no args) is byte-identical to the v1 eval path.
// Task 3: optional `model` picks the model provider (gemini = v1 default,
// opencode = Big Pickle, the model the Router uses).

import type { Scenario } from '../../src/lib/live/types'
import { getSupportRecord } from './facts'
import { recordToText } from './prompt'
import type { BaselineOutcome } from './types'
import { extractJsonBlock } from './parse'
import { directLlmSystem, type PromptMode } from './prompts'
import { faultEvidenceBlock, type FaultKind } from './faults'
import { callModel, type ModelKey } from './llm'

export interface CoTOptions {
  mode?: PromptMode
  injectFault?: FaultKind
  customEvidenceBlock?: string
  model?: ModelKey
}

/** The exact prompt text (evidence) a Direct-LLM arm receives. */
export function buildDirectPrompt(
  scenario: Scenario,
  opts?: { injectFault?: FaultKind; customEvidenceBlock?: string },
): string {
  const inject = opts?.injectFault
  const custom = opts?.customEvidenceBlock
  const record = getSupportRecord(scenario)
  return [
    'CASE:',
    scenario.userInput,
    '',
    'VERIFIED SUPPORT RECORD (the only source of truth):',
    recordToText(record),
    ...(custom ? ['', custom] : inject ? ['', faultEvidenceBlock(inject)] : []),
    '',
    'Render your judgement on this case.',
  ].join('\n')
}

async function parseOutcome(text: string): Promise<{ outcome: BaselineOutcome; draftResponse: string | null }> {
  const data = (await Promise.resolve(extractJsonBlock(text))) as
    | { decision?: string; reason_code?: string; reasonCode?: string; email?: string; rationale?: string }
    | null
  if (!data) return { outcome: { decision: null, reasonCode: null }, draftResponse: null }
  const decision = typeof data.decision === 'string' ? data.decision.trim() : null
  const reasonCode = typeof data.reason_code === 'string'
    ? data.reason_code.trim()
    : typeof data.reasonCode === 'string'
      ? data.reasonCode.trim()
      : null
  const draftResponse = typeof data.email === 'string'
    ? data.email.trim()
    : typeof data.rationale === 'string'
      ? data.rationale.trim()
      : null
  return { outcome: { decision, reasonCode }, draftResponse }
}

export async function runCoT(scenario: Scenario, opts?: CoTOptions): Promise<{
  outcome: BaselineOutcome
  draftResponse?: string | null
  text: string
  evidence: string
  model?: ModelKey
  modelVersion?: string
  temperature?: number
  ms: number
  tokensIn: number
  tokensOut: number
  actions: string[]
  error?: string
}> {
  const mode: PromptMode = opts?.mode ?? 'not-told'
  const model: ModelKey = opts?.model ?? 'gemini'
  const inject = opts?.injectFault
  const customEvidenceBlock = opts?.customEvidenceBlock
  const evidence = buildDirectPrompt(scenario, { injectFault: inject, customEvidenceBlock })
  try {
    const res = await callModel(model, { system: directLlmSystem(mode), prompt: evidence, json: true })
    const parsed = await parseOutcome(res.text)
    return {
      outcome: parsed.outcome,
      draftResponse: parsed.draftResponse,
      text: res.text,
      evidence,
      model,
      modelVersion: res.modelVersion,
      temperature: res.temperature,
      ms: res.ms,
      tokensIn: res.tokens.input ?? 0,
      tokensOut: res.tokens.output ?? 0,
      actions: [],
    }
  } catch (err) {
    return {
      outcome: { decision: null, reasonCode: null },
      draftResponse: null,
      text: '',
      evidence,
      model,
      ms: 0,
      tokensIn: 0,
      tokensOut: 0,
      actions: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}