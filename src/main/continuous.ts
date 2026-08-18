// Continuous (autonomous) mode — V5.
//
// Two+ local models keep working on one project across many cycles. Each cycle a "lead"
// picks the next small step from externalized memory (.localai/{goal,plan,progress}.md),
// the coder/reviewer implement it, the result is git-committed, and progress is logged.
// The loop stops on GOAL COMPLETE, the user's stop, a stall, or the cycle cap.
//
// Electron-free. The `ask` and `git` seams are injectable so the loop is deterministically
// testable, mirroring orchestrator.ts. This module persists nothing itself — it emits cycle
// data and the caller (index.ts) saves history.

import { runCollaboration, type AgentConfig, type AskFn, type EmittedTurn } from './orchestrator'
import { chatStream } from './ollamaClient'
import { ProjectFiles } from './fileTools'
import { LEAD_SYSTEM_PROMPT, buildNextStepPrompt, parseNextStep } from './prompts'
import * as gitmod from './git'
import { DEFAULT_TEMPERATURES } from '../shared/types'
import type { ContinuousStopReason, PromptOverrides, RoleTemperatures } from '../shared/types'

export interface ContinuousAgents {
  coder: AgentConfig
  planner?: AgentConfig
  reviewer?: AgentConfig
}

export interface ContinuousConfig {
  goal: string
  projectRoot: string
  agents: ContinuousAgents
  maxCycles: number
  cycleDelayMs: number
  stallThreshold: number
  gitAutoCommit: boolean
  /** Inner collaboration rounds per cycle (default 2). */
  roundsPerCycle?: number
  prompts?: PromptOverrides
  temperatures?: RoleTemperatures
  /** Allowlist-gated command executor for autonomous runs (optional). */
  runCommand?: (command: string) => Promise<import('../shared/types').CommandOutcome>
}

export interface CycleResult {
  cycle: number
  step: string
  filesWritten: string[]
  commit: string | null
  verdict: string
  transcript: EmittedTurn[]
}

export interface ContinuousHandlers {
  onCycleStart(cycle: number, step: string): void
  onTurn(cycle: number, turn: EmittedTurn): void
  onCycleEnd(result: CycleResult): void
  onDone(reason: ContinuousStopReason, cycles: number, message: string): void
  onError(message: string): void
  signal?: AbortSignal
}

export interface ContinuousDeps {
  ask?: AskFn
  git?: Pick<typeof gitmod, 'ensureRepo' | 'commitAll'>
}

const MEM = {
  goal: '.localai/goal.md',
  plan: '.localai/plan.md',
  progress: '.localai/progress.md'
} as const

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve()
    let timer: ReturnType<typeof setTimeout>
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

async function readOr(files: ProjectFiles, rel: string, fallback = ''): Promise<string> {
  try {
    return await files.read(rel)
  } catch {
    return fallback
  }
}

/** Run one collaboration pass for a step; returns the turns, files, and reviewer verdict. */
async function runOneCycle(
  config: ContinuousConfig,
  files: ProjectFiles,
  step: string,
  ask: AskFn,
  signal?: AbortSignal
): Promise<{ turns: EmittedTurn[]; files: string[]; verdict: string; error: string | null }> {
  const agents: AgentConfig[] = [config.agents.coder]
  if (config.agents.reviewer) agents.push(config.agents.reviewer)

  const turnsCollected: EmittedTurn[] = []
  const written = new Set<string>()
  let verdict = 'no reviewer'
  let error: string | null = null

  await runCollaboration(
    {
      task: `${step}\n\n(Overall goal: ${config.goal})`,
      projectRoot: config.projectRoot,
      agents,
      maxRounds: config.roundsPerCycle ?? 2,
      prompts: config.prompts,
      temperatures: config.temperatures
    },
    { files, runCommand: config.runCommand },
    {
      signal,
      onTurnStart: () => {},
      onDelta: () => {},
      onTurnEnd: (t) => {
        turnsCollected.push(t)
        t.filesTouched.forEach((f) => written.add(f))
        if (t.role === 'reviewer') verdict = t.content
      },
      onDone: () => {},
      onError: (m) => (error = m)
    },
    { ask }
  )

  return { turns: turnsCollected, files: [...written], verdict, error }
}

export async function runContinuous(
  config: ContinuousConfig,
  handlers: ContinuousHandlers,
  deps: ContinuousDeps = {}
): Promise<void> {
  const ask = deps.ask ?? (defaultAskShim as AskFn)
  const git = deps.git ?? gitmod
  const { signal } = handlers
  const temps = config.temperatures ?? DEFAULT_TEMPERATURES
  const files = new ProjectFiles(config.projectRoot)
  const leadAgent = config.agents.planner ?? config.agents.coder

  try {
    // Bootstrap memory + git. The .localai memory dir is git-ignored so its per-cycle
    // bookkeeping writes don't pollute the "did the code actually change" signal below.
    if (!(await files.exists('.localai/.gitignore'))) await files.write('.localai/.gitignore', '*\n')
    if (!(await files.exists(MEM.goal))) await files.write(MEM.goal, `# Goal\n\n${config.goal}\n`)
    let plan = await readOr(files, MEM.plan)
    let progress = await readOr(files, MEM.progress)

    let gitReady = false
    if (config.gitAutoCommit) {
      gitReady = await git.ensureRepo(config.projectRoot)
    }

    let stall = 0
    const maxCycles = Math.max(1, config.maxCycles)

    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      if (signal?.aborted) return handlers.onDone('stopped', cycle - 1, 'Stopped by user.')

      // 1) Lead picks the next step.
      const fileTree = await files.listTree()
      const leadOut = await ask(
        leadAgent,
        [
          { role: 'system', content: LEAD_SYSTEM_PROMPT },
          { role: 'user', content: buildNextStepPrompt(config.goal, plan, progress, fileTree) }
        ],
        () => {},
        signal,
        { temperature: temps.planner }
      )
      const next = parseNextStep(leadOut)
      if (next.done) return handlers.onDone('goal-complete', cycle - 1, 'The lead reported the goal is complete.')
      if (next.plan) {
        plan = next.plan
        await files.write(MEM.plan, plan)
      }
      const step = next.step || `Continue the project (cycle ${cycle})`
      handlers.onCycleStart(cycle, step)

      if (signal?.aborted) return handlers.onDone('stopped', cycle - 1, 'Stopped by user.')

      // 2) Coder/reviewer implement it.
      const result = await runOneCycle(config, files, step, ask, signal)
      result.turns.forEach((t) => handlers.onTurn(cycle, t))
      if (result.error) {
        handlers.onError(result.error)
        return handlers.onDone('error', cycle, result.error)
      }

      // 3) Commit.
      let commit: string | null = null
      if (config.gitAutoCommit && gitReady) {
        try {
          commit = await git.commitAll(config.projectRoot, `localai cycle ${cycle}: ${step}`.slice(0, 200))
        } catch {
          commit = null
        }
      }

      // 4) Log progress.
      const entry =
        `\n## Cycle ${cycle} — ${new Date().toISOString()}\n` +
        `- Step: ${step}\n- Files: ${result.files.join(', ') || 'none'}\n` +
        `- Commit: ${commit ?? 'none'}\n- Reviewer: ${result.verdict.slice(0, 200)}\n`
      progress += entry
      await files.write(MEM.progress, progress)

      handlers.onCycleEnd({ cycle, step, filesWritten: result.files, commit, verdict: result.verdict, transcript: result.turns })

      // 5) Stall guard. With git on, a real commit is the ground truth for "something in the
      // code actually changed" (the .localai memory dir is ignored, so identical re-writes
      // produce no commit and correctly count as a stall). Without git, fall back to whether
      // the coder emitted any files.
      const productive = config.gitAutoCommit && gitReady ? commit !== null : result.files.length > 0
      stall = productive ? 0 : stall + 1
      if (stall >= config.stallThreshold) {
        return handlers.onDone('stalled', cycle, `No changes for ${stall} cycles in a row — paused.`)
      }

      await sleep(config.cycleDelayMs, signal)
    }

    return handlers.onDone('max-cycles', maxCycles, `Reached the ${maxCycles}-cycle limit.`)
  } catch (err) {
    if (signal?.aborted) return handlers.onDone('stopped', 0, 'Stopped by user.')
    handlers.onError(err instanceof Error ? err.message : String(err))
    return handlers.onDone('error', 0, 'Continuous session failed.')
  }
}

// Default streaming ask (same behavior as orchestrator's internal default), used for the
// lead call and inner collaboration when no `ask` is injected.
const defaultAskShim: AskFn = (agent, messages, onDelta, signal, options) =>
  new Promise<string>((resolve, reject) => {
    let out = ''
    chatStream(
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
