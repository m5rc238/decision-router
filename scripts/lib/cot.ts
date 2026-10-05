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
  model?: ModelKey
}

/** The exact prompt text (evidence) a Direct-LLM arm receives. */
export function buildDirectPrompt(scenario: Scenario, opts?: { injectFault?: FaultKind }): string {
  const inject = opts?.injectFault
  const record = getSupportRecord(scenario)
  return [
    'CASE:',
    scenario.userInput,
    '',
    'VERIFIED SUPPORT RECORD (the only source of truth):',
    recordToText(record),
    ...(inject ? ['', faultEvidenceBlock(inject)] : []),
    '',
    'Render your judgement on this case.',
  ].join('\n')
}

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

export async function runCoT(scenario: Scenario, opts?: CoTOptions): Promise<{
  outcome: BaselineOutcome
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
  const evidence = buildDirectPrompt(scenario, { injectFault: inject })
  try {
    const res = await callModel(model, { system: directLlmSystem(mode), prompt: evidence, json: true })
    return {
      outcome: await parseOutcome(res.text),
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