// Vite dev-server middleware for the Decision Router live demo.
//
// The browser keeps the pipeline logic; this middleware is the only place
// that talks to external services and holds credentials. Three backends:
//
//   /api/live/llm      -> the local OpenCode desktop server (Big Pickle HTTP API)
//   /api/live/jev      -> the Jev Decision API (/v1/decide)
//   /api/live/baseline -> Google Gemini (the eval baseline models, run server-side)
//
// Credentials come from the environment, with a best-effort fallback to
// .env.local / .env in the project root. Nothing secret is ever exposed to
// the browser. This middleware only runs in dev (npm run dev).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Connect } from 'vite'
import { runCoT } from '../scripts/lib/cot'
import { runReact } from '../scripts/lib/react'
import type { Scenario } from '../src/lib/live/types'

const ENV_FILES = ['.env.local', '.env']

function loadDotEnv(): void {
  for (const file of ENV_FILES) {
    const path = join(process.cwd(), file)
    if (!existsSync(path)) continue
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const [key, val] = [m[1], m[2]]
      if (process.env[key] === undefined) process.env[key] = unquote(val)
    }
  }
}

function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1)
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1)
  return v
}

const DEFAULT_MODEL_ID = 'big-pickle'
const DEFAULT_PROVIDER_ID = 'opencode'
const DEFAULT_JEV_URL = 'https://jevtypesafeai.com/api/v1/decide'
const DEFAULT_OPENCODE_URL = 'http://localhost:63445'
const GENEROUS_TIMEOUT_MS = 240_000

interface LiveConfig {
  opencodeUrl: string
  username: string
  password: string
  modelID: string
  providerID: string
  jevUrl: string
  jevKey: string | null
}

function config(): LiveConfig {
  loadDotEnv()
  return {
    opencodeUrl: process.env.OPENCODE_SERVER_URL ?? DEFAULT_OPENCODE_URL,
    username: process.env.OPENCODE_SERVER_USERNAME ?? 'opencode',
    password: process.env.OPENCODE_SERVER_PASSWORD ?? '',
    modelID: process.env.OPENCODE_MODEL_ID ?? DEFAULT_MODEL_ID,
    providerID: process.env.OPENCODE_PROVIDER_ID ?? DEFAULT_PROVIDER_ID,
    jevUrl: process.env.JEV_API_URL ?? DEFAULT_JEV_URL,
    jevKey: process.env.JEV_API_KEY && process.env.JEV_API_KEY.length > 0 ? process.env.JEV_API_KEY : null,
  }
}

function basicAuth(c: LiveConfig): string {
  return 'Basic ' + Buffer.from(`${c.username}:${c.password}`).toString('base64')
}

function httpErr(cfg: { code: string; message: string; detail?: unknown }): { ok: false; error: typeof cfg } {
  return { ok: false, error: cfg }
}

async function bodyOf(req: Parameters<Connect.NextHandleFunction>[0]): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function opencodeComplete(prompt: string, c: LiveConfig): Promise<unknown> {
  if (!c.password) {
    return httpErr({
      code: 'opencode_auth_missing',
      message:
        'OPENCODE_SERVER_PASSWORD is not set. The local OpenCode desktop server is the Big Pickle runtime for this demo — set it in .env.local (see .env.example) and restart the dev server.',
    })
  }
  const auth = basicAuth(c)
  const headers: Record<string, string> = { Authorization: auth, 'Content-Type': 'application/json' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), GENEROUS_TIMEOUT_MS)

  let sessionId: string | null = null
  try {
    const started = Date.now()
    const create = await fetch(c.opencodeUrl + '/session', {
      method: 'POST',
      headers: { ...headers, Origin: c.opencodeUrl },
      body: JSON.stringify({ directory: process.cwd() }),
      signal: ctrl.signal,
    })
    if (!create.ok) {
      const raw = await create.text().catch(() => '')
      return httpErr({
        code: 'opencode_unreachable',
        message: `OpenCode server at ${c.opencodeUrl} responded ${create.status}. Is the desktop app running?`,
        detail: raw.slice(0, 500),
      })
    }
    const created = (await create.json()) as { id?: string }
    sessionId = created.id ?? null

    const message = await fetch(`${c.opencodeUrl}/session/${sessionId}/message`, {
      method: 'POST',
      headers: { ...headers, Origin: c.opencodeUrl },
      body: JSON.stringify({
        model: { modelID: c.modelID, providerID: c.providerID },
        parts: [{ type: 'text', text: prompt }],
      }),
      signal: ctrl.signal,
    })
    if (!message.ok) {
      const raw = await message.text().catch(() => '')
      return httpErr({
        code: 'opencode_error',
        message: `OpenCode message request failed with ${message.status}.`,
        detail: raw.slice(0, 500),
      })
    }
    const json = (await message.json()) as {
      info?: { finish?: string; modelID?: string; providerID?: string; tokens?: Record<string, number> }
      parts?: { type?: string; text?: string }[]
      error?: { message?: string }
    }
    const parts = Array.isArray(json.parts) ? json.parts : []
    const text = parts
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text ?? '')
      .join('\n')
    const elapsed = Date.now() - started
    return {
      ok: true,
      text,
      modelID: json.info?.modelID ?? c.modelID,
      providerID: json.info?.providerID ?? c.providerID,
      finish: json.info?.finish ?? 'error',
      ms: elapsed,
      tokens: json.info?.tokens ?? {},
    }
  } catch (err) {
    if (ctrl.signal.aborted) {
      return httpErr({
        code: 'opencode_timeout',
        message: `OpenCode request timed out after ${GENEROUS_TIMEOUT_MS / 1000}s. Big Pickle may be busy.`,
      })
    }
    return httpErr({
      code: 'opencode_unreachable',
      message: `Could not reach OpenCode server at ${c.opencodeUrl}: ${err instanceof Error ? err.message : String(err)}`,
    })
  } finally {
    clearTimeout(timer)
    if (sessionId) {
      fetch(`${c.opencodeUrl}/session/${sessionId}`, { method: 'DELETE', headers: { Authorization: auth } }).catch(
        () => {},
      )
    }
  }
}

async function jevDecide(state: unknown, questions: unknown, c: LiveConfig, model?: unknown): Promise<unknown> {
  if (!c.jevKey) {
    return httpErr({
      code: 'jev_api_key_missing',
      message:
        'JEV_API_KEY is not set. The Jev judge is a real, API-only decision model (TypeSafe "System One"). Get a key and set JEV_API_KEY in .env.local — never a fake judge.',
    })
  }
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 60_000)
  try {
    const res = await fetch(c.jevUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.jevKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: typeof model === 'string' && model ? model : 'jev-latest', state, questions }),
      signal: ctrl.signal,
    })
    const raw = await res.text().catch(() => '')
    if (res.status === 401) {
      return httpErr({ code: 'jev_auth', message: 'Jev rejected the API key (401). Check JEV_API_KEY.' })
    }
    if (res.status === 402) {
      return httpErr({ code: 'jev_credits', message: 'Jev returned 402: insufficient credits. Top up the account.' })
    }
    if (res.status === 403) {
      return httpErr({ code: 'jev_inactive', message: 'Jev returned 403: the account is inactive.' })
    }
    if (!res.ok) {
      let parsed: unknown = null
      try {
        parsed = JSON.parse(raw)
      } catch {
        /* keep raw */
      }
      return httpErr({
        code: 'jev_error',
        message: `Jev endpoint ${c.jevUrl} responded ${res.status}.`,
        detail: parsed ?? raw.slice(0, 500),
      })
    }
    const json = JSON.parse(raw) as Record<string, unknown>
    return { ok: true, ms: Date.now() - started, answers: json.answers ?? null, usage: json.usage ?? null, model: json.model ?? null }
  } catch (err) {
    if (ctrl.signal.aborted) {
      return httpErr({ code: 'jev_timeout', message: 'Jev request timed out after 60s.' })
    }
    return httpErr({
      code: 'jev_unreachable',
      message: `Could not reach Jev at ${c.jevUrl}: ${err instanceof Error ? err.message : String(err)}`,
    })
  } finally {
    clearTimeout(timer)
  }
}

async function status(c: LiveConfig): Promise<{ ok: boolean; data: unknown }> {
  if (!c.password) {
    return {
      ok: true,
      data: {
llm: { ok: false, modelID: c.modelID, providerID: c.providerID, url: c.opencodeUrl, reason: 'password not set' },
      jev: { ok: c.jevKey !== null, url: c.jevUrl, keyPresent: c.jevKey !== null },
      gemini: {
        ok: typeof process.env.GEMINI_API_KEY === 'string' && process.env.GEMINI_API_KEY.length > 0,
        model: process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest',
      },
    },
  }
}
  const reachable = await fetch(c.opencodeUrl + '/session?limit=1', { headers: { Authorization: basicAuth(c) } })
    .then((r) => ({ code: r.status }))
    .catch(() => ({ code: 0 }))
  return {
    ok: true,
    data: {
      llm: {
        ok: reachable.code === 200,
        modelID: c.modelID,
        providerID: c.providerID,
        url: c.opencodeUrl,
        reachableStatus: reachable.code,
      },
      jev: { ok: c.jevKey !== null, url: c.jevUrl, keyPresent: c.jevKey !== null },
      gemini: {
        ok: typeof process.env.GEMINI_API_KEY === 'string' && process.env.GEMINI_API_KEY.length > 0,
        model: process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest',
      },
    },
  }
}

export function liveMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    if (!path.startsWith('/api/live/')) return next()

    const send = (code: number, data: unknown) => {
      if (res.writableEnded) return
      res.statusCode = code
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(data))
    }

    void (async () => {
      try {
        const c = config()
        if (path === '/api/live/ping') return send(200, { ok: true })
        if (path === '/api/live/status') return send(200, await status(c))
        if (path === '/api/live/llm' && req.method === 'POST') {
          const prompt = (JSON.parse(await bodyOf(req)) as { prompt?: unknown }).prompt
          if (typeof prompt !== 'string' || prompt.length === 0) return send(400, httpErr({ code: 'bad_prompt', message: 'prompt must be a non-empty string' }))
          return send(200, await opencodeComplete(prompt, c))
        }
        if (path === '/api/live/jev' && req.method === 'POST') {
          const { state, questions, model } = JSON.parse(await bodyOf(req)) as { state?: unknown; questions?: unknown; model?: unknown }
          if (state === undefined || questions === undefined) {
            return send(400, httpErr({ code: 'bad_jev_request', message: 'state and questions are required' }))
          }
          return send(200, await jevDecide(state, questions, c, model))
        }
        if (path === '/api/live/baseline' && req.method === 'POST') {
          const { pipeline, scenario } = JSON.parse(await bodyOf(req)) as { pipeline?: unknown; scenario?: unknown }
          if (pipeline !== 'cot' && pipeline !== 'react') {
            return send(400, httpErr({ code: 'bad_baseline', message: 'pipeline must be "cot" or "react"' }))
          }
          if (!scenario || typeof scenario !== 'object') {
            return send(400, httpErr({ code: 'bad_baseline', message: 'scenario object is required' }))
          }
          const result = pipeline === 'cot' ? await runCoT(scenario as Scenario) : await runReact(scenario as Scenario)
          return send(200, result)
        }
        return send(404, httpErr({ code: 'not_found', message: `no live endpoint ${path}` }))
      } catch (err) {
        return send(500, httpErr({ code: 'internal', message: err instanceof Error ? err.message : String(err) }))
      }
    })()
  }
}