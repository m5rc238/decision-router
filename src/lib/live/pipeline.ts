// The real composed pipeline. Runs end-to-end locally:
//
//   USER INPUT → Semantic Router (LLM) → Route Contract → Verified Facts →
//   Jev Judgment → Decision Contract → Response Composer (LLM) → Final response
//
// The LLM stages call Big Pickle through the dev middleware
// (/api/live/llm → local OpenCode desktop server). The judgment stage calls
// the real Jev Decision API (/api/live/jev). Every stage records its actual
// input/output/latency/tokens or fails visibly — nothing is faked or delayed.
//
// The only synthetic content is the "fault injection" scenarios, which
// deliberately short-circuit one stage with bad output so the REAL failure
// branches (JSON validation, triage, guardrails) can be demonstrated
// deterministically. Injected stages are marked `faulted` in the UI.

import type {
  DecisionContract,
  Fault,
  JevCallResult,
  JevSelected,
  LiveRun,
  LiveStage,
  LlmCallResult,
  RouterContract,
  Scenario,
  StageKey,
  VerifiedFacts,
} from './types'
import type { Layer } from '../../types'
import { asRecord, extractJsonObject, stringify } from './json'

const ROUTE_CATALOG = new Set([
  'refund_request',
  'billing_dispute',
  'technical_issue',
  'cancellation_request',
  'account_question',
  'other',
  'human_triage',
])

const DECISIONS = new Set(['approve_refund', 'deny_refund', 'request_review'])

const REASON_ALLOWED: Record<string, string[]> = {
  approve_refund: ['within_refund_window'],
  deny_refund: ['refund_window_exceeded', 'not_eligible'],
  request_review: ['irregular_review'],
}

export const STAGE_KEYS: StageKey[] = [
  'user_input',
  'semantic_router',
  'route_contract',
  'verified_facts',
  'jev_judgment',
  'decision_contract',
  'response_composer',
  'user_response',
]

export const STAGE_LAYER: Record<StageKey, Layer> = {
  user_input: 'input',
  semantic_router: 'llm',
  route_contract: 'deterministic',
  verified_facts: 'deterministic',
  jev_judgment: 'jev',
  decision_contract: 'deterministic',
  response_composer: 'llm',
  user_response: 'output',
}

// ---------------------------------------------------------------------------
// Fetch helpers (same-origin dev middleware). In the browser the base stays
// empty (same-origin). Eval scripts on Node can point it at a running dev
// server with setLiveApiBase() so the SAME pipeline runs headlessly.
let API_BASE = ''

export function setLiveApiBase(base: string): void {
  API_BASE = base.replace(/\/$/, '')
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as T & { ok?: boolean; error?: { code?: string; message?: string } }
  if (!res.ok || data.ok === false) {
    throw new LiveError(data.error?.code ?? 'http', data.error?.message ?? `HTTP ${res.status} for ${path}`)
  }
  return data
}

export async function fetchStatus(): Promise<{ llm: unknown; jev: unknown }> {
  const res = await fetch(API_BASE + '/api/live/status')
  const data = (await res.json()) as { data: { llm: unknown; jev: unknown } }
  return data.data
}

async function callLlm(prompt: string): Promise<LlmCallResult> {
  const raw = await postJson<{
    text: string
    modelID: string
    providerID: string
    ms: number
    tokens: { input?: number; output?: number; total?: number; cache?: { read?: number } }
  }>('/api/live/llm', { prompt })
  return {
    text: raw.text,
    modelID: raw.modelID,
    providerID: raw.providerID,
    ms: raw.ms,
    tokens: {
      input: raw.tokens?.input,
      output: raw.tokens?.output,
      total: raw.tokens?.total,
      cacheRead: raw.tokens?.cache?.read,
    },
  }
}

async function callJev(state: unknown, questions: unknown): Promise<JevCallResult> {
  const raw = await postJson<{
    answers: JevCallResult['answers']
    usage: Record<string, unknown> | null
    ms: number
  }>('/api/live/jev', { state, questions })
  const cost = raw.usage?.cost_usd
  const costUsd = typeof cost === 'number' ? cost : null
  return { answers: raw.answers ?? {}, usage: raw.usage, ms: raw.ms, costUsd }
}

export class LiveError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Prompts

function routerPrompt(userInput: string): string {
  return [
    'You are the Semantic Router for a support system. Your ONLY job is classification and extraction.',
    "You never make a business decision — you never approve, deny, or apply policy. You only turn a request into a typed route.",
    '',
    'Routing is INTENT ONLY. Decide what the customer wants done, not whether it can be done.',
    'Missing supporting details (order ids, amounts, exact dates) do NOT make a request ambiguous — they are retrieved and verified by later stages.',
    '',
    'Respond with a single JSON object and nothing else:',
    JSON.stringify(
      { route: '...', decision_space: '...', extracted_entities: {}, ambiguity: [] },
      null,
      2,
    ),
    '',
    'Route catalog (choose the closest match):',
    '- "refund_request": the customer asks for money back (abort the purchase, refund)',
    '- "billing_dispute": the customer questions a charge (duplicate, wrong amount)',
    '- "technical_issue": the product/service is broken',
    '- "cancellation_request": the customer wants to end the subscription',
    '- "account_question": login, access, or account questions',
    '- "other": anything else',
    '',
    'decision_space: within the chosen route, the specific policy domain that governs the request. Known decision spaces: "plan_change_policy", "duplicate_charge", "amount_discrepancy", "account_access", "general_billing", "general_support".',
    'extracted_entities: only values explicitly present in the request (plan name, dates, amounts).',
    'ambiguity: an empty array when the intent is clear. Only list missing facts when the INTENT itself is unclear.',
    '',
    'Rules:',
    '- A refund request routes to "refund_request" even when the refund policy eligibility is unknown. Eligibility is decided later, never in the router.',
    '- Use "human_triage" as route ONLY when you cannot tell what the customer wants at all (multiple routes fit equally or the request is vague).',
    '- Do not invent entities that are not in the request.',
    '- JSON only. No markdown fences, no prose, no commentary.',
    '',
    `Customer request: "${userInput}"`,
  ].join('\n')
}

function jevState(userInput: string, router: RouterContract, facts: VerifiedFacts): unknown {
  return {
    user_request: userInput,
    route: router.route,
    decision_space: router.decisionSpace,
    verified_facts: facts,
  }
}

function jevQuestions(): Record<string, unknown> {
  return {
    refund_decision: {
      type: 'choice',
      instructions:
        'Given the verified_facts and the applicable refund policy, decide this refund request. Approve when purchase_age_days is at or below refund_window_days AND account_status is active AND there have not been multiple prior refunds. Deny when purchase_age_days exceeds refund_window_days (refund_window_exceeded) or the account is not active (not_eligible). A non-active account is NOT an ambiguous case — deny it. Ask for review ONLY when the case is genuinely irregular: two or more previous refunds (previous_refunds_count >= 2), or facts that are ambiguous or incomplete.',
      criteria: {
        approve_refund: 'purchase_age_days <= refund_window_days and account_status is active and previous_refunds_count < 2',
        deny_refund: 'purchase_age_days > refund_window_days (refund_window_exceeded) OR account_status is not active (not_eligible)',
        request_review: 'previous_refunds_count >= 2, or facts are ambiguous or incomplete — a specialist must review',
      },
    },
    reason_code: {
      type: 'choice',
      instructions: 'Choose the single most specific reason for the refund decision, consistent with the decision.',
      criteria: {
        within_refund_window: 'purchase_age_days <= refund_window_days',
        refund_window_exceeded: 'purchase_age_days > refund_window_days',
        not_eligible: 'account not active or otherwise ineligible',
        irregular_review: 'previous_refunds_count >= 2 (repeated refund activity), or irregular/ambiguous facts require a specialist',
      },
    },
  }
}

function composerPrompt(decision: DecisionContract): string {
  const evidence = Object.entries(decision.evidence)
    .filter(([, v]) => v !== undefined)
    .reduce<Record<string, unknown>>((acc, [k, v]) => {
      acc[k] = v
      return acc
    }, {})
  return [
    'You translate an existing system judgment into natural language for a customer.',
    'You have NO authority to change, reinterpret, or override the judgment.',
    '',
    `Decision: ${decision.decision}`,
    `Reason: ${decision.reasonCode}`,
    `Verified evidence: ${stringify(evidence, 0)}`,
    '',
    'Write a short, warm, professional support message. Rules:',
    '- Preserve the decision and the reason exactly.',
    '- Do not introduce policy that is not in the evidence.',
    '- Do not invent amounts, dates, refunds, or promises.',
    '- Do not reverse or soften the decision.',
    '- Plain prose only — no JSON, no bullets about your process, no commentary on the decision itself.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Validation helpers

function validateRouter(parsed: unknown): { contract: RouterContract; triage: boolean; triageNote: string } | null {
  const rec = asRecord(parsed)
  if (!rec) return null
  const route = typeof rec.route === 'string' ? rec.route.trim() : ''
  const decisionSpace = typeof rec.decision_space === 'string' ? rec.decision_space.trim() : ''
  const entitiesRaw = asRecord(rec.extracted_entities) ?? {}
  const extractedEntities: Record<string, string> = {}
  for (const [k, v] of Object.entries(entitiesRaw)) {
    if (typeof v === 'string' || typeof v === 'number') extractedEntities[k] = String(v)
  }
  const ambiguity = Array.isArray(rec.ambiguity)
    ? rec.ambiguity.filter((x): x is string => typeof x === 'string')
    : []

  if (!route && !decisionSpace && ambiguity.length === 0) return null

  const unknown = !ROUTE_CATALOG.has(route)
  const notConfident = route === 'human_triage' || unknown
  const note = unknown
    ? 'the router returned an unknown route'
    : route === 'human_triage'
      ? 'the router could not assign a confident route'
      : 'the intent is clear; supporting facts are verified downstream'

  const contract: RouterContract = {
    route: notConfident ? 'human_triage' : route,
    decisionSpace,
    extractedEntities,
    ambiguity,
  }
  return { contract, triage: notConfident, triageNote: note }
}

function buildDecision(j: JevCallResult, facts: VerifiedFacts): {
  contract: DecisionContract
  selected: JevSelected
} | null {
  const choice = j.answers.refund_decision?.choice
  const confidenceRaw = j.answers.refund_decision?.confidence
  const reason = j.answers.reason_code?.choice
  if (typeof choice !== 'string' || typeof reason !== 'string') return null
  const confidence = typeof confidenceRaw === 'number' ? confidenceRaw : 0
  // Low-confidence fail-safe: never put a shaky approval/denial on the wire.
  if (confidence < 0.55) {
    return {
      selected: { choice: choice, reasonCode: reason, confidence, probabilities: j.answers.refund_decision?.probabilities },
      contract: { decision: 'request_review', reasonCode: 'irregular_review', confidence, evidence: facts },
    }
  }
  if (!DECISIONS.has(choice)) return null
  if (!(REASON_ALLOWED[choice] ?? []).includes(reason)) return null
  return {
    selected: { choice, reasonCode: reason, confidence, probabilities: j.answers.refund_decision?.probabilities },
    contract: { decision: choice as DecisionContract['decision'], reasonCode: reason, confidence, evidence: facts },
  }
}

const NEG_WORDS = /\b(no|not|cannot|can'?t|never|won'?t|without|unable|isn'?t|aren'?t|haven'?t|hasn'?t|no longer)\b/i

function negatedBefore(text: string, index: number): boolean {
  return NEG_WORDS.test(text.slice(Math.max(0, index - 24), index))
}

function approveMentioned(text: string): boolean {
  const re = /\b(approved|approve|refunded|credited|issued|granted|refund issued|will refund|going to refund|we'?ve refunded)\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (!negatedBefore(text, m.index)) return true
  }
  return false
}

function denyMentioned(text: string): boolean {
  const re = /\b(denied|deny|unable|cannot|can'?t|not able)\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (!negatedBefore(text, m.index)) return true
  }
  return false
}

function composerGuard(decision: DecisionContract['decision'], text: string): string | null {
  if (text.trim().length === 0) return 'the composer produced no output'
  if (decision === 'approve_refund' && denyMentioned(text)) {
    return 'the composer response contradicts the approved decision'
  }
  if (decision === 'deny_refund' && approveMentioned(text)) {
    return 'the composer response contradicts the denied decision (it implies a refund was issued)'
  }
  if (decision === 'request_review' && (approveMentioned(text) || denyMentioned(text))) {
    return 'the composer response resolves a review decision into a definitive outcome'
  }
  return null
}

// ---------------------------------------------------------------------------
// Fault injection (demo controls to exercise the real failure branches)

function faultRouterText(fault: Fault): string {
  if (fault.kind === 'invalid-json') return 'Sure thing, this is definitely a refund. {"route":"refund_request"'
  if (fault.kind === 'missing-route') {
    return stringify(
      { route: 'human_triage', decision_space: '', extracted_entities: { plan: 'Pro' }, ambiguity: ['purchase date'] },
      2,
    )
  }
  return ''
}

function faultJev(fault: Fault): JevCallResult {
  if (fault.kind === 'jev-invalid-decision') {
    return {
      answers: {
        refund_decision: { type: 'choice', choice: 'maybe', confidence: 0.99, probabilities: { maybe: 1 } },
        reason_code: { type: 'choice', choice: 'within_refund_window', confidence: 0.99 },
      },
      ms: 0,
    }
  }
  throw new LiveError('jev_error', 'Jev upstream returned 502 Bad Gateway (injected demo fault).')
}

const FAULT_COMPOSER_TEXT: Record<string, string> = {
  contradicts:
    "Great news — we've approved your refund and issued it to your card. You'll see it within 5–7 business days.",
}

// ---------------------------------------------------------------------------
// Runner

export interface StageRunInfo {
  input?: string
  output?: string
  highlight?: string
  error?: string
  errorCode?: string
  ms?: number
  tokens?: LiveStage['tokens']
  faulted?: boolean
}

const CURRENT = { runId: 0 }

export async function runLivePipeline(opts: {
  scenario: Scenario
  onUpdate: (run: LiveRun) => void
}): Promise<LiveRun> {
  const { scenario, onUpdate } = opts
  const runId = ++CURRENT.runId
  const started = Date.now()

  const blank: LiveStage[] = STAGE_KEYS.map((key) => ({
    key,
    layer: STAGE_LAYER[key],
    status: 'idle',
  }))
  const run: LiveRun = { scenarioId: scenario.id, runId, status: 'running', stages: blank, totalMs: 0 }

  const push = (patch: Partial<LiveRun>) => {
    if (CURRENT.runId !== runId) return
    Object.assign(run, patch)
    onUpdate({ ...run, stages: run.stages.map((s) => ({ ...s })) })
  }
  // Local convenience to record a single stage change without touching others.
  const updateStage = (i: number, st: Partial<LiveStage>) => {
    if (CURRENT.runId !== runId) return
    run.stages[i] = { ...run.stages[i], ...st }
    push({})
  }

  const setDone = (i: number, info: StageRunInfo) => {
    updateStage(i, { status: 'done', ...info })
  }
  const setError = (i: number, info: StageRunInfo) => {
    updateStage(i, { status: 'error', ...info })
    run.status = 'error'
    push({})
  }

  const i = (key: StageKey) => STAGE_KEYS.indexOf(key)
  const fault = scenario.fault ?? null

  // 0 · USER INPUT
  updateStage(i('user_input'), { status: 'running' })
  if (CURRENT.runId !== runId) return run
  setDone(i('user_input'), { input: scenario.userInput, output: scenario.userInput, ms: 0 })

  // 1 · SEMANTIC ROUTER
  updateStage(i('semantic_router'), { status: 'running', input: routerPrompt(scenario.userInput) })
  let routerText: string
  if (fault?.stage === 'semantic_router') {
    routerText = faultRouterText(fault)
  } else {
    const raw = await callLlm(routerPrompt(scenario.userInput))
    if (CURRENT.runId !== runId) return run
    routerText = raw.text
    updateStage(i('semantic_router'), { ms: raw.ms, tokens: raw.tokens })
  }
  const jsonText = extractJsonObject(routerText)
  const validated = jsonText ? validateRouter(safeParse(jsonText)) : null
  if (!validated) {
    setError(i('semantic_router'), {
      output: routerText,
      errorCode: 'router_malformed_json',
      faulted: fault?.stage === 'semantic_router',
      error:
        'The router output was not valid structured JSON, so no route contract could be built. Fail closed: human triage is required, the pipeline stops here.',
    })
    return finish(run, started)
  }
  setDone(i('semantic_router'), {
    output: jsonText ?? '',
    faulted: fault?.stage === 'semantic_router',
    highlight: validated.contract.route,
  })

  // 2 · ROUTE CONTRACT
  const contractOut = stringify(validated.contract)
  const triage = validated.triage
  updateStage(i('route_contract'), { status: 'running' })
  setDone(i('route_contract'), {
    input: jsonText ?? '',
    output: contractOut,
    highlight: validated.contract.route,
  })
  if (triage) {
    run.status = 'triage'
    run.note = `Route: human_triage — ${validated.triageNote}. The request goes to a human; the composed pipeline halts here.`
    push({})
    return finish(run, started)
  }

  // 3 · VERIFIED FACTS
  updateStage(i('verified_facts'), { status: 'running' })
  const facts = scenario.facts ?? {}
  if (!facts || Object.keys(facts).length === 0) {
    setError(i('verified_facts'), {
      input: 'facts source: scenario fixture',
      errorCode: 'facts_missing',
      error:
        'No verified facts were available for route refund_request/plan_change_policy. Fail closed: the pipeline halts rather than let a model guess the undisputed facts.',
    })
    return finish(run, started)
  }
  setDone(i('verified_facts'), {
    input: 'facts source: local fixture (authoritative system data — never model memory)',
    output: stringify(facts),
  })

  // 4 · JEV JUDGMENT
  const router = validated.contract
  const startedJev = Date.now()
  updateStage(i('jev_judgment'), {
    status: 'running',
    input: `state:\n${stringify({ state: jevState(scenario.userInput, router, facts) })}\nquestions:\n${stringify(jevQuestions())}`,
  })
  let jev: JevCallResult
  try {
    jev = fault?.stage === 'jev_judgment' ? faultJev(fault) : await callJev(jevState(scenario.userInput, router, facts), jevQuestions())
  } catch (err) {
    setError(i('jev_judgment'), {
      errorCode: err instanceof LiveError ? err.code : 'jev_unreachable',
      faulted: fault?.stage === 'jev_judgment',
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - startedJev,
    })
    return finish(run, started)
  }
  if (CURRENT.runId !== runId) return run
  const decision = buildDecision(jev, facts)
  if (!decision) {
    setError(i('jev_judgment'), {
      output: stringify(jev.answers),
      faulted: fault?.stage === 'jev_judgment',
      errorCode: 'jev_invalid_output',
      error:
        'Jev did not return a valid typed judgment (unknown decision or a reason code inconsistent with the decision). Fail closed: nothing downstream runs.',
    })
    return finish(run, started)
  }
  setDone(i('jev_judgment'), {
    input: `state:\n${stringify({ state: jevState(scenario.userInput, router, facts) })}\nquestions:\n${stringify(jevQuestions())}`,
    output: stringify({
      decision: decision.contract.decision,
      reason_code: decision.contract.reasonCode,
      confidence: decision.contract.confidence,
      probability: decision.selected.probabilities?.[decision.contract.decision],
      evidence: facts,
    }),
    highlight: decision.contract.decision,
    ms: jev.ms,
    faulted: fault?.stage === 'jev_judgment',
  })

  // 5 · DECISION CONTRACT
  updateStage(i('decision_contract'), { status: 'running' })
  setDone(i('decision_contract'), {
    input: stringify({ decision: decision.contract.decision, reason_code: decision.contract.reasonCode, confidence: decision.contract.confidence }),
    output: stringify(decision.contract),
    highlight: decision.contract.decision,
  })

  // 6 · RESPONSE COMPOSER
  const prompt = composerPrompt(decision.contract)
  updateStage(i('response_composer'), { status: 'running', input: prompt })
  let composerText: string
  try {
    if (fault?.stage === 'response_composer') {
      composerText = FAULT_COMPOSER_TEXT[fault.kind] ?? ''
      updateStage(i('response_composer'), { faulted: true })
    } else {
      const raw = await callLlm(prompt)
      if (CURRENT.runId !== runId) return run
      composerText = raw.text
      updateStage(i('response_composer'), { ms: raw.ms, tokens: raw.tokens })
    }
  } catch (err) {
    setError(i('response_composer'), {
      errorCode: err instanceof LiveError ? err.code : 'llm_unreachable',
      error: err instanceof Error ? err.message : String(err),
    })
    return finish(run, started)
  }
  const guardError = composerGuard(decision.contract.decision, composerText)
  if (guardError) {
    setError(i('response_composer'), {
      output: composerText,
      faulted: fault?.stage === 'response_composer',
      errorCode: 'composer_contradiction',
      error: `The composer response was rejected by the guardrail: ${guardError}. The final message must not change the decision.`,
    })
    return finish(run, started)
  }
  setDone(i('response_composer'), {
    input: prompt,
    output: composerText,
    faulted: fault?.stage === 'response_composer',
  })

  // 7 · USER RESPONSE
  updateStage(i('user_response'), { status: 'running' })
  setDone(i('user_response'), {
    input: 'final message from the Response Composer',
    output: composerText,
  })

  return finish(run, started)
}

function finish(run: LiveRun, started: number): LiveRun {
  if (CURRENT.runId !== run.runId) return run
  run.totalMs = Date.now() - started
  if (run.status === 'running') {
    run.status = run.stages.some((s) => s.status === 'error') ? 'error' : 'done'
  }
  return run
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}