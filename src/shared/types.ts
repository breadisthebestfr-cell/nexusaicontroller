// Types shared between the main process, preload, and renderer.
// Keep this file dependency-free so it can be imported from any layer.

export interface OllamaModel {
  /** Full model tag, e.g. "qwen2.5-coder:7b" */
  name: string
  /** Size in bytes, when reported by /api/tags */
  size?: number
  /** Parameter size string, e.g. "7B", when reported */
  parameterSize?: string
  /** Quantization level, e.g. "Q4_K_M", when reported */
  quantization?: string
}

/** Base URL of the Ollama server running on this machine (used by the Ollama tab). */
export const LOCAL_OLLAMA_BASE = 'http://127.0.0.1:11434'

/** Snapshot of the local Ollama server for the Ollama management tab. */
export interface LocalOllamaStatus {
  online: boolean
  version?: string
  models: OllamaModel[]
  /** Names of models currently loaded in memory (from /api/ps). */
  running: string[]
}

export type InstanceSource = 'scan' | 'manual' | 'local' | 'cloud'

/** A configured cloud LLM provider (OpenAI/Anthropic/xAI/OpenAI-compatible). */
export interface CloudProviderConfig {
  /** API key (stored locally only). Empty = provider disabled. */
  apiKey: string
  /** Optional base-URL override (for gateways / OpenAI-compatible endpoints). */
  baseUrl?: string
  /** Model ids to expose for this provider. */
  models: string[]
}

/** Result of fetching a provider's live model list (GET /models). */
export interface CloudModelListResult {
  ok: boolean
  models: string[]
  error?: string
}

export interface OllamaInstance {
  /** Stable id: `${host}:${port}` */
  id: string
  host: string
  port: number
  /** Base URL, e.g. "http://192.168.1.20:11434" */
  baseUrl: string
  online: boolean
  /** Ollama server version reported by /api/version */
  version?: string
  models: OllamaModel[]
  /** Names of models currently loaded in memory (from /api/ps). */
  loaded?: string[]
  /** How this instance was discovered */
  source: InstanceSource
  /** Epoch ms of last successful contact */
  lastSeen?: number
  /** Last error message, if the instance is offline */
  error?: string
}

export type AgentRole = 'planner' | 'coder' | 'reviewer'

/** Per-role sampling temperature. Lower = more deterministic (better for small coders). */
export interface RoleTemperatures {
  planner: number
  coder: number
  reviewer: number
}

/** Optional per-role system-prompt overrides. Empty/absent = use the tuned default. */
export interface PromptOverrides {
  planner?: string
  coder?: string
  reviewer?: string
}

/** Tunables for continuous (autonomous multi-cycle) mode. */
export interface ContinuousSettings {
  /** Hard cap on cycles per session. */
  maxCycles: number
  /** Delay between cycles in ms. */
  cycleDelayMs: number
  /** Pause+flag after this many no-change cycles in a row. */
  stallThreshold: number
  /** Commit the project folder after each changed cycle. */
  gitAutoCommit: boolean
}

export interface AppSettings {
  /** Ports probed during a LAN scan */
  scanPorts: number[]
  /** Per-host TCP connect timeout in ms */
  connectTimeoutMs: number
  /** Max concurrent probes during a scan */
  scanConcurrency: number
  /** Health re-poll interval in ms (0 = disabled) */
  healthPollMs: number
  /** Per-role sampling temperature for collaboration runs */
  temperatures: RoleTemperatures
  /** Per-role system-prompt overrides */
  promptOverrides: PromptOverrides
  /** Continuous-mode tunables */
  continuous: ContinuousSettings
  /** Discord webhook URL for outbound notifications (empty = disabled). */
  discordWebhookUrl: string
  /** Discord user id to @-mention in notifications so they actually ping you (empty = no ping). */
  discordMentionUserId: string
  /** System prompt prepended to 1-on-1 chats to keep replies short and direct. */
  chatSystemPrompt: string
  /** Allow agents to run shell commands at all (off by default). */
  commandsEnabled: boolean
  /** Commands (prefix-matched) that may run without asking. */
  commandAllowlist: string[]
  /** Per-command timeout in ms. */
  commandTimeoutMs: number
  /** Cloud providers keyed by id (openai, anthropic, xai, …). */
  cloudProviders: Record<string, CloudProviderConfig>
  /** Jarvis (desktop assistant) settings. */
  assistantName: string
  jarvisSafetyMode: 'allowlist' | 'trust'
  /** Known apps Jarvis may open: display name → launch command/path. */
  jarvisApps: Record<string, string>
  /** Local/LAN HTTP control server settings. */
  localControl: LocalControlSettings
}

/** Opt-in HTTP control server so you can drive Nexus from a browser or script on your LAN. */
export interface LocalControlSettings {
  /** Master switch — the server only runs when true. */
  enabled: boolean
  /** TCP port to listen on. */
  port: number
  /** Shared secret required on every request (generated when first enabled). */
  token: string
  /** Bind to 0.0.0.0 (reachable from other devices on the LAN) vs 127.0.0.1 (this PC only). */
  lan: boolean
}

/** One desktop action the assistant requested. */
export interface JarvisAction {
  name: string
  args: Record<string, unknown>
}

/** Result of executing a Jarvis action. */
export interface JarvisOutcome {
  action: string
  ok: boolean
  message: string
}

// NOTE: model ids change over time — these are best-effort defaults; verify/replace them in
// Settings against each provider's current docs.
export const DEFAULT_CLOUD_PROVIDERS: Record<string, CloudProviderConfig> = {
  openai: { apiKey: '', models: ['gpt-4o', 'gpt-4o-mini'] },
  anthropic: { apiKey: '', models: ['claude-sonnet-5', 'claude-haiku-4-5-20251001'] },
  xai: { apiKey: '', models: ['grok-2-latest'] },
  // The three below all speak the OpenAI-compatible wire format, so they route through the
  // same streaming path as OpenAI (see providers.ts DEFAULT_BASE). Model ids go stale — update
  // them in Settings from each provider's current docs if a call 404s.
  gemini: { apiKey: '', models: ['gemini-3.5-flash-lite'] },
  groq: { apiKey: '', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
  openrouter: { apiKey: '', models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'] },
  cerebras: { apiKey: '', models: ['llama-3.3-70b'] },
  mistral: { apiKey: '', models: ['mistral-small-latest'] }
}

/** Result of an agent command request (ran, skipped, or denied). */
export interface CommandOutcome {
  command: string
  approved: boolean
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** Set when the command did not run (disabled / unsafe / denied / not allowlisted). */
  skippedReason?: string
}

export const DEFAULT_CHAT_SYSTEM_PROMPT =
  'You are a concise, direct assistant. Start with a brief acknowledgement (e.g. "On it.") when asked to ' +
  'do something, then give just what is needed. Prefer short replies; expand only when the question truly ' +
  'requires it. No filler, no repetition, no restating the question.'

export const DEFAULT_CONTINUOUS: ContinuousSettings = {
  maxCycles: 50,
  cycleDelayMs: 3000,
  stallThreshold: 3,
  gitAutoCommit: true
}

export interface ManualHost {
  host: string
  port: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  baseUrl: string
  model: string
  messages: ChatMessage[]
}

/** Timing/throughput stats reported at the end of a generation. */
export interface ChatStats {
  tokensPerSec: number
  evalCount: number
  totalMs: number
}

/** Streaming chat chunk pushed from main to renderer. */
export interface ChatChunk {
  /** Correlates chunks belonging to one streamed response */
  requestId: string
  /** Incremental token text */
  delta?: string
  done: boolean
  error?: string
  /** Present on the final chunk when the model reported timing stats. */
  stats?: ChatStats
}

export interface ScanProgress {
  scanned: number
  total: number
  found: number
  done: boolean
}

export const DEFAULT_TEMPERATURES: RoleTemperatures = {
  planner: 0.5,
  coder: 0.2,
  reviewer: 0.2
}

export const DEFAULT_SETTINGS: AppSettings = {
  scanPorts: [11434],
  connectTimeoutMs: 400,
  scanConcurrency: 128,
  healthPollMs: 15000,
  temperatures: DEFAULT_TEMPERATURES,
  promptOverrides: {},
  continuous: DEFAULT_CONTINUOUS,
  discordWebhookUrl: '',
  discordMentionUserId: '',
  chatSystemPrompt: DEFAULT_CHAT_SYSTEM_PROMPT,
  commandsEnabled: false,
  commandAllowlist: [],
  commandTimeoutMs: 60000,
  cloudProviders: DEFAULT_CLOUD_PROVIDERS,
  assistantName: 'Jarvis',
  jarvisSafetyMode: 'allowlist',
  jarvisApps: { Notepad: 'notepad', Firefox: 'firefox', Calculator: 'calc', Explorer: 'explorer' },
  localControl: { enabled: false, port: 8765, token: '', lan: true }
}

// ---------------------------------------------------------------------------
// Multi-agent orchestration (V2)
// ---------------------------------------------------------------------------

/** One participating model, bound to an instance and assigned a role. */
export interface AgentConfig {
  role: AgentRole
  /** Base URL of the Ollama instance hosting this agent's model. */
  baseUrl: string
  model: string
}

/** Request the renderer sends to start a collaboration run. */
export interface OrchestratorRunRequest {
  task: string
  agents: AgentConfig[]
  /** Hard cap on coder/reviewer rounds to prevent runaway loops. */
  maxRounds: number
  /** When true, the model may ask the user clarifying questions before starting (single mode only). */
  clarify?: boolean
}

/** A completed message in the shared collaboration transcript. */
export interface AgentTurn {
  runId: string
  round: number
  role: AgentRole
  model: string
  content: string
  /** Files this turn created or modified, relative to the project root. */
  filesTouched: string[]
  at: number
}

export interface OrchestratorTurnStart {
  runId: string
  round: number
  role: AgentRole
  model: string
}

export interface OrchestratorDelta {
  runId: string
  round: number
  role: AgentRole
  delta: string
}

export interface OrchestratorDone {
  runId: string
  summary: string
}

export interface OrchestratorError {
  runId: string
  message: string
}

export const DEFAULT_MAX_ROUNDS = 3

// ---------------------------------------------------------------------------
// Run history (V4)
// ---------------------------------------------------------------------------

export type RunStatus = 'completed' | 'error' | 'cancelled'

/** A model that participated in a run, as recorded in history. */
export interface RunAgent {
  role: AgentRole
  model: string
  baseUrl: string
}

/** Full persisted record of a collaboration run. */
export interface RunRecord {
  id: string
  startedAt: number
  endedAt: number
  status: RunStatus
  task: string
  projectRoot: string
  agents: RunAgent[]
  summary: string
  error?: string
  filesWritten: string[]
  transcript: AgentTurn[]
  /** Set when this run is one cycle of a continuous session. */
  sessionId?: string
}

/** Lightweight entry used in the history list. */
export interface RunSummary {
  id: string
  startedAt: number
  endedAt: number
  status: RunStatus
  task: string
  fileCount: number
  sessionId?: string
}

// ---------------------------------------------------------------------------
// Continuous mode (V5)
// ---------------------------------------------------------------------------

/** A role assignment from the UI: an explicit model, or "auto" to pick the best. */
export type RoleChoice = { auto: true } | { auto: false; baseUrl: string; model: string }

/** Request the renderer sends to start a continuous session. */
export interface ContinuousStartRequest {
  goal: string
  coder: RoleChoice
  planner?: RoleChoice
  reviewer?: RoleChoice
}

export type ContinuousStopReason = 'goal-complete' | 'stalled' | 'max-cycles' | 'stopped' | 'error'

export interface ContinuousCycleStart {
  sessionId: string
  cycle: number
  step: string
}

export interface ContinuousCycleEnd {
  sessionId: string
  cycle: number
  step: string
  filesWritten: string[]
  commit: string | null
  verdict: string
}

export interface ContinuousDone {
  sessionId: string
  reason: ContinuousStopReason
  cycles: number
  message: string
}
