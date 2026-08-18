import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AppSettings,
  ChatChunk,
  ChatMessage,
  CloudModelListResult,
  CloudValidateResult,
  LocalOllamaStatus,
  ManualHost,
  OllamaInstance,
  OrchestratorDelta,
  OrchestratorDone,
  OrchestratorError,
  OrchestratorRunRequest,
  OrchestratorTurnStart,
  AgentTurn,
  RunRecord,
  RunSummary,
  ScanProgress,
  ContinuousStartRequest,
  ContinuousCycleStart,
  ContinuousCycleEnd,
  ContinuousDone,
  JarvisOutcome
} from '../shared/types'

// Typed API exposed to the renderer under window.api.
const api = {
  getInstances: (): Promise<OllamaInstance[]> => ipcRenderer.invoke(IPC.getInstances),
  scanLan: (): Promise<OllamaInstance[]> => ipcRenderer.invoke(IPC.scanLan),
  scanCancel: (): Promise<boolean> => ipcRenderer.invoke(IPC.scanCancel),
  refreshInstance: (id: string): Promise<OllamaInstance[]> => ipcRenderer.invoke(IPC.refreshInstance, id),
  pullModel: (args: { baseUrl: string; model: string; instanceId: string }): Promise<string> =>
    ipcRenderer.invoke(IPC.pullModel, args),
  pullModelCancel: (pullId: string): Promise<boolean> => ipcRenderer.invoke(IPC.pullModelCancel, pullId),
  ollamaStatus: (): Promise<LocalOllamaStatus> => ipcRenderer.invoke(IPC.ollamaStatus),
  ollamaDelete: (model: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.ollamaDelete, model),
  ollamaSetLoaded: (model: string, load: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.ollamaSetLoaded, { model, load }),
  getMcpConfig: (): Promise<{ command: string; json: string; entry: string; hasCloud: boolean }> =>
    ipcRenderer.invoke(IPC.getMcpConfig),
  getControlInfo: (): Promise<{ enabled: boolean; running: boolean; port: number; lan: boolean; token: string; urls: string[]; error: string | null }> =>
    ipcRenderer.invoke(IPC.getControlInfo),
  onPullProgress: (
    cb: (p: { pullId: string; status: string; completed: number; total: number; done: boolean; error?: string }) => void
  ): (() => void) => subscribe(IPC.evtPullProgress, cb),
  addManualHost: (host: ManualHost): Promise<OllamaInstance[]> => ipcRenderer.invoke(IPC.addManualHost, host),
  removeManualHost: (host: ManualHost): Promise<OllamaInstance[]> =>
    ipcRenderer.invoke(IPC.removeManualHost, host),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.setSettings, patch),
  listProviderModels: (args: { providerId: string; apiKey: string; baseUrl?: string; freeOnly?: boolean }): Promise<CloudModelListResult> =>
    ipcRenderer.invoke(IPC.listProviderModels, args),
  validateProviderModels: (args: { providerId: string; apiKey: string; baseUrl?: string; models: string[] }): Promise<CloudValidateResult> =>
    ipcRenderer.invoke(IPC.validateProviderModels, args),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickFolder),
  getProjectFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.getProjectFolder),

  chatStart: (args: { baseUrl: string; model: string; messages: ChatMessage[] }): Promise<string> =>
    ipcRenderer.invoke(IPC.chatStart, args),
  chatCancel: (requestId: string): Promise<boolean> => ipcRenderer.invoke(IPC.chatCancel, requestId),

  // Orchestrator. orchestratorStart returns a runId, or null if no project folder is set.
  orchestratorStart: (req: OrchestratorRunRequest): Promise<string | null> =>
    ipcRenderer.invoke(IPC.orchestratorStart, req),
  orchestratorCancel: (runId: string): Promise<boolean> => ipcRenderer.invoke(IPC.orchestratorCancel, runId),
  orchestratorAnswer: (askId: string, answers: string[]): Promise<boolean> =>
    ipcRenderer.invoke(IPC.orchestratorAnswer, { askId, answers }),
  onOrchestratorAsk: (cb: (r: { askId: string; questions: string[] }) => void): (() => void) =>
    subscribe<{ askId: string; questions: string[] }>(IPC.evtOrchestratorAsk, cb),
  readProjectFile: (relPath: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.readProjectFile, relPath),

  // Run history
  historyList: (): Promise<RunSummary[]> => ipcRenderer.invoke(IPC.historyList),
  historyGet: (id: string): Promise<RunRecord | null> => ipcRenderer.invoke(IPC.historyGet, id),
  historyDelete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.historyDelete, id),
  historyClear: (): Promise<void> => ipcRenderer.invoke(IPC.historyClear),
  historyReadFile: (id: string, relPath: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.historyReadFile, { id, relPath }),
  historyExport: (id: string): Promise<string | null> => ipcRenderer.invoke(IPC.historyExport, id),

  openProjectFolder: (): Promise<boolean> => ipcRenderer.invoke(IPC.openProjectFolder),
  revealProjectFile: (relPath: string): Promise<boolean> => ipcRenderer.invoke(IPC.revealProjectFile, relPath),
  revealHistoryFile: (id: string, relPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.revealHistoryFile, { id, relPath }),

  // Event subscriptions. Each returns an unsubscribe function.
  onScanProgress: (cb: (p: ScanProgress) => void): (() => void) =>
    subscribe<ScanProgress>(IPC.evtScanProgress, cb),
  onInstances: (cb: (list: OllamaInstance[]) => void): (() => void) =>
    subscribe<OllamaInstance[]>(IPC.evtInstances, cb),
  onChatChunk: (cb: (chunk: ChatChunk) => void): (() => void) => subscribe<ChatChunk>(IPC.evtChatChunk, cb),

  onOrchTurnStart: (cb: (t: OrchestratorTurnStart) => void): (() => void) =>
    subscribe<OrchestratorTurnStart>(IPC.evtOrchTurnStart, cb),
  onOrchDelta: (cb: (d: OrchestratorDelta) => void): (() => void) =>
    subscribe<OrchestratorDelta>(IPC.evtOrchDelta, cb),
  onOrchTurnEnd: (cb: (t: AgentTurn) => void): (() => void) => subscribe<AgentTurn>(IPC.evtOrchTurnEnd, cb),
  onOrchDone: (cb: (d: OrchestratorDone) => void): (() => void) =>
    subscribe<OrchestratorDone>(IPC.evtOrchDone, cb),
  onOrchError: (cb: (e: OrchestratorError) => void): (() => void) =>
    subscribe<OrchestratorError>(IPC.evtOrchError, cb),

  // Continuous mode
  continuousStart: (req: ContinuousStartRequest): Promise<string | null> =>
    ipcRenderer.invoke(IPC.continuousStart, req),
  continuousStop: (sessionId: string): Promise<boolean> => ipcRenderer.invoke(IPC.continuousStop, sessionId),
  commandApprove: (approvalId: string, decision: 'approve' | 'always' | 'deny'): Promise<boolean> =>
    ipcRenderer.invoke(IPC.commandApprove, { approvalId, decision }),
  commitDiff: (sha: string): Promise<string | null> => ipcRenderer.invoke(IPC.commitDiff, sha),

  jarvisSend: (args: { message: string; history?: ChatMessage[]; baseUrl: string; model: string }): Promise<string> =>
    ipcRenderer.invoke(IPC.jarvisSend, args),
  onJarvisReply: (
    cb: (r: { turnId: string; delta?: string; done: boolean; text?: string; error?: string; actions?: number; raw?: string }) => void
  ): (() => void) => subscribe(IPC.evtJarvisReply, cb),
  onJarvisAction: (cb: (r: { turnId: string; outcome: JarvisOutcome }) => void): (() => void) =>
    subscribe(IPC.evtJarvisAction, cb),
  onCommandApprovalRequest: (cb: (r: { approvalId: string; command: string }) => void): (() => void) =>
    subscribe<{ approvalId: string; command: string }>(IPC.evtCommandApprovalRequest, cb),
  notifyTest: (): Promise<boolean> => ipcRenderer.invoke(IPC.notifyTest),
  onContCycleStart: (cb: (c: ContinuousCycleStart) => void): (() => void) =>
    subscribe<ContinuousCycleStart>(IPC.evtContCycleStart, cb),
  onContTurn: (cb: (t: AgentTurn & { sessionId: string; cycle: number }) => void): (() => void) =>
    subscribe<AgentTurn & { sessionId: string; cycle: number }>(IPC.evtContTurn, cb),
  onContCycleEnd: (cb: (c: ContinuousCycleEnd) => void): (() => void) =>
    subscribe<ContinuousCycleEnd>(IPC.evtContCycleEnd, cb),
  onContDone: (cb: (d: ContinuousDone) => void): (() => void) =>
    subscribe<ContinuousDone>(IPC.evtContDone, cb),
  onContError: (cb: (e: { sessionId: string; message: string }) => void): (() => void) =>
    subscribe<{ sessionId: string; message: string }>(IPC.evtContError, cb)
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('api', api)

export type LocalAIApi = typeof api
