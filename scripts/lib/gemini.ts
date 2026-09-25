// Minimal Gemini REST client for the eval baselines.
// Reads GEMINI_API_KEY / GEMINI_MODEL from process.env (loaded by the eval
// script from .env.local). No SDK dependency — plain fetch, JSON in/out.

export interface GeminiTokens {
  input?: number
  output?: number
}

export interface GeminiResult {
  text: string
  ms: number
  tokens: GeminiTokens
}

export class GeminiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

const API = 'https://generativelanguage.googleapis.com/v1beta/models'

const RETRY_STATUS = new Set([429, 500, 503])

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest'
}

export async function callGemini(opts: {
  system?: string
  prompt: string
  json?: boolean
  maxOutputTokens?: number
  retries?: number
}): Promise<GeminiResult> {
  const { system, prompt, json = false, maxOutputTokens = 2048, retries = 15 } = opts
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new GeminiError('GEMINI_API_KEY is not set (put it in .env.local). The baselines never fake a model.', 401)
  const model = geminiModel()
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
  }
  if (system) body.system_instruction = { parts: [{ text: system }] }

  let waited = 0
  const maxWait = Number(process.env.GEMINI_MAX_WAIT_MS ?? 150_000)
  for (let attempt = 0; ; attempt++) {
    const started = Date.now()
    let res: Response
    try {
      res = await fetch(`${API}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (err) {
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt)
        continue
      }
      throw new GeminiError(`Gemini network error: ${err instanceof Error ? err.message : String(err)}`)
    }
    const text = await res.text()
    const ms = Date.now() - started
    let data: Record<string, unknown> | null = null
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      data = null
    }
    if (!res.ok) {
      const alt = (data?.error as { message?: string } | undefined)?.message ?? ''
      const hint = alt.match(/Please retry in\s+(\d+(?:\.\d+)?)s?/) ?? alt.match(/retry in\s+(\d+(?:\.\d+)?)s?/)
      const backoff = hint ? Number(hint[1]) * 1000 + 1500 : 1000 * 2 ** attempt
      const throttled = res.status === 429 || /quota|rate[\s_-]?limit/i.test(alt)
      if (attempt < retries && (retryable(res.status) || throttled || /high demand/i.test(alt))) {
        if (waited + backoff > maxWait) {
          throw new GeminiError(`${model} throttled (waited ${(waited / 1000).toFixed(0)}s): ${alt.trim().split('\n')[0]}. Lower call volume or use GEMINI_MODEL/GEMINI_MAX_WAIT_MS.`, 429)
        }
        waited += backoff
        if (backoff > 5000) process.stderr.write(`  gemini ${model}: quota — retrying in ${(backoff / 1000).toFixed(1)}s (waited ${(waited / 1000).toFixed(0)}s)\n`)
        await sleep(backoff)
        continue
      }
      throw new GeminiError(alt || `${model} returned HTTP ${res.status}`, res.status)
    }
    const candidates = data?.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined
    const textOut = candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    const usage = data?.usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number }
      | undefined
    return {
      text: textOut,
      ms,
      tokens: { input: usage?.promptTokenCount, output: usage?.candidatesTokenCount },
    }
  }
}

function retryable(status: number): boolean {
  return RETRY_STATUS.has(status) || status >= 500
}