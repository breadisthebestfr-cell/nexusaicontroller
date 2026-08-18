// Multi-agent orchestrator — V2.
//
// Runs a planner -> coder -> reviewer collaboration over a single Ollama-hosted model
// per role. The coder writes real files into the sandboxed project folder; the reviewer
// critiques and the loop iterates until the reviewer approves or maxRounds is reached.
//
// The `ToolExecutor` seam is where a future approval-gated shell command runner plugs in
// without touching callers.

import { chatStream, type ChatOptions } from './ollamaClient'
import { ProjectFiles, PathEscapeError } from './fileTools'
import { parseFileBlocks } from './fileBlocks'
import { buildCoderPrompt, buildReviewPrompt, CLARIFY_PROMPT, parseQuestions, parseRunDirectives, REPAIR_PROMPT, systemPromptFor } from './prompts'
import { DEFAULT_TEMPERATURES } from '../shared/types'
import type {
  AgentConfig,
  AgentRole,
  AgentTurn,
  ChatMessage,
  CommandOutcome,
  PromptOverrides,
  RoleTemperatures
} from '../shared/types'

export type { AgentConfig, AgentRole } from '../shared/types'

export interface RunConfig {
  task: string
  projectRoot: string
  agents: AgentConfig[]
  maxRounds: number
  /** Per-role system-prompt overrides (empty = tuned defaults). */
  prompts?: PromptOverrides
  /** Per-role sampling temperatures (defaults applied when absent). */
  temperatures?: RoleTemperatures
}

/**
 * Side effects agents may request. V2 permits file writes only (via `files`).
 * V3+ adds `runCommand`, gated behind per-command user approval in the UI.
 */
export interface ToolExecutor {
  files: ProjectFiles
  /**
   * Run a shell command the coder requested (via a RUN: directive). Present only when the
   * user has enabled commands. The implementation handles the allowlist/approval gating and
   * always resolves an outcome (never throws), reporting skips via `skippedReason`.
   */
  runCommand?: (command: string) => Promise<CommandOutcome>
}

/** Compact, model-readable summary of a command outcome for the transcript + reviewer. */
function formatOutcome(o: CommandOutcome): string {
  if (o.skippedReason) return `\n[$ ${o.command}] skipped: ${o.skippedReason}`
  const head = o.timedOut ? 'timed out' : `exit ${o.code}`
  const out = [o.stdout, o.stderr].filter((s) => s.trim()).join('\n').slice(0, 1500)
  return `\n[$ ${o.command}] ${head}${out ? `\n${out}` : ''}`
}

/** Turn emitted by the orchestrator; the caller adds the runId before forwarding. */
export type EmittedTurn = Omit<AgentTurn, 'runId'>

export interface RunHandlers {
  onTurnStart(meta: { round: number; role: AgentRole; model: string }): void
  onDelta(round: number, role: AgentRole, delta: string): void
  onTurnEnd(turn: EmittedTurn): void
  onDone(summary: string): void
  onError(message: string): void
  signal?: AbortSignal
}

/** Pluggable completion function so the loop can be unit-tested deterministically. */
export type AskFn = (
  agent: AgentConfig,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  options?: ChatOptions
) => Promise<string>

/** Default completion function: streams from a real Ollama instance. */
const defaultAsk: AskFn = (agent, messages, onDelta, signal, options) =>
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

function isApproved(review: string): boolean {
  // The reviewer is told to reply with EXACTLY "APPROVED". Require the reply to START
  // with it as a whole word so "DISAPPROVED", "UNAPPROVED", and "not yet approved" don't
  // false-positive and end the loop early.
  return /^\s*APPROVED\b/i.test(review.trim())
}

interface WriteResult {
  written: string[]
  skipped: string[]
}

async function writeBlocks(files: ProjectFiles, out: string): Promise<WriteResult> {
  const blocks = parseFileBlocks(out)
  const written: string[] = []
  const skipped: string[] = []
  for (const block of blocks) {
    try {
      await files.write(block.path, block.content)
      written.push(block.path)
    } catch (err) {
      // Path traversal or unwritable path — skip it rather than aborting the whole run.
      if (err instanceof PathEscapeError) skipped.push(block.path)
      else skipped.push(`${block.path} (${(err as Error).message})`)
    }
  }
  return { written, skipped }
}

/**
 * Run the planner -> coder -> reviewer collaboration. Emits streaming events through
 * `handlers` and returns once the run finishes, errors, or is cancelled.
 */
export async function runCollaboration(
  config: RunConfig,
  tools: ToolExecutor,
  handlers: RunHandlers,
  deps: { ask?: AskFn; askUser?: (questions: string[]) => Promise<string[]> } = {}
): Promise<void> {
  const ask = deps.ask ?? defaultAsk
  const { signal } = handlers

  const planner = config.agents.find((a) => a.role === 'planner')
  const coder = config.agents.find((a) => a.role === 'coder')
  const reviewer = config.agents.find((a) => a.role === 'reviewer')

  if (!coder) {
    handlers.onError('Assign at least a Coder model before running.')
    return
  }

  const now = () => Date.now()
  const temps = config.temperatures ?? DEFAULT_TEMPERATURES
  const prompts = config.prompts

  try {
    // --- Clarify (optional): let the model ask the user a few questions up front. ---
    // Best-effort: a failure here (model offline, bad reply) must NOT abort the whole run,
    // so it's wrapped and simply falls through to running with the original task.
    let taskContext = config.task
    if (deps.askUser && !signal?.aborted) {
      try {
        const asker = planner ?? coder
        const raw = await ask(
          asker,
          [
            { role: 'system', content: systemPromptFor(asker.role, prompts) },
            { role: 'user', content: `TASK:\n${config.task}\n\n${CLARIFY_PROMPT}` }
          ],
          () => {}, // don't stream the clarify step into the visible transcript
          signal,
          { temperature: 0 }
        )
        const questions = parseQuestions(raw)
        if (questions.length && !signal?.aborted) {
          const answers = await deps.askUser(questions)
          const qa = questions.map((q, i) => `Q: ${q}\nA: ${(answers[i] ?? '').trim() || '(no answer given)'}`).join('\n')
          taskContext = `${config.task}\n\nCLARIFICATIONS (from the user):\n${qa}`
        }
      } catch {
        /* clarify is optional — proceed with the original task */
      }
    }

    // --- Planning (once, optional) ---
    let plan = ''
    if (planner) {
      handlers.onTurnStart({ round: 1, role: 'planner', model: planner.model })
      plan = await ask(
        planner,
        [
          { role: 'system', content: systemPromptFor('planner', prompts) },
          { role: 'user', content: `TASK:\n${taskContext}` }
        ],
        (d) => handlers.onDelta(1, 'planner', d),
        signal,
        { temperature: temps.planner }
      )
      handlers.onTurnEnd({ round: 1, role: 'planner', model: planner.model, content: plan, filesTouched: [], at: now() })
    }

    // --- Coder / reviewer loop ---
    let feedback = ''
    const maxRounds = Math.max(1, config.maxRounds)

    for (let round = 1; round <= maxRounds; round++) {
      if (signal?.aborted) break

      // Coder
      handlers.onTurnStart({ round, role: 'coder', model: coder.model })
      const coderSystem = { role: 'system' as const, content: systemPromptFor('coder', prompts) }
      const coderUser = {
        role: 'user' as const,
        content: buildCoderPrompt(taskContext, plan, feedback, round, !!tools.runCommand)
      }
      let coderOut = await ask(
        coder,
        [coderSystem, coderUser],
        (d) => handlers.onDelta(round, 'coder', d),
        signal,
        { temperature: temps.coder }
      )

      // Auto-repair: small models often reply with prose and no FILE: blocks. Give ONE
      // strict corrective nudge before giving up on this round.
      let repaired = false
      if (parseFileBlocks(coderOut).length === 0 && !signal?.aborted) {
        repaired = true
        const fix = await ask(
          coder,
          [coderSystem, coderUser, { role: 'assistant', content: coderOut }, { role: 'user', content: REPAIR_PROMPT }],
          (d) => handlers.onDelta(round, 'coder', d),
          signal,
          { temperature: temps.coder }
        )
        coderOut = fix
      }

      const { written, skipped } = await writeBlocks(tools.files, coderOut)

      // Run any commands the coder requested (gated by the injected executor).
      let commandNote = ''
      if (tools.runCommand) {
        for (const cmd of parseRunDirectives(coderOut)) {
          if (signal?.aborted) break
          commandNote += formatOutcome(await tools.runCommand(cmd))
        }
      }

      let coderNote = coderOut
      if (repaired) coderNote = `[auto-repair applied]\n${coderNote}`
      if (skipped.length) coderNote += `\n\n[skipped unsafe/invalid paths: ${skipped.join(', ')}]`
      if (commandNote) coderNote += `\n\n--- commands ---${commandNote}`
      handlers.onTurnEnd({ round, role: 'coder', model: coder.model, content: coderNote, filesTouched: written, at: now() })

      // Command results become part of what the reviewer sees.
      const coderOutForReview = commandNote ? `${coderOut}\n\n--- command results ---${commandNote}` : coderOut

      // No reviewer: single-pass coding.
      if (!reviewer) {
        handlers.onDone(`Coder wrote ${written.length} file(s) in a single pass.`)
        return
      }

      if (signal?.aborted) break

      // Reviewer
      handlers.onTurnStart({ round, role: 'reviewer', model: reviewer.model })
      const reviewOut = await ask(
        reviewer,
        [
          { role: 'system', content: systemPromptFor('reviewer', prompts) },
          { role: 'user', content: buildReviewPrompt(taskContext, plan, coderOutForReview, written) }
        ],
        (d) => handlers.onDelta(round, 'reviewer', d),
        signal,
        { temperature: temps.reviewer }
      )
      handlers.onTurnEnd({ round, role: 'reviewer', model: reviewer.model, content: reviewOut, filesTouched: [], at: now() })

      if (isApproved(reviewOut)) {
        handlers.onDone(`Reviewer approved after ${round} round(s).`)
        return
      }
      feedback = reviewOut
    }

    if (signal?.aborted) {
      handlers.onDone('Run cancelled.')
    } else {
      handlers.onDone(`Reached the ${maxRounds}-round limit without explicit approval.`)
    }
  } catch (err) {
    if (signal?.aborted) {
      handlers.onDone('Run cancelled.')
    } else {
      handlers.onError(err instanceof Error ? err.message : String(err))
    }
  }
}
