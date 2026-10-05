// Minimal OpenCode HTTP client for the eval baselines — the SAME channel the
// live Decision Router uses for its LLM stages (/api/live/llm →
// opencodeComplete in server/live.ts). Running the baselines through this
// client puts them on the exact model+runtime (Big Pickle) the Router uses, so
// architecture and model stop being conflated (Task 3).
//
// Notes for honest reporting:
// - OpenCode is an agent runtime: it carries its own system prompt + tools, and
//   it does NOT support responseMimeType structured output. JSON compliance is
//   enforced only by the prompt text — different from the Gemini arm, which can
//   force application/json mime. This asymmetry is reported, not hidden.
// - Token counts come from the runtime's usage info (info.tokens): a cold
//   session carries the full agent context (~22k tokens) regardless of request
//   size, so token numbers are not comparable to Gemini's raw prompt counts.

import { loadEnvLocal } from './env'
import type { ModelCallResult } from './llm'

loadEnvLocal()

const DEFAULT_URL = 'http://localhost:63445'
const DEFAULT_TIMEOUT_MS = 240_000

interface OpenCodeConfig {
  url: string
  username: string
  password: string
  modelID: string
  providerID: string
}

function config(): OpenCodeConfig {
  return {
    url: process.env.OPENCODE_SERVER_URL ?? DEFAULT_URL,
    username: process.env.OPENCODE_SERVER_USERNAME ?? 'opencode',
    password: process.env.OPENCODE_SERVER_PASSWORD ?? '',
    modelID: process.env.OPENCODE_MODEL_ID ?? 'big-pickle',
    providerID: process.env.OPENCODE_PROVIDER_ID ?? 'opencode',
  }
}

export class OpenCodeError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function basicAuth(c: OpenCodeConfig): string {
  return 'Basic ' + Buffer.from(`${c.username}:${c.password}`).toString('base64')
}

export function opencodeConfigured(): boolean {
  const c = config()
  return c.password.length > 0
}

/** One stateless completion: create session → post message → delete session. */
export async function callOpenCode(opts: {
  prompt: string
  timeoutMs?: number
  retries?: number
}): Promise<ModelCallResult> {
  const { prompt, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 4 } = opts
  const c = config()
  if (!c.password) {
    throw new OpenCodeError('opencode_auth_missing', 'OPENCODE_SERVER_PASSWORD is not set (put it in .env.local).')
  }
  const auth = basicAuth(c)
  const headers: Record<string, string> = { Authorization: auth, 'Content-Type': 'application/json' }

  let lastErr: unknown = null
  for (let attempt = 0; ; attempt++) {
    const session = new AbortController()
    const timer = setTimeout(() => session.abort(), timeoutMs)
    let sessionId: string | null = null
    const started = Date.now()
    try {
      const create = await fetch(c.url + '/session', {
        method: 'POST',
        headers: { ...headers, Origin: c.url },
        body: JSON.stringify({ directory: process.cwd() }),
        signal: session.signal,
      })
      if (!create.ok) {
        const raw = await create.text().catch(() => '')
        throw new OpenCodeError(
          'opencode_unreachable',
          `OpenCode server at ${c.url} responded ${create.status}. Is the desktop app running? ${raw.slice(0, 200)}`,
        )
      }
      const created = (await create.json()) as { id?: string }
      sessionId = created.id ?? null

      const message = await fetch(`${c.url}/session/${sessionId}/message`, {
        method: 'POST',
        headers: { ...headers, Origin: c.url },
        body: JSON.stringify({
          model: { modelID: c.modelID, providerID: c.providerID },
          parts: [{ type: 'text', text: prompt }],
        }),
        signal: session.signal,
      })
      if (!message.ok) {
        const raw = await message.text().catch(() => '')
        throw new OpenCodeError(
          'opencode_error',
          `OpenCode message request failed with ${message.status}: ${raw.slice(0, 200)}`,
        )
      }
      const json = (await message.json()) as {
        info?: { finish?: string; modelID?: string; providerID?: string; tokens?: Record<string, number> & { cache?: { read?: number; write?: number }; total?: number } }
        parts?: { type?: string; text?: string }[]
        error?: { message?: string }
      }
      const parts = Array.isArray(json.parts) ? json.parts : []
      const text = parts
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text ?? '')
        .join('\n')
        .trim()
      return {
        text,
        ms: Date.now() - started,
        modelID: json.info?.modelID ?? c.modelID,
        providerID: json.info?.providerID ?? c.providerID,
        modelVersion: json.info?.modelID,
        finish: json.info?.finish,
        tokens: {
          input: json.info?.tokens?.input,
          output: json.info?.tokens?.output,
          total: json.info?.tokens?.total,
          cacheRead: json.info?.tokens?.cache?.read,
          cacheWrite: json.info?.tokens?.cache?.write,
        },
      }
    } catch (err) {
      if (session.signal.aborted) {
        lastErr = new OpenCodeError('opencode_timeout', `OpenCode request timed out after ${timeoutMs / 1000}s. Big Pickle may be busy.`)
      } else {
        lastErr = err instanceof Error ? err : new OpenCodeError('opencode_error', String(err))
      }
      if (attempt < retries && (err as OpenCodeError | undefined)?.code !== 'opencode_auth_missing') {
        const backoff = 1000 * 2 ** attempt
        await new Promise((r) => setTimeout(r, backoff))
        continue
      }
      throw lastErr
    } finally {
      clearTimeout(timer)
      if (sessionId) {
        fetch(`${c.url}/session/${sessionId}`, { method: 'DELETE', headers: { Authorization: auth } }).catch(() => {})
      }
    }
  }
}

/** Best-effort reachability check (used to fail fast with a clear message). */
export async function opencodeReachable(): Promise<{ ok: boolean; status: number | 0 }> {
  const c = config()
  if (!c.password) return { ok: false, status: 0 }
  return fetch(c.url + '/session?limit=1', { headers: { Authorization: basicAuth(c) } })
    .then((r) => ({ ok: r.status === 200, status: r.status }))
    .catch(() => ({ ok: false, status: 0 }))
}