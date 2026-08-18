// Cloud LLM providers (OpenAI-compatible + Anthropic), so a "model" can be a hosted
// API instead of a local Ollama one. API keys are passed in by the caller (read from the
// local settings store) — they never appear in this module's persisted state.
//
// The streaming wire formats: OpenAI/xAI use `data: {choices:[{delta:{content}}]}` SSE
// ending in `data: [DONE]`; Anthropic uses typed SSE events with content_block_delta.

import type { ChatHandlers, ChatOptions } from './ollamaClient'
import type { ChatMessage, CloudModelListResult, CloudValidateResult } from '../shared/types'

export interface ProviderConfig {
  apiKey: string
  /** Override the API base URL (e.g. an OpenAI-compatible gateway). */
  baseUrl?: string
  models: string[]
}

export const DEFAULT_BASE: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  xai: 'https://api.x.ai/v1',
  anthropic: 'https://api.anthropic.com/v1',
  // OpenAI-compatible endpoints — served by openaiChat below (Bearer auth, `data:` SSE).
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  mistral: 'https://api.mistral.ai/v1'
}

/** Extract text delta from an OpenAI streaming chunk. Exported for tests. */
export function parseOpenAIDelta(json: string): string | null {
  try {
    const obj = JSON.parse(json)
    return obj?.choices?.[0]?.delta?.content ?? null
  } catch {
    return null
  }
}

/** Extract text delta from an Anthropic SSE event payload. Exported for tests. */
export function parseAnthropicDelta(json: string): string | null {
  try {
    const obj = JSON.parse(json)
    if (obj?.type === 'content_block_delta') return obj?.delta?.text ?? null
    return null
  } catch {
    return null
  }
}

/** Read an SSE stream, invoking `onData` for each `data:` payload (excluding [DONE]). */
async function readSSE(body: ReadableStream<Uint8Array>, onData: (payload: string) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload && payload !== '[DONE]') onData(payload)
    }
  }
}

function statsFrom(tokens: number, startedAt: number): { tokensPerSec: number; evalCount: number; totalMs: number } {
  const totalMs = Date.now() - startedAt
  const secs = totalMs / 1000
  return { evalCount: tokens, tokensPerSec: secs > 0 ? tokens / secs : 0, totalMs }
}

async function openaiChat(
  providerId: string,
  base: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  handlers: ChatHandlers,
  options?: ChatOptions
): Promise<void> {
  const startedAt = Date.now()
  // Only real OpenAI reliably supports stream_options.include_usage; xAI / OpenAI-compatible
  // gateways may reject it, so send it only to OpenAI.
  const includeUsage = providerId === 'openai'
  let res: Response
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {})
      }),
      signal: handlers.signal
    })
  } catch (err) {
    handlers.onError((err as Error).message)
    return
  }
  if (!res.ok || !res.body) {
    handlers.onError(`OpenAI-compatible request failed: HTTP ${res.status} ${await safeText(res)}`)
    return
  }
  let tokens = 0
  try {
    await readSSE(res.body, (payload) => {
      const delta = parseOpenAIDelta(payload)
      if (delta) {
        tokens++
        handlers.onDelta(delta)
      }
      try {
        const usage = JSON.parse(payload)?.usage
        if (usage?.completion_tokens) tokens = usage.completion_tokens
      } catch {
        /* ignore */
      }
    })
    handlers.onStats?.(statsFrom(tokens, startedAt))
    handlers.onDone()
  } catch (err) {
    if ((err as Error).name === 'AbortError') handlers.onDone()
    else handlers.onError((err as Error).message)
  }
}

async function anthropicChat(
  base: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  handlers: ChatHandlers,
  options?: ChatOptions
): Promise<void> {
  const startedAt = Date.now()
  // Anthropic takes system as a top-level field, and only user/assistant turns in messages.
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const turns = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }))

  let res: Response
  try {
    res = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        stream: true,
        ...(system ? { system } : {}),
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        messages: turns
      }),
      signal: handlers.signal
    })
  } catch (err) {
    handlers.onError((err as Error).message)
    return
  }
  if (!res.ok || !res.body) {
    handlers.onError(`Anthropic request failed: HTTP ${res.status} ${await safeText(res)}`)
    return
  }
  let tokens = 0
  try {
    await readSSE(res.body, (payload) => {
      const delta = parseAnthropicDelta(payload)
      if (delta) {
        tokens++
        handlers.onDelta(delta)
      }
      try {
        const obj = JSON.parse(payload)
        if (obj?.type === 'message_delta' && obj?.usage?.output_tokens) tokens = obj.usage.output_tokens
        if (obj?.type === 'error') handlers.onError(obj?.error?.message ?? 'Anthropic error')
      } catch {
        /* ignore */
      }
    })
    handlers.onStats?.(statsFrom(tokens, startedAt))
    handlers.onDone()
  } catch (err) {
    if ((err as Error).name === 'AbortError') handlers.onDone()
    else handlers.onError((err as Error).message)
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return ''
  }
}

/**
 * Heuristic: does a provider error mean the account is out of credits / rate-limited,
 * so retrying the same model is pointless but another model might work? Used by the
 * failover wrapper. Kept liberal — a false positive just triggers a harmless model switch.
 */
export function isQuotaError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    /\b(402|429)\b/.test(m) ||
    m.includes('insufficient_quota') ||
    m.includes('quota') ||
    m.includes('rate limit') ||
    m.includes('rate_limit') ||
    m.includes('too many requests') ||
    m.includes('billing') ||
    (m.includes('insufficient') && m.includes('credit')) ||
    m.includes('out of credit')
  )
}

/** Does an error mean the model is permanently gone (retired / removed / paid-only), vs a
 * transient quota/rate issue? Only "gone" models should be pruned. */
export function isModelGoneError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    /\b404\b/.test(m) ||
    m.includes('not_found') ||
    m.includes('not found') ||
    m.includes('no longer available') ||
    m.includes('unavailable') ||
    m.includes('does not exist') ||
    m.includes('model_not_found') ||
    m.includes('invalid model') ||
    m.includes('decommission')
  )
}

/** Send a minimal request to one model and classify the outcome. */
function pingModel(
  providerId: string,
  cfg: ProviderConfig,
  model: string
): Promise<{ status: 'ok' | 'dead' | 'quota' | 'error'; error?: string }> {
  return new Promise((resolve) => {
    let settled = false
    const done = (r: { status: 'ok' | 'dead' | 'quota' | 'error'; error?: string }) => {
      if (!settled) {
        settled = true
        resolve(r)
      }
    }
    providerChat(providerId, cfg, model, [{ role: 'user', content: 'hi' }], {
      onDelta: () => {},
      onDone: () => done({ status: 'ok' }),
      onError: (msg) =>
        done({ status: isModelGoneError(msg) ? 'dead' : isQuotaError(msg) ? 'quota' : 'error', error: msg })
    })
  })
}

/**
 * Ping every model (bounded concurrency) and classify each as working, dead (should be
 * removed), rate-limited (keep — transient), or other error (keep — ambiguous).
 */
export async function validateModels(
  providerId: string,
  cfg: { apiKey: string; baseUrl?: string },
  models: string[]
): Promise<CloudValidateResult> {
  const out: CloudValidateResult = { ok: [], dead: [], quota: [], errors: [] }
  if (!cfg.apiKey) return { ...out, errors: models.map((m) => ({ model: m, error: 'no API key' })) }
  const full: ProviderConfig = { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, models: [] }
  const queue = [...models]
  const worker = async () => {
    for (;;) {
      const model = queue.shift()
      if (model === undefined) return
      const r = await pingModel(providerId, full, model)
      if (r.status === 'ok') out.ok.push(model)
      else if (r.status === 'dead') out.dead.push(model)
      else if (r.status === 'quota') out.quota.push(model)
      else out.errors.push({ model, error: r.error ?? 'unknown' })
    }
  }
  // Gentle concurrency so validation doesn't self-inflict rate limits (which stay "quota" = kept).
  await Promise.all([worker(), worker(), worker()])
  return out
}

/** Route to the right provider implementation. */
export function providerChat(
  providerId: string,
  cfg: ProviderConfig,
  model: string,
  messages: ChatMessage[],
  handlers: ChatHandlers,
  options?: ChatOptions
): Promise<void> {
  const base = (cfg.baseUrl || DEFAULT_BASE[providerId] || '').replace(/\/+$/, '')
  if (!cfg.apiKey) {
    handlers.onError(`No API key configured for ${providerId}`)
    return Promise.resolve()
  }
  if (!base) {
    handlers.onError(`Unknown provider "${providerId}" and no base URL set`)
    return Promise.resolve()
  }
  if (providerId === 'anthropic') return anthropicChat(base, cfg.apiKey, model, messages, handlers, options)
  return openaiChat(providerId, base, cfg.apiKey, model, messages, handlers, options)
}

/**
 * Extract model ids from a /models response. OpenAI-compatible providers return
 * `{ data: [{ id }] }`; some list under `{ models: [...] }` with `id` or `name` (Gemini's
 * native shape prefixes "models/"). Deduped and sorted for a stable, readable list.
 * Exported for tests.
 */
/** True when a model entry can be positively determined to be free (OpenRouter exposes pricing;
 * some ids carry a ":free" suffix). Providers without pricing info can't be judged here. */
function isFreeModel(m: unknown): boolean {
  const o = m as { id?: string; name?: string; pricing?: { prompt?: string | number; completion?: string | number } }
  const id = o?.id ?? o?.name ?? ''
  if (typeof id === 'string' && /:free\b/i.test(id)) return true
  if (o?.pricing) {
    const p = Number(o.pricing.prompt ?? NaN)
    const c = Number(o.pricing.completion ?? NaN)
    return p === 0 && c === 0
  }
  return false
}

// Drop models that can't hold a text chat: safety/guard classifiers, audio (whisper/tts/
// native-audio/orpheus), embeddings, moderation, rerankers, image/video/music generators
// (dall-e/imagen/veo/lyria/nano-banana), realtime/live streaming, robotics, and computer-use.
// These otherwise pollute the model lists and, if picked, error or reply nonsense (e.g. a
// guard model only ever says "User Safety: safe"). Users can still type a filtered id by hand.
const NON_CHAT_MODEL =
  /guard|safeguard|content-safety|whisper|embed|moderation|rerank|tts|transcrib|dall-?e|imagen|image|veo|lyria|audio|orpheus|playai|robotics|computer-use|nano-banana|realtime|-live\b|deep-research|\baqa\b/i

/** True if a model id looks like a non-chat model (embeddings, audio, image, guard, …). */
export function isNonChatModel(id: string): boolean {
  return NON_CHAT_MODEL.test(id)
}

export function parseModelList(body: unknown, freeOnly = false): string[] {
  const b = body as { data?: unknown[]; models?: unknown[] }
  const arr = Array.isArray(b?.data) ? b.data : Array.isArray(b?.models) ? b.models : []
  const kept = freeOnly ? arr.filter(isFreeModel) : arr
  const ids = kept
    .map((m) => (typeof m === 'string' ? m : (m as { id?: string; name?: string })?.id ?? (m as { name?: string })?.name))
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .map((id) => id.replace(/^models\//, '')) // strip Gemini's "models/" prefix
    .filter((id) => !NON_CHAT_MODEL.test(id))
  return [...new Set(ids)].sort()
}

/**
 * Fetch the model ids a provider currently offers via GET /models. OpenAI-compatible
 * providers use Bearer auth; Anthropic uses x-api-key. Never throws — returns a typed result.
 */
export async function listProviderModels(
  providerId: string,
  cfg: { apiKey: string; baseUrl?: string },
  freeOnly = false
): Promise<CloudModelListResult> {
  const base = (cfg.baseUrl || DEFAULT_BASE[providerId] || '').replace(/\/+$/, '')
  if (!cfg.apiKey) return { ok: false, models: [], error: `No API key configured for ${providerId}` }
  if (!base) return { ok: false, models: [], error: `Unknown provider "${providerId}" and no base URL set` }
  const headers: Record<string, string> =
    providerId === 'anthropic'
      ? { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${cfg.apiKey}` }
  let res: Response
  try {
    res = await fetch(`${base}/models`, { headers })
  } catch (err) {
    return { ok: false, models: [], error: (err as Error).message }
  }
  if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status} ${await safeText(res)}` }
  try {
    const models = parseModelList(await res.json(), freeOnly)
    if (models.length === 0) {
      return {
        ok: false,
        models: [],
        error: freeOnly
          ? 'no models flagged free (this provider may not expose pricing — try Fetch models)'
          : 'no models returned'
      }
    }
    return { ok: true, models }
  } catch (err) {
    return { ok: false, models: [], error: (err as Error).message }
  }
}
