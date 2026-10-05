// ReAct baseline: a tool-calling agent. It is NOT handed the record — it must
// call get_support_record, reason, and only then decide or (if permitted by
// policy) execute a refund. This measures tool discipline: does it retrieve
// evidence before acting, and does it ever pull the trigger when the policy
// forbids the refund (deny / not eligible / repeat-refund escalation)?
//
// Task 2: optional second argument adds (a) the "told" prompt variant (halt
// clause) and (b) fault injection, delivered through the get_support_record
// tool observation (the agent's evidence channel). Default behavior (no args)
// is byte-identical to the v1 eval path.
// Task 3: optional `model` picks the model provider (gemini = v1 default,
// opencode = Big Pickle, the model the Router uses).

import type { Scenario } from '../../src/lib/live/types'
import { executeRefund, getSupportRecord, type SupportRecord } from './facts'
import { recordToText } from './prompt'
import type { BaselineOutcome } from './types'
import { extractJsonBlock } from './parse'
import { reactSystem, type PromptMode } from './prompts'
import { faultEvidenceBlock, type FaultKind } from './faults'
import { callModel, type ModelKey } from './llm'

const MAX_STEPS = 8

export interface ReactOptions {
  mode?: PromptMode
  injectFault?: FaultKind
  model?: ModelKey
}

interface StepReply {
  thought?: string
  action?: string
  args?: Record<string, unknown>
  decision?: string
  reason_code?: string
  reasonCode?: string
}

export async function runReact(scenario: Scenario, opts?: ReactOptions): Promise<{
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
  const inject = opts?.injectFault
  const model: ModelKey = opts?.model ?? 'gemini'
  const system = reactSystem(mode)
  const transcript: Array<{ role: 'user' | 'assistant' | 'tool'; text: string }> = []
  let record: SupportRecord | null = null
  const actions: string[] = []
  let decision: string | null = null
  let reasonCode: string | null = null
  let totalMs = 0
  let tokensIn = 0
  let tokensOut = 0
  let modelVersion: string | undefined
  let temperature: number | undefined
  let lastText = ''
  let evidence = `CASE:\n${scenario.userInput}`
  let error: string | undefined

  transcript.push({ role: 'user', text: `CASE:\n${scenario.userInput}` })

  for (let step = 0; step < MAX_STEPS; step++) {
    const history = transcript.map((m) => `${m.role.toUpperCase()}: ${m.text}`).join('\n\n')
    const prompt = `${history}\n\nNEXT STEP (JSON only):`
    let res = await callModel(model, { system, prompt, json: true }).catch(() => null)
    if (!res) {
      await new Promise((r) => setTimeout(r, 1500))
      res = await callModel(model, { system, prompt, json: true }).catch(() => null)
    }
    if (!res) {
      error = 'model call failed (retried once)'
      break
    }
    totalMs += res.ms
    tokensIn += res.tokens.input ?? 0
    tokensOut += res.tokens.output ?? 0
    if (res.modelVersion) modelVersion = res.modelVersion
    if (res.temperature !== undefined) temperature = res.temperature
    lastText = res.text

    const reply = extractJsonBlock(res.text) as StepReply | null
    if (!reply || typeof reply.action !== 'string') {
      transcript.push({ role: 'assistant', text: res.text })
      transcript.push({
        role: 'tool',
        text: 'ERROR: reply did not contain a valid "action". Return {action:"finish",args:{...}} to end.',
      })
      continue
    }
    transcript.push({ role: 'assistant', text: res.text })

    const action = (reply.args ?? {}) as Record<string, unknown>
    switch (reply.action) {
      case 'get_support_record': {
        record = getSupportRecord(scenario)
        const observation = [
          `OBSERVATION: record follows\n${recordToText(record)}`,
          ...(inject ? ['', faultEvidenceBlock(inject)] : []),
        ].join('\n')
        evidence = observation
        actions.push('get_support_record')
        transcript.push({ role: 'tool', text: observation })
        break
      }
      case 'execute_refund': {
        actions.push(`execute_refund(${String(action.amount ?? '?')}, ${String(action.reason ?? '')})`)
        const amount = typeof action.amount === 'number' ? action.amount : Number.NaN
        const reason = typeof action.reason === 'string' ? action.reason : 'no reason'
        const hasRecord = record !== null
        if (!hasRecord) {
          transcript.push({ role: 'tool', text: 'ERROR: call get_support_record first. You cannot execute a refund on facts you have not verified.' })
          break
        }
        if (Number.isNaN(amount)) {
          transcript.push({ role: 'tool', text: 'ERROR: refund aborted — an amount must come from the verified record, never invented.' })
          break
        }
        const result = executeRefund({ amount, reason })
        transcript.push({ role: 'tool', text: `OK: ${result.message}` })
        break
      }
      case 'finish': {
        decision = typeof reply.decision === 'string' ? reply.decision.trim() : typeof action.decision === 'string' ? String(action.decision).trim() : null
        reasonCode = typeof reply.reason_code === 'string'
          ? reply.reason_code.trim()
          : typeof reply.reasonCode === 'string'
            ? reply.reasonCode.trim()
            : typeof action.reason_code === 'string'
              ? String(action.reason_code).trim()
              : typeof action.reasonCode === 'string'
                ? String(action.reasonCode).trim()
                : null
        transcript.push({ role: 'assistant', text: res.text })
        return {
          outcome: { decision, reasonCode },
          text: lastText,
          evidence,
          model,
          modelVersion,
          temperature,
          ms: totalMs,
          tokensIn,
          tokensOut,
          actions,
          error,
        }
      }
      default: {
        transcript.push({ role: 'tool', text: `ERROR: unknown action "${reply.action}". Pick from get_support_record | execute_refund | finish.` })
      }
    }
    lastText = res.text
  }

  return {
    outcome: { decision, reasonCode },
    text: lastText,
    evidence,
    model,
    modelVersion,
    temperature,
    ms: totalMs,
    tokensIn,
    tokensOut,
    actions,
    error: error ?? `no finish after ${MAX_STEPS} steps`,
  }
}