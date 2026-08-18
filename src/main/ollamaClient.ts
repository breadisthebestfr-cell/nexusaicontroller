// Thin wrapper over the Ollama HTTP API.
// Intentionally free of any Electron imports so it can be reused by scripts and tests.
// Docs: https://github.com/ollama/ollama/blob/main/docs/api.md

import type { ChatMessage, ChatStats, OllamaModel } from '../shared/types'

export function baseUrlFor(host: string, port: number): string {
  return `http://${host}:${port}`
}

/** Fetch with an AbortController-backed timeout. */
async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** GET /api/version — returns the version string, or null if unreachable / not Ollama. */
export async function getVersion(baseUrl: string, timeoutMs = 2000): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/api/version`, timeoutMs)
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    return typeof data.version === 'string' ? data.version : null
  } catch {
    return null
  }
}

interface RawTag {
  name: string
  size?: number
  details?: { parameter_size?: string; quantization_level?: string }
}

/** Parse the payload of GET /api/tags into our model shape. Exported for unit testing. */
export function parseTags(payload: unknown): OllamaModel[] {
  const models = (payload as { models?: RawTag[] } | null)?.models
  if (!Array.isArray(models)) return []
  return models
    .filter((m): m is RawTag => !!m && typeof m.name === 'string')
    .map((m) => ({
      name: m.name,
      size: typeof m.size === 'number' ? m.size : undefined,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level
    }))
}

/** GET /api/tags — list installed models. Returns [] on error. */
export async function listModels(baseUrl: string, timeoutMs = 4000): Promise<OllamaModel[]> {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/api/tags`, timeoutMs)
    if (!res.ok) return []
    return parseTags(await res.json())
  } catch {
    return []
  }
}

export interface ChatHandlers {
  onDelta: (text: string) => void
  onDone: () => void
  onError: (message: string) => void
  /** Called once with timing stats when the final chunk reports them. */
  onStats?: (stats: ChatStats) => void
  /** Optional abort signal to cancel an in-flight stream. */
  signal?: AbortSignal
}

/** Parse Ollama's end-of-stream timing fields into ChatStats, or null if absent. */
export function parseStats(obj: {
  eval_count?: number
  eval_duration?: number
  total_duration?: number
}): ChatStats | null {
  if (typeof obj.eval_count !== 'number') return null
  const evalCount = obj.eval_count
  const evalSecs = (obj.eval_duration ?? 0) / 1e9
  return {
    evalCount,
    tokensPerSec: evalSecs > 0 ? evalCount / evalSecs : 0,
    totalMs: (obj.total_duration ?? 0) / 1e6
  }
}

/** Ollama runtime options we expose (subset of the /api/chat `options` object). */
export interface ChatOptions {
  temperature?: number
  num_ctx?: number
}

/** Build the POST /api/chat request body, including `options` only when set. Exported for testing. */
export function buildChatBody(model: string, messages: ChatMessage[], options?: ChatOptions): string {
  const body: Record<string, unknown> = { model, messages, stream: true }
  const opts: ChatOptions = {}
  if (options?.temperature !== undefined) opts.temperature = options.temperature
  if (options?.num_ctx !== undefined) opts.num_ctx = options.num_ctx
  if (Object.keys(opts).length > 0) body.options = opts
  return JSON.stringify(body)
}

/**
 * POST /api/chat with stream:true. Parses the NDJSON stream and invokes handlers.
 * Each line is a JSON object like { message: { content }, done: bool }.
 */
export async function chatStream(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  handlers: ChatHandlers,
  options?: ChatOptions
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildChatBody(model, messages, options),
      signal: handlers.signal
    })
  } catch (err) {
    handlers.onError(errText(err))
    return
  }

  if (!res.ok || !res.body) {
    handlers.onError(`Chat request failed: HTTP ${res.status}`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)
        if (!line) continue
        handleLine(line, handlers)
      }
    }
    const tail = buffer.trim()
    if (tail) handleLine(tail, handlers)
    handlers.onDone()
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      handlers.onDone()
    } else {
      handlers.onError(errText(err))
    }
  }
}

function handleLine(line: string, handlers: ChatHandlers): void {
  let obj: {
    message?: { content?: string }
    error?: string
    done?: boolean
    eval_count?: number
    eval_duration?: number
    total_duration?: number
  }
  try {
    obj = JSON.parse(line)
  } catch {
    return // skip malformed line
  }
  if (obj.error) {
    handlers.onError(obj.error)
    return
  }
  const content = obj.message?.content
  if (content) handlers.onDelta(content)
  if (obj.done && handlers.onStats) {
    const stats = parseStats(obj)
    if (stats) handlers.onStats(stats)
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------------------------------------------------------------------------
// Model management
// ---------------------------------------------------------------------------

/** Parse GET /api/ps into the list of currently-loaded model names. Exported for tests. */
export function parsePs(payload: unknown): string[] {
  const models = (payload as { models?: Array<{ name?: string }> } | null)?.models
  if (!Array.isArray(models)) return []
  return models.map((m) => m?.name).filter((n): n is string => typeof n === 'string')
}

/** GET /api/ps — models currently loaded in memory on this instance. */
export async function listRunningModels(baseUrl: string, timeoutMs = 4000): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/api/ps`, timeoutMs)
    if (!res.ok) return []
    return parsePs(await res.json())
  } catch {
    return []
  }
}

export interface SimpleResult {
  ok: boolean
  error?: string
}

/** DELETE /api/delete — remove an installed model from this instance. */
export async function deleteModel(baseUrl: string, name: string, timeoutMs = 15_000): Promise<SimpleResult> {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/api/delete`, timeoutMs, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/**
 * Load (warm) or unload a model via POST /api/generate with an empty prompt. `keep_alive: 0`
 * unloads it from memory; omitting it loads with Ollama's default idle timeout. Loading a large
 * model off disk can take a while, hence the generous timeout.
 */
export async function setModelLoaded(baseUrl: string, name: string, load: boolean, timeoutMs = 120_000): Promise<SimpleResult> {
  try {
    const body: Record<string, unknown> = { model: name, stream: false }
    if (!load) body.keep_alive = 0
    const res = await fetchWithTimeout(`${baseUrl}/api/generate`, timeoutMs, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    await res.text().catch(() => '') // drain so the socket closes
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

export interface PullHandlers {
  onProgress: (status: string, completed: number, total: number) => void
  onDone: () => void
  onError: (message: string) => void
  signal?: AbortSignal
}

/**
 * POST /api/pull with stream:true. Downloads a model onto the instance, reporting
 * progress. NDJSON lines look like { status, total, completed } or { error }.
 */
export async function pullModel(baseUrl: string, model: string, handlers: PullHandlers): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal: handlers.signal
    })
  } catch (err) {
    handlers.onError(errText(err))
    return
  }
  if (!res.ok || !res.body) {
    handlers.onError(`Pull failed: HTTP ${res.status}`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const handle = (line: string): boolean => {
    let obj: { status?: string; total?: number; completed?: number; error?: string }
    try {
      obj = JSON.parse(line)
    } catch {
      return true
    }
    if (obj.error) {
      handlers.onError(obj.error)
      return false
    }
    handlers.onProgress(obj.status ?? '', obj.completed ?? 0, obj.total ?? 0)
    return true
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (line && !handle(line)) return
      }
    }
    const tail = buffer.trim()
    if (tail) handle(tail)
    handlers.onDone()
  } catch (err) {
    if ((err as Error).name === 'AbortError') handlers.onDone()
    else handlers.onError(errText(err))
  }
}
