// Transport-free implementations of the MCP tools. Kept free of the MCP SDK so they
// can be unit-tested directly. server.ts wraps these with zod schemas + McpServer.

import {
  addManualHost,
  dedupeSelf,
  inspectInstance,
  mergeInstances,
  scanLan,
  type ScanOptions
} from '../main/discovery'
import { chatStream } from '../main/ollamaClient'
import { runCollaboration, type AgentConfig, type EmittedTurn } from '../main/orchestrator'
import { ProjectFiles } from '../main/fileTools'
import { Notifier, type NotifyLevel } from '../main/notifier'
import { DEFAULT_SETTINGS, type ChatMessage, type ManualHost, type OllamaInstance } from '../shared/types'

/** Log to stderr only — stdout is reserved for the MCP protocol stream. */
export function log(...args: unknown[]): void {
  console.error('[localai-mcp]', ...args)
}

// ---------------------------------------------------------------------------
// Environment-driven configuration
// ---------------------------------------------------------------------------

/** Parse LOCALAI_OLLAMA_HOSTS ("host:port,host:port") into pinned manual hosts. */
export function parsePinnedHosts(raw: string | undefined): ManualHost[] {
  if (!raw) return []
  const hosts: ManualHost[] = []
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const [host, portStr] = trimmed.split(':')
    if (!host) continue
    hosts.push({ host: host.trim(), port: Number(portStr) || 11434 })
  }
  return hosts
}

export interface ToolsConfig {
  /** Pinned hosts always inspected regardless of scan results. */
  pinnedHosts: ManualHost[]
  /** Whether to sweep the LAN during discovery. */
  scanEnabled: boolean
  /** Instance-cache TTL in ms. */
  cacheTtlMs: number
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ToolsConfig {
  return {
    pinnedHosts: parsePinnedHosts(env.LOCALAI_OLLAMA_HOSTS),
    scanEnabled: env.LOCALAI_SCAN !== '0',
    cacheTtlMs: Number(env.LOCALAI_CACHE_TTL_MS) || 30_000
  }
}

// ---------------------------------------------------------------------------
// Cached discovery
// ---------------------------------------------------------------------------

interface Cache {
  instances: OllamaInstance[]
  at: number
}

export class ToolContext {
  private cache: Cache | null = null

  constructor(private readonly config: ToolsConfig) {}

  /** Return known instances, discovering if the cache is stale or `force` is set. */
  async getInstances(force = false): Promise<OllamaInstance[]> {
    const fresh = this.cache && Date.now() - this.cache.at < this.config.cacheTtlMs
    if (fresh && !force) return this.cache!.instances

    const pinned = await Promise.all(this.config.pinnedHosts.map((h) => addManualHost(h)))

    let scanned: OllamaInstance[] = []
    if (this.config.scanEnabled) {
      const opts: ScanOptions = { settings: DEFAULT_SETTINGS, extraTargets: ['127.0.0.1'] }
      scanned = await scanLan(opts)
    } else {
      // Even with scanning off, always check the local machine.
      scanned = [await inspectInstance('127.0.0.1', 11434, 'local', DEFAULT_SETTINGS.connectTimeoutMs)]
    }

    const merged = dedupeSelf(mergeInstances(scanned.filter((i) => i.online), pinned).filter((i) => i.online))
    this.cache = { instances: merged, at: Date.now() }
    return merged
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export interface InstanceSummary {
  id: string
  baseUrl: string
  version?: string
  online: boolean
  modelCount: number
}

export async function listInstances(ctx: ToolContext, rescan = false): Promise<InstanceSummary[]> {
  const instances = await ctx.getInstances(rescan)
  return instances.map((i) => ({
    id: i.id,
    baseUrl: i.baseUrl,
    version: i.version,
    online: i.online,
    modelCount: i.models.length
  }))
}

export interface ModelSummary {
  instanceId: string
  baseUrl: string
  model: string
  parameterSize?: string
}

export async function listModels(ctx: ToolContext, instanceFilter?: string): Promise<ModelSummary[]> {
  const instances = await ctx.getInstances(false)
  const out: ModelSummary[] = []
  for (const inst of instances) {
    if (instanceFilter && inst.id !== instanceFilter && inst.baseUrl !== instanceFilter) continue
    for (const m of inst.models) {
      out.push({ instanceId: inst.id, baseUrl: inst.baseUrl, model: m.name, parameterSize: m.parameterSize })
    }
  }
  return out
}

export interface AskModelArgs {
  baseUrl: string
  model: string
  prompt: string
  system?: string
}

/** Single-shot completion against one local model; collects the streamed reply. */
export async function askModel(args: AskModelArgs): Promise<string> {
  const messages: ChatMessage[] = []
  if (args.system) messages.push({ role: 'system', content: args.system })
  messages.push({ role: 'user', content: args.prompt })

  return new Promise<string>((resolve, reject) => {
    let out = ''
    chatStream(args.baseUrl, args.model, messages, {
      onDelta: (t) => (out += t),
      onDone: () => resolve(out),
      onError: (m) => reject(new Error(m))
    })
  })
}

export interface RoleModel {
  baseUrl: string
  model: string
}

export interface RunTaskArgs {
  task: string
  projectRoot: string
  coder: RoleModel
  planner?: RoleModel
  reviewer?: RoleModel
  maxRounds?: number
}

export interface RunTaskResult {
  summary: string
  filesWritten: string[]
  transcript: Array<{ round: number; role: string; model: string; content: string; filesTouched: string[] }>
}

/** Run the planner/coder/reviewer collaboration and return a structured result. */
export async function runTask(args: RunTaskArgs): Promise<RunTaskResult> {
  const agents: AgentConfig[] = [{ role: 'coder', ...args.coder }]
  if (args.planner) agents.unshift({ role: 'planner', ...args.planner })
  if (args.reviewer) agents.push({ role: 'reviewer', ...args.reviewer })

  const files = new ProjectFiles(args.projectRoot)
  const transcript: RunTaskResult['transcript'] = []
  const filesWritten = new Set<string>()
  let summary = ''
  let error: string | null = null

  await new Promise<void>((resolve) => {
    runCollaboration(
      { task: args.task, projectRoot: args.projectRoot, agents, maxRounds: args.maxRounds ?? 3 },
      { files },
      {
        onTurnStart: () => {},
        onDelta: () => {},
        onTurnEnd: (t: EmittedTurn) => {
          transcript.push({ round: t.round, role: t.role, model: t.model, content: t.content, filesTouched: t.filesTouched })
          t.filesTouched.forEach((f) => filesWritten.add(f))
        },
        onDone: (s) => {
          summary = s
          resolve()
        },
        onError: (m) => {
          error = m
          resolve()
        }
      }
    )
  })

  if (error) throw new Error(error)
  return { summary, filesWritten: [...filesWritten], transcript }
}

/**
 * Post a message to the user's Discord via the configured webhook
 * (env LOCALAI_DISCORD_WEBHOOK). Lets Claude Code send the user progress/questions.
 */
export async function notify(message: string, level: NotifyLevel = 'info'): Promise<{ sent: boolean }> {
  const notifier = new Notifier(process.env.LOCALAI_DISCORD_WEBHOOK, process.env.LOCALAI_DISCORD_MENTION_USER_ID)
  if (!notifier.enabled) return { sent: false }
  await notifier.send(level, message)
  return { sent: true }
}
