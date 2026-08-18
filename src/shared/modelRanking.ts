// Ranks local models so the app (and MCP) can auto-pick the "best" one for a role.
// Pure and dependency-free so it is shared by renderer, main, and the MCP server.

import type { OllamaInstance } from './types'

/** A model paired with the instance that hosts it. */
export interface ModelCandidate {
  instanceId: string
  baseUrl: string
  model: string
  parameterSize?: string
  size?: number
}

/** Names that signal a coding-tuned model, which we prefer for the coder role. */
const CODING_RE = /coder|code|codellama|starcoder|deepseek.*coder|qwen.*coder|granite.*code/i

/**
 * Best-effort parameter count in billions. Reads the reported parameterSize
 * ("14B" -> 14, "1.5B" -> 1.5), else a "<n>b" token in the model tag
 * ("qwen2.5-coder:7b" -> 7), else 0.
 */
export function parseParamB(model: { model: string; parameterSize?: string }): number {
  const fromField = model.parameterSize?.match(/([\d.]+)\s*b/i)
  if (fromField) return Number(fromField[1])
  const fromName = model.model.match(/[:\-]([\d.]+)\s*b\b/i) ?? model.model.match(/\b([\d.]+)\s*b\b/i)
  if (fromName) return Number(fromName[1])
  return 0
}

/** Flatten online instances into per-model candidates. */
export function candidatesFrom(instances: OllamaInstance[]): ModelCandidate[] {
  const out: ModelCandidate[] = []
  for (const inst of instances) {
    if (!inst.online) continue
    for (const m of inst.models) {
      out.push({
        instanceId: inst.id,
        baseUrl: inst.baseUrl,
        model: m.name,
        parameterSize: m.parameterSize,
        size: m.size
      })
    }
  }
  return out
}

export interface PickOptions {
  /** Give coding-tuned models a large ranking bonus (use for the coder role). */
  preferCoding?: boolean
}

/** Score a candidate: params in billions, plus a big bonus for coding models when preferred. */
export function scoreCandidate(c: ModelCandidate, opts: PickOptions = {}): number {
  const params = parseParamB(c)
  const codingBonus = opts.preferCoding && CODING_RE.test(c.model) ? 1000 : 0
  // Params dominate; size (bytes, GB-scale) is a gentle tie-breaker under 1 point.
  const sizeTiebreak = (c.size ?? 0) / 1e12
  return codingBonus + params + sizeTiebreak
}

/**
 * Pick the highest-scoring model from candidates (or a list of instances).
 * Returns null when there are no online models to choose from.
 */
export function pickBestModel(
  source: ModelCandidate[] | OllamaInstance[],
  opts: PickOptions = {}
): ModelCandidate | null {
  const candidates = isInstanceList(source) ? candidatesFrom(source) : source
  if (candidates.length === 0) return null
  return candidates.reduce((best, c) => (scoreCandidate(c, opts) > scoreCandidate(best, opts) ? c : best))
}

function isInstanceList(source: ModelCandidate[] | OllamaInstance[]): source is OllamaInstance[] {
  return source.length > 0 && 'models' in (source[0] as OllamaInstance)
}
