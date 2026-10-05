// Model dispatcher for the baseline arms (Task 3).
//
// The benchmark measures ARCHITECTURE, but v1 ran every baseline on Gemini
// while the Router used Big Pickle — conflating model and architecture. This
// module lets each baseline arm run on either the Gemini flash-lite model OR
// the exact model+runtime the Router uses (Big Pickle via OpenCode), so the
// same architecture can be measured on both models.
//
// Important asymmetry (reported, not hidden):
//   - Gemini supports responseMimeType: application/json → structured output
//     is enforced by the API.
//   - Big Pickle (OpenCode agent runtime) does NOT: JSON conformance is enforced
//     only by prompt text. This is the same constraint the Router itself
//     operates under, so using it for the baseline's Big-Pickle arm is the fair
//     comparison — it makes model a controlled variable, not a hidden one.

import type { GeminiTokens, GeminiResult } from './gemini'

export type ModelKey = 'gemini' | 'opencode'

export interface ModelCallResult {
  text: string
  ms: number
  modelID?: string
  providerID?: string
  finish?: string
  /** Reported model version (Gemini returns modelVersion; OpenCode info.modelID). */
  modelVersion?: string
  /** Temperature actually sent (Task 4: recorded per run). */
  temperature?: number
  tokens: {
    input?: number
    output?: number
    total?: number
    cacheRead?: number
    cacheWrite?: number
  }
}

export interface ModelCallOptions {
  system?: string
  prompt: string
  json?: boolean
  maxOutputTokens?: number
  retries?: number
}

export async function callModel(model: ModelKey, opts: ModelCallOptions): Promise<ModelCallResult> {
  if (model === 'opencode') {
    const { callOpenCode } = await import('./opencode')
    const { text, ms, modelID, providerID, finish, modelVersion, tokens } = await callOpenCode({
      prompt: [opts.system, opts.prompt].filter(Boolean).join('\n\n'),
      retries: opts.retries,
    })
    return { text, ms, modelID, providerID, finish, modelVersion, tokens }
  }

  const { callGemini } = await import('./gemini')
  const res: GeminiResult = await callGemini({
    system: opts.system,
    prompt: opts.prompt,
    json: opts.json,
    maxOutputTokens: opts.maxOutputTokens,
    retries: opts.retries,
  })
  const t = res.tokens as GeminiTokens & { total?: number; cacheRead?: number }
  return {
    text: res.text,
    ms: res.ms,
    modelID: process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest',
    providerID: 'google',
    modelVersion: res.modelVersion,
    temperature: res.temperature,
    tokens: {
      input: t.input,
      output: t.output,
      total: t.total,
      cacheRead: t.cacheRead,
    },
  }
}

export const MODEL_LABEL: Record<ModelKey, string> = {
  gemini: 'Gemini flash-lite',
  opencode: 'Big Pickle (OpenCode)',
}