import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { promises as fsp } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { IPC } from '../shared/ipc'
import {
  DEFAULT_SETTINGS,
  DEFAULT_MAX_ROUNDS,
  LOCAL_OLLAMA_BASE,
  type AgentRole,
  type AgentTurn,
  type ChatChunk,
  type ChatMessage,
  type ContinuousStartRequest,
  type LocalOllamaStatus,
  type ManualHost,
  type OllamaInstance,
  type OrchestratorRunRequest,
  type RoleChoice,
  type RunRecord,
  type ScanProgress
} from '../shared/types'
import { pickBestModel, candidatesFrom, scoreCandidate, type ModelCandidate } from '../shared/modelRanking'
import {
  addManualHost as inspectManual,
  dedupeSelf,
  inspectInstance,
  mergeInstances,
  refreshInstances,
  scanLan
} from './discovery'
import { pullModel, getVersion, listModels, listRunningModels, deleteModel, setModelLoaded } from './ollamaClient'
import { chat } from './chat'
import { listProviderModels, isQuotaError } from './providers'
import { startControlServer, type ControlServer } from './controlServer'
import { runCollaboration, type AgentConfig, type AskFn, type ToolExecutor } from './orchestrator'
import { ProjectFiles, resolveInRoot } from './fileTools'
import { isAllowed, isSafeCommand, runCommand as execCommand } from './commands'
import { showCommit } from './git'
import { buildJarvisSystemPrompt, IMPLEMENTED_ACTIONS, isSafeAction, parseActions, stripActions } from './actions'
import * as desktop from './desktop'
import os from 'node:os'
import type { CommandOutcome, JarvisOutcome } from '../shared/types'
import { runContinuous, type ContinuousAgents } from './continuous'
import { Notifier } from './notifier'
import * as runStore from './runStore'
import * as store from './store'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

// In-memory view of everything we currently know about.
let instances: OllamaInstance[] = []
// Active chat streams keyed by requestId, so the renderer can cancel them.
const activeChats = new Map<string, AbortController>()
// Active orchestrator runs keyed by runId.
const activeRuns = new Map<string, AbortController>()
// Active continuous sessions keyed by sessionId.
const activeSessions = new Map<string, AbortController>()
// Active model pulls keyed by pullId, and the current LAN scan (if any).
const activePulls = new Map<string, AbortController>()
let scanController: AbortController | null = null
// Pending command-approval requests keyed by approvalId → resolver.
type ApprovalDecision = 'approve' | 'always' | 'deny'
const pendingApprovals = new Map<string, (decision: ApprovalDecision) => void>()
// Pending orchestrator clarifying-question requests keyed by askId → resolver.
const pendingQuestions = new Map<string, (answers: string[]) => void>()

/** Ask the renderer to answer the orchestrator's clarifying questions; resolves with answers. */
function requestUserAnswers(questions: string[]): Promise<string[]> {
  const askId = randomUUID()
  return new Promise((resolve) => {
    pendingQuestions.set(askId, resolve)
    send(IPC.evtOrchestratorAsk, { askId, questions })
  })
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

/** Configured cloud providers, presented as pseudo-instances alongside Ollama ones. */
function cloudInstances(): OllamaInstance[] {
  const out: OllamaInstance[] = []
  for (const [id, cfg] of Object.entries(store.getSettings().cloudProviders)) {
    if (!cfg.apiKey || cfg.models.length === 0) continue
    out.push({
      id: `cloud:${id}`,
      host: id,
      port: 0,
      baseUrl: `cloud:${id}`,
      online: true,
      version: 'cloud',
      models: cfg.models.map((m) => ({ name: m })),
      source: 'cloud',
      lastSeen: Date.now()
    })
  }
  return out
}

/** Ollama (discovered) + cloud (configured) instances, with self-duplicates collapsed. */
function allInstances(): OllamaInstance[] {
  return [...dedupeSelf(instances), ...cloudInstances()]
}

function publishInstances(): void {
  send(IPC.evtInstances, allInstances())
}

/** Ask function that routes cloud vs Ollama, used for orchestrator + continuous runs. */
const unifiedAsk: AskFn = (agent, messages, onDelta, signal, options) =>
  new Promise<string>((resolve, reject) => {
    let out = ''
    chat(
      agent.baseUrl,
      agent.model,
      messages,
      {
        signal,
        onDelta: (t) => {
          out += t
          onDelta(t)
        },
        onDone: () => resolve(out),
        onError: (m) => reject(new Error(m))
      },
      options
    )
  })

/** Best available model NOT already tried, skipping the exhausted provider/instance entirely. */
function pickFallback(failed: AgentConfig, tried: Set<string>): ModelCandidate | null {
  const usable = candidatesFrom(allInstances()).filter(
    (c) => !tried.has(`${c.baseUrl}|${c.model}`) && c.baseUrl !== failed.baseUrl
  )
  if (usable.length === 0) return null
  const preferCoding = failed.role === 'coder'
  return usable.reduce((best, c) => (scoreCandidate(c, { preferCoding }) > scoreCandidate(best, { preferCoding }) ? c : best))
}

/**
 * Wraps unifiedAsk with credit/rate-limit failover: if a model errors with a quota error
 * BEFORE it has streamed anything, switch to the next-best available model and retry. Once
 * output has started, a later error is surfaced normally (retrying would duplicate text).
 */
const resilientAsk: AskFn = async (agent, messages, onDelta, signal, options) => {
  const tried = new Set<string>([`${agent.baseUrl}|${agent.model}`])
  let current = agent
  let streamed = false
  const trackDelta = (t: string) => {
    streamed = true
    onDelta(t)
  }
  for (;;) {
    try {
      return await unifiedAsk(current, messages, trackDelta, signal, options)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (signal?.aborted || streamed || !isQuotaError(msg)) throw err
      const next = pickFallback(current, tried)
      if (!next) throw err
      tried.add(`${next.baseUrl}|${next.model}`)
      onDelta(`\n[⚠ ${current.model} hit a quota/credit limit — switching to ${next.model}]\n`)
      current = { ...current, baseUrl: next.baseUrl, model: next.model }
    }
  }
}

/** Single non-streaming completion (used by the control server's /api/chat). */
function completeOnce(baseUrl: string, model: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = ''
    chat(baseUrl, model, [{ role: 'user', content: prompt }], {
      onDelta: (t) => (out += t),
      onDone: () => resolve(out),
      onError: (m) => reject(new Error(m))
    })
  })
}

/** Auto-assign the best available models to planner/coder/reviewer (for control-triggered runs). */
function autoAgents(): AgentConfig[] {
  const insts = allInstances()
  const coder = pickBestModel(insts, { preferCoding: true })
  const lead = pickBestModel(insts)
  const agents: AgentConfig[] = []
  if (lead) agents.push({ role: 'planner', baseUrl: lead.baseUrl, model: lead.model })
  if (coder) agents.push({ role: 'coder', baseUrl: coder.baseUrl, model: coder.model })
  if (lead) agents.push({ role: 'reviewer', baseUrl: lead.baseUrl, model: lead.model })
  return agents
}

/**
 * Start a planner→coder→reviewer run and stream its events to the renderer + persist it.
 * Returns a runId, or null if no project folder is set. Shared by the IPC handler and the
 * control server. `clarify` is honored only when a UI is present to answer (the IPC path).
 */
function startOrchestratorRun(req: OrchestratorRunRequest): string | null {
  const folder = store.getProjectFolder()
  if (!folder) return null
  if (!req.agents.some((a) => a.role === 'coder')) return null

  const runId = randomUUID()
  const controller = new AbortController()
  activeRuns.set(runId, controller)

  const tools: ToolExecutor = {
    files: new ProjectFiles(folder),
    runCommand: store.getSettings().commandsEnabled ? interactiveRunCommand : undefined
  }
  const settings = store.getSettings()

  const startedAt = Date.now()
  const collectedTurns: AgentTurn[] = []
  const filesWritten = new Set<string>()

  const persist = (status: RunRecord['status'], summary: string, error?: string) => {
    const record: RunRecord = {
      id: runId,
      startedAt,
      endedAt: Date.now(),
      status,
      task: req.task,
      projectRoot: folder,
      agents: req.agents.map((a) => ({ role: a.role, model: a.model, baseUrl: a.baseUrl })),
      summary,
      error,
      filesWritten: [...filesWritten],
      transcript: collectedTurns
    }
    runStore.saveRun(record).catch((e) => console.error('[history] save failed:', e))
  }

  setImmediate(() => {
    runCollaboration(
      {
        task: req.task,
        projectRoot: folder,
        agents: req.agents,
        maxRounds: req.maxRounds,
        prompts: settings.promptOverrides,
        temperatures: settings.temperatures
      },
      tools,
      {
        signal: controller.signal,
        onTurnStart: (meta) => send(IPC.evtOrchTurnStart, { runId, ...meta }),
        onDelta: (round, role, delta) => send(IPC.evtOrchDelta, { runId, round, role, delta }),
        onTurnEnd: (turn) => {
          collectedTurns.push({ runId, ...turn })
          turn.filesTouched.forEach((f) => filesWritten.add(f))
          send(IPC.evtOrchTurnEnd, { runId, ...turn })
        },
        onDone: (summary) => {
          const cancelled = controller.signal.aborted
          activeRuns.delete(runId)
          persist(cancelled ? 'cancelled' : 'completed', summary)
          send(IPC.evtOrchDone, { runId, summary })
        },
        onError: (message) => {
          activeRuns.delete(runId)
          persist('error', 'Run failed.', message)
          send(IPC.evtOrchError, { runId, message })
        }
      },
      { ask: resilientAsk, askUser: req.clarify ? requestUserAnswers : undefined }
    )
  })

  return runId
}

// --- Local/LAN control server lifecycle ---
let controlServer: ControlServer | null = null
let controlError: string | null = null

/** Start/stop/restart the HTTP control server to match current settings. Generates a token on first enable. */
async function applyControlServer(): Promise<void> {
  if (controlServer) {
    await controlServer.stop().catch(() => {})
    controlServer = null
  }
  controlError = null
  const lc = store.getSettings().localControl
  if (!lc.enabled) return
  if (!lc.token) store.setSettings({ localControl: { ...lc, token: randomUUID() } })
  const cur = store.getSettings().localControl
  try {
    controlServer = await startControlServer(cur.lan ? '0.0.0.0' : '127.0.0.1', cur.port, {
      token: cur.token,
      getInstances: allInstances,
      listRuns: () => runStore.listRuns(),
      getProjectFolder: () => store.getProjectFolder(),
      complete: completeOnce,
      startRun: (task) => startOrchestratorRun({ task, agents: autoAgents(), maxRounds: DEFAULT_MAX_ROUNDS })
    })
    console.log(`[control] listening on ${cur.lan ? '0.0.0.0' : '127.0.0.1'}:${cur.port}`)
  } catch (err) {
    const msg = (err as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `port ${cur.port} is already in use` : (err as Error).message
    controlError = `Couldn't start: ${msg}`
    console.error('[control] failed to start:', err)
  }
}

/** Local IPv4 addresses, for showing reachable control URLs in Settings. */
function localIps(): string[] {
  const ips: string[] = []
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) ips.push(info.address)
    }
  }
  return ips
}

// --- Live health polling ---
let healthTimer: NodeJS.Timeout | null = null
let polling = false

/** (Re)start the background health poll from current settings. Safe to call repeatedly. */
function restartHealthPolling(): void {
  if (healthTimer) {
    clearInterval(healthTimer)
    healthTimer = null
  }
  const { healthPollMs, connectTimeoutMs } = store.getSettings()
  if (!healthPollMs || healthPollMs <= 0) return

  healthTimer = setInterval(async () => {
    if (polling || instances.length === 0) return // skip overlaps / nothing to poll
    polling = true
    try {
      instances = await refreshInstances(instances, connectTimeoutMs)
      publishInstances()
    } catch {
      // Ignore transient poll errors; the next tick retries.
    } finally {
      polling = false
    }
  }, healthPollMs)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'Nexus',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

// --- Command execution + approval helpers ---

function skipOutcome(command: string, reason: string): CommandOutcome {
  return { command, approved: false, code: null, stdout: '', stderr: '', timedOut: false, skippedReason: reason }
}

async function runInProject(command: string): Promise<CommandOutcome> {
  const folder = store.getProjectFolder()
  if (!folder) return skipOutcome(command, 'no project folder')
  const res = await execCommand(command, folder, store.getSettings().commandTimeoutMs)
  return { command, approved: true, code: res.code, stdout: res.stdout, stderr: res.stderr, timedOut: res.timedOut }
}

/** Ask the renderer to approve a command; resolves with the user's decision. */
function requestApproval(command: string): Promise<ApprovalDecision> {
  const approvalId = randomUUID()
  return new Promise((resolve) => {
    pendingApprovals.set(approvalId, resolve)
    send(IPC.evtCommandApprovalRequest, { approvalId, command })
  })
}

/** Interactive executor: allowlisted commands auto-run; otherwise prompt Approve/Always/Deny. */
async function interactiveRunCommand(command: string): Promise<CommandOutcome> {
  const s = store.getSettings()
  if (!s.commandsEnabled) return skipOutcome(command, 'commands disabled in Settings')
  if (!isSafeCommand(command)) return skipOutcome(command, 'unsafe: shell metacharacters not allowed')
  if (isAllowed(command, s.commandAllowlist)) return runInProject(command)
  const decision = await requestApproval(command)
  if (decision === 'deny') return skipOutcome(command, 'denied by user')
  if (decision === 'always') store.setSettings({ commandAllowlist: [...s.commandAllowlist, command.trim()] })
  return runInProject(command)
}

/** Autonomous executor (continuous/bot): allowlist only, never prompts. */
async function autonomousRunCommand(command: string): Promise<CommandOutcome> {
  const s = store.getSettings()
  if (!s.commandsEnabled) return skipOutcome(command, 'commands disabled')
  if (!isSafeCommand(command)) return skipOutcome(command, 'unsafe command')
  if (!isAllowed(command, s.commandAllowlist)) return skipOutcome(command, 'not allowlisted (autonomous mode)')
  return runInProject(command)
}

/** Execute one Jarvis action, gated by the safety mode (reuses the command approval modal). */
async function runJarvisAction(action: { name: string; args: Record<string, unknown> }): Promise<JarvisOutcome> {
  const s = store.getSettings()
  if (!(IMPLEMENTED_ACTIONS as readonly string[]).includes(action.name)) {
    return { action: action.name, ok: false, message: `"${action.name}" needs desktop automation on your PC — coming in Stage 2.` }
  }

  // Decide whether this action needs the user's approval.
  let needsApproval = false
  if (s.jarvisSafetyMode !== 'trust') {
    if (!isSafeAction(action.name)) needsApproval = true
    if (action.name === 'open_app' && !desktop.isKnownApp(String(action.args.name ?? ''), s.jarvisApps)) needsApproval = true
  }
  if (needsApproval) {
    const decision = await requestApproval(`Jarvis wants to: ${action.name} ${JSON.stringify(action.args)}`)
    if (decision === 'deny') return { action: action.name, ok: false, message: 'you denied this action' }
  }

  switch (action.name) {
    case 'open_url':
      return desktop.openUrl(action.args.url)
    case 'open_app':
      return desktop.openApp(action.args.name, s.jarvisApps)
    case 'create_document':
      return desktop.createDocument(action.args, action.args.open !== false)
    case 'say':
      return { action: 'say', ok: true, message: String(action.args.text ?? '') }
    case 'run_command': {
      const cmd = String(action.args.command ?? '')
      if (!isSafeCommand(cmd)) return { action: 'run_command', ok: false, message: 'unsafe command blocked' }
      const res = await execCommand(cmd, os.homedir(), s.commandTimeoutMs)
      const out = [res.stdout, res.stderr].filter((x) => x.trim()).join('\n').slice(0, 300)
      return { action: 'run_command', ok: res.code === 0, message: `exit ${res.code}${out ? `: ${out}` : ''}` }
    }
    default:
      return { action: action.name, ok: false, message: 'unknown action' }
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getInstances, () => allInstances())

  ipcMain.handle(IPC.commandApprove, (_e, args: { approvalId: string; decision: ApprovalDecision }) => {
    const resolve = pendingApprovals.get(args.approvalId)
    if (resolve) {
      pendingApprovals.delete(args.approvalId)
      resolve(args.decision)
    }
    return true
  })

  ipcMain.handle(IPC.getSettings, () => store.getSettings())

  ipcMain.handle(IPC.setSettings, (_e, patch) => {
    store.setSettings(patch)
    // Generate a control token as soon as it's enabled, so the UI can show the URL right away.
    const lc = store.getSettings().localControl
    if (lc.enabled && !lc.token) store.setSettings({ localControl: { ...lc, token: randomUUID() } })
    restartHealthPolling() // pick up a changed poll interval immediately
    publishInstances() // reflect any cloud-provider changes
    applyControlServer() // start/stop/restart the control server to match
    return store.getSettings()
  })

  ipcMain.handle(IPC.getControlInfo, () => {
    const lc = store.getSettings().localControl
    const hosts = lc.lan ? ['127.0.0.1', ...localIps()] : ['127.0.0.1']
    const urls = lc.token ? hosts.map((h) => `http://${h}:${lc.port}/?token=${lc.token}`) : []
    return { enabled: lc.enabled, running: !!controlServer, port: lc.port, lan: lc.lan, token: lc.token, urls, error: controlError }
  })

  // Fetch a cloud provider's live model list with the (possibly unsaved) key from the UI.
  ipcMain.handle(
    IPC.listProviderModels,
    (_e, args: { providerId: string; apiKey: string; baseUrl?: string; freeOnly?: boolean }) =>
      listProviderModels(args.providerId, { apiKey: args.apiKey, baseUrl: args.baseUrl }, args.freeOnly)
  )

  // Open a URL in the user's default browser (used by the "free API keys" links).
  ipcMain.handle(IPC.openExternal, (_e, url: string): Promise<void> => shell.openExternal(url))

  ipcMain.handle(IPC.getProjectFolder, () => store.getProjectFolder())

  ipcMain.handle(IPC.pickFolder, async () => {
    if (!mainWindow) return store.getProjectFolder()
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select a project folder for your local AIs',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return store.getProjectFolder()
    store.setProjectFolder(result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.scanCancel, () => {
    scanController?.abort()
    return true
  })

  ipcMain.handle(IPC.scanLan, async () => {
    const settings = store.getSettings()
    scanController = new AbortController()
    const found = await scanLan({
      settings,
      signal: scanController.signal,
      // Always include this machine's loopback so local Ollama is discovered too.
      extraTargets: ['127.0.0.1'],
      onProgress: (scanned, total, foundCount) => {
        const progress: ScanProgress = { scanned, total, found: foundCount, done: scanned >= total }
        send(IPC.evtScanProgress, progress)
      }
    })
    scanController = null
    // Re-verify saved manual hosts alongside the scan results.
    const manual = await Promise.all(
      store.getManualHosts().map((h) => inspectManual(h, settings.connectTimeoutMs))
    )
    // Reconcile: a previously-known host the scan no longer sees may have gone offline.
    // Re-inspect those so their status updates instead of lingering as stale "online".
    const seen = new Set([...found, ...manual].map((i) => i.id))
    const stale = instances.filter((i) => !seen.has(i.id))
    const rechecked = await refreshInstances(stale, settings.connectTimeoutMs)

    instances = mergeInstances(instances, mergeInstances(mergeInstances(found, manual), rechecked))
    publishInstances()
    return instances
  })

  ipcMain.handle(IPC.refreshInstance, async (_e, id: string) => {
    const target = instances.find((i) => i.id === id)
    if (!target) return instances
    const refreshed = await inspectInstance(
      target.host,
      target.port,
      target.source,
      store.getSettings().connectTimeoutMs
    )
    instances = mergeInstances(instances, [refreshed])
    publishInstances()
    return instances
  })

  ipcMain.handle(IPC.addManualHost, async (_e, host: ManualHost) => {
    store.addManualHost(host)
    const inst = await inspectManual(host, store.getSettings().connectTimeoutMs)
    instances = mergeInstances(instances, [inst])
    publishInstances()
    return instances
  })

  ipcMain.handle(IPC.removeManualHost, (_e, host: ManualHost) => {
    store.removeManualHost(host)
    const id = `${host.host}:${host.port}`
    instances = instances.filter((i) => i.id !== id)
    publishInstances()
    return instances
  })

  ipcMain.handle(
    IPC.chatStart,
    (_e: IpcMainInvokeEvent, args: { baseUrl: string; model: string; messages: ChatMessage[] }) => {
      const requestId = randomUUID()
      const controller = new AbortController()
      activeChats.set(requestId, controller)

      const emit = (chunk: ChatChunk) => send(IPC.evtChatChunk, chunk)

      // Defer one tick so this handler returns `requestId` to the renderer BEFORE the first
      // delta is emitted — otherwise the renderer can't correlate it yet and drops early tokens.
      let lastStats: import('../shared/types').ChatStats | undefined
      setImmediate(() => {
        chat(args.baseUrl, args.model, args.messages, {
          signal: controller.signal,
          onDelta: (delta) => emit({ requestId, delta, done: false }),
          onStats: (stats) => (lastStats = stats),
          onDone: () => {
            activeChats.delete(requestId)
            emit({ requestId, done: true, stats: lastStats })
          },
          onError: (error) => {
            activeChats.delete(requestId)
            emit({ requestId, done: true, error })
          }
        })
      })

      return requestId
    }
  )

  ipcMain.handle(IPC.chatCancel, (_e, requestId: string) => {
    activeChats.get(requestId)?.abort()
    activeChats.delete(requestId)
    return true
  })

  // --- Multi-agent orchestrator (V2) ---

  ipcMain.handle(IPC.orchestratorStart, (_e, req: OrchestratorRunRequest): string | null => startOrchestratorRun(req))

  ipcMain.handle(IPC.orchestratorCancel, (_e, runId: string) => {
    activeRuns.get(runId)?.abort()
    activeRuns.delete(runId)
    return true
  })

  ipcMain.handle(IPC.orchestratorAnswer, (_e, args: { askId: string; answers: string[] }) => {
    const resolve = pendingQuestions.get(args.askId)
    if (resolve) {
      pendingQuestions.delete(args.askId)
      resolve(args.answers)
    }
    return true
  })

  ipcMain.handle(IPC.readProjectFile, async (_e, relPath: string): Promise<string | null> => {
    const folder = store.getProjectFolder()
    if (!folder) return null
    try {
      return await new ProjectFiles(folder).read(relPath)
    } catch {
      return null
    }
  })

  // --- Run history (V4) ---

  ipcMain.handle(IPC.historyList, () => runStore.listRuns())
  ipcMain.handle(IPC.historyGet, (_e, id: string) => runStore.getRun(id))
  ipcMain.handle(IPC.historyDelete, (_e, id: string) => runStore.deleteRun(id))
  ipcMain.handle(IPC.historyClear, () => runStore.clearRuns())

  // Read a file that a run wrote, sandboxed to that run's saved project root.
  ipcMain.handle(
    IPC.historyReadFile,
    async (_e, args: { id: string; relPath: string }): Promise<string | null> => {
      const record = await runStore.getRun(args.id)
      if (!record) return null
      try {
        return await new ProjectFiles(record.projectRoot).read(args.relPath)
      } catch {
        return null
      }
    }
  )

  // --- Continuous mode (V5) ---

  ipcMain.handle(IPC.continuousStart, (_e, req: ContinuousStartRequest): string | null => {
    const folder = store.getProjectFolder()
    if (!folder) return null

    const coder = resolveRole('coder', req.coder)
    if (!coder) return null // no coder resolvable (no online models / bad choice)
    const planner = resolveRole('planner', req.planner)
    const reviewer = resolveRole('reviewer', req.reviewer)
    const agents: ContinuousAgents = { coder, planner: planner ?? undefined, reviewer: reviewer ?? undefined }

    const sessionId = randomUUID()
    const controller = new AbortController()
    activeSessions.set(sessionId, controller)

    const settings = store.getSettings()
    const runAgents = [coder, planner, reviewer].filter((a): a is AgentConfig => a !== null)
    const notifier = new Notifier(settings.discordWebhookUrl, settings.discordMentionUserId)
    notifier.send('info', `Continuous session started: ${req.goal}`)

    setImmediate(() => {
      runContinuous(
        {
          goal: req.goal,
          projectRoot: folder,
          agents,
          maxCycles: settings.continuous.maxCycles,
          cycleDelayMs: settings.continuous.cycleDelayMs,
          stallThreshold: settings.continuous.stallThreshold,
          gitAutoCommit: settings.continuous.gitAutoCommit,
          prompts: settings.promptOverrides,
          temperatures: settings.temperatures,
          runCommand: settings.commandsEnabled ? autonomousRunCommand : undefined
        },
        {
          signal: controller.signal,
          onCycleStart: (cycle, step) => send(IPC.evtContCycleStart, { sessionId, cycle, step }),
          onTurn: (cycle, turn) => send(IPC.evtContTurn, { sessionId, cycle, ...turn }),
          onCycleEnd: (result) => {
            // Persist each cycle as a history run tagged with this session.
            const now = Date.now()
            const record: RunRecord = {
              id: `${sessionId}-c${result.cycle}`,
              startedAt: now,
              endedAt: now,
              status: 'completed',
              task: `[cycle ${result.cycle}] ${result.step}`,
              projectRoot: folder,
              agents: runAgents.map((a) => ({ role: a.role, model: a.model, baseUrl: a.baseUrl })),
              summary: `${result.filesWritten.length} file(s); commit ${result.commit ?? 'none'}`,
              filesWritten: result.filesWritten,
              transcript: result.transcript.map((t) => ({ runId: sessionId, ...t })),
              sessionId
            }
            runStore.saveRun(record).catch((e) => console.error('[history] cycle save failed:', e))
            notifier.send(
              'info',
              `Cycle ${result.cycle}: ${result.step} — ${result.filesWritten.length} file(s), commit ${result.commit ?? 'none'}`
            )
            send(IPC.evtContCycleEnd, { sessionId, ...result, transcript: undefined })
          },
          onDone: (reason, cycles, message) => {
            activeSessions.delete(sessionId)
            notifier.send(reason === 'error' ? 'error' : reason === 'goal-complete' ? 'success' : 'warn', `Session ended (${reason}) after ${cycles} cycle(s): ${message}`)
            send(IPC.evtContDone, { sessionId, reason, cycles, message })
          },
          onError: (message) => {
            notifier.send('error', `Continuous error: ${message}`)
            send(IPC.evtContError, { sessionId, message })
          }
        },
        { ask: resilientAsk } // route cloud vs Ollama per agent, with credit-exhaustion failover
      )
    })

    return sessionId
  })

  ipcMain.handle(IPC.commitDiff, async (_e, sha: string): Promise<string | null> => {
    const folder = store.getProjectFolder()
    if (!folder) return null
    return showCommit(folder, sha)
  })

  // --- Jarvis (desktop assistant) ---
  ipcMain.handle(
    IPC.jarvisSend,
    (_e, args: { message: string; history?: ChatMessage[]; baseUrl: string; model: string }): string => {
      const turnId = randomUUID()
      const s = store.getSettings()
      const sys = buildJarvisSystemPrompt(s.assistantName, s.jarvisApps, s.jarvisSafetyMode)
      const messages: ChatMessage[] = [
        { role: 'system', content: sys },
        ...(args.history ?? []),
        { role: 'user', content: args.message }
      ]

      setImmediate(async () => {
        let full = ''
        try {
          await new Promise<void>((resolve, reject) => {
            chat(args.baseUrl, args.model, messages, {
              onDelta: (d) => {
                full += d
                send(IPC.evtJarvisReply, { turnId, delta: d, done: false })
              },
              onDone: () => resolve(),
              onError: (m) => reject(new Error(m))
            })
          })
        } catch (err) {
          send(IPC.evtJarvisReply, { turnId, done: true, error: (err as Error).message })
          return
        }
        // Final clean (spoken) text, then run any requested actions.
        const actions = parseActions(full)
        send(IPC.evtJarvisReply, { turnId, done: true, text: stripActions(full), actions: actions.length, raw: full })
        for (const action of actions) {
          const outcome = await runJarvisAction(action)
          send(IPC.evtJarvisAction, { turnId, outcome })
        }
      })

      return turnId
    }
  )

  ipcMain.handle(IPC.continuousStop, (_e, sessionId: string) => {
    activeSessions.get(sessionId)?.abort()
    activeSessions.delete(sessionId)
    return true
  })

  // Send a test message to the configured Discord webhook.
  ipcMain.handle(IPC.notifyTest, async (): Promise<boolean> => {
    const s = store.getSettings()
    const notifier = new Notifier(s.discordWebhookUrl, s.discordMentionUserId)
    if (!notifier.enabled) return false
    await notifier.send('success', 'Test message — your webhook is working. 🎉')
    return true
  })

  // --- Model management ---

  ipcMain.handle(IPC.pullModel, (_e, args: { baseUrl: string; model: string; instanceId: string }): string => {
    const pullId = randomUUID()
    const controller = new AbortController()
    activePulls.set(pullId, controller)

    setImmediate(() => {
      pullModel(args.baseUrl, args.model, {
        signal: controller.signal,
        onProgress: (status, completed, total) =>
          send(IPC.evtPullProgress, { pullId, status, completed, total, done: false }),
        onDone: async () => {
          activePulls.delete(pullId)
          // Refresh the target instance so the new model appears everywhere. Match by id, or
          // fall back to the baseUrl (the Ollama tab pulls with instanceId "local").
          const target = instances.find((i) => i.id === args.instanceId || i.baseUrl === args.baseUrl)
          const timeout = store.getSettings().connectTimeoutMs
          try {
            if (target) {
              const refreshed = await inspectInstance(target.host, target.port, target.source, timeout)
              instances = mergeInstances(instances, [refreshed])
            } else if (args.baseUrl.startsWith('http')) {
              const u = new URL(args.baseUrl)
              const refreshed = await inspectInstance(u.hostname, Number(u.port) || 11434, 'local', timeout)
              instances = mergeInstances(instances, [refreshed])
            }
            publishInstances()
          } catch (e) {
            console.error('[pull] refresh failed:', e)
          }
          send(IPC.evtPullProgress, { pullId, status: 'success', completed: 0, total: 0, done: true })
        },
        onError: (error) => {
          activePulls.delete(pullId)
          send(IPC.evtPullProgress, { pullId, status: 'error', completed: 0, total: 0, done: true, error })
        }
      })
    })
    return pullId
  })

  ipcMain.handle(IPC.pullModelCancel, (_e, pullId: string) => {
    activePulls.get(pullId)?.abort()
    activePulls.delete(pullId)
    return true
  })

  // --- Local Ollama management (the Ollama tab) ---

  ipcMain.handle(IPC.ollamaStatus, async (): Promise<LocalOllamaStatus> => {
    const version = await getVersion(LOCAL_OLLAMA_BASE, 2500)
    if (version === null) return { online: false, models: [], running: [] }
    const [models, running] = await Promise.all([
      listModels(LOCAL_OLLAMA_BASE),
      listRunningModels(LOCAL_OLLAMA_BASE)
    ])
    return { online: true, version, models, running }
  })

  ipcMain.handle(IPC.ollamaDelete, (_e, model: string) => deleteModel(LOCAL_OLLAMA_BASE, model))

  ipcMain.handle(IPC.ollamaSetLoaded, (_e, args: { model: string; load: boolean }) =>
    setModelLoaded(LOCAL_OLLAMA_BASE, args.model, args.load)
  )

  // --- MCP: give the user a ready-to-paste Claude Code registration for this checkout ---
  ipcMain.handle(IPC.getMcpConfig, () => {
    // Forward slashes work for npx/tsx on every OS and avoid JSON backslash escaping.
    const entry = path.join(process.cwd(), 'src', 'mcp', 'index.ts').replace(/\\/g, '/')
    const command = `claude mcp add localai -- npx -y tsx "${entry}"`
    const json = JSON.stringify({ mcpServers: { localai: { command: 'npx', args: ['-y', 'tsx', entry] } } }, null, 2)
    return { command, json, entry }
  })

  // --- OS integration: open / reveal in the file explorer ---

  ipcMain.handle(IPC.openProjectFolder, async (): Promise<boolean> => {
    const folder = store.getProjectFolder()
    if (!folder) return false
    await shell.openPath(folder)
    return true
  })

  ipcMain.handle(IPC.revealProjectFile, (_e, relPath: string): boolean => {
    const folder = store.getProjectFolder()
    if (!folder) return false
    try {
      shell.showItemInFolder(resolveInRoot(folder, relPath))
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(IPC.revealHistoryFile, async (_e, args: { id: string; relPath: string }): Promise<boolean> => {
    const record = await runStore.getRun(args.id)
    if (!record) return false
    try {
      shell.showItemInFolder(resolveInRoot(record.projectRoot, args.relPath))
      return true
    } catch {
      return false
    }
  })

  // --- Export a history run to a JSON file the user chooses ---

  ipcMain.handle(IPC.historyExport, async (_e, id: string): Promise<string | null> => {
    const record = await runStore.getRun(id)
    if (!record || !mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export run',
      defaultPath: `run-${id}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    await fsp.writeFile(result.filePath, JSON.stringify(record, null, 2), 'utf8')
    return result.filePath
  })
}

/** Resolve a UI role choice ("auto" or explicit) to a concrete agent, or null. */
function resolveRole(role: AgentRole, choice: RoleChoice | undefined): AgentConfig | null {
  if (!choice) return null
  if (choice.auto) {
    const best = pickBestModel(allInstances(), { preferCoding: role === 'coder' })
    return best ? { role, baseUrl: best.baseUrl, model: best.model } : null
  }
  if (!choice.baseUrl || !choice.model) return null
  return { role, baseUrl: choice.baseUrl, model: choice.model }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  // Ensure settings exist on first run.
  store.setSettings({ ...DEFAULT_SETTINGS, ...store.getSettings() })
  registerIpc()
  createWindow()
  restartHealthPolling()
  applyControlServer() // start the control server if it was left enabled

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  // Stop any in-flight continuous sessions and runs cleanly.
  for (const c of activeSessions.values()) c.abort()
  for (const c of activeRuns.values()) c.abort()
  controlServer?.stop().catch(() => {})
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
