// Prompt helper tuned for SMALL local models (~7b–14b), which are weak at autonomous
// coding. The goals: force the exact output format, cut rambling, and keep each agent
// narrowly scoped. Electron-free so both the app and the MCP server reuse it.

import type { AgentRole, PromptOverrides } from '../shared/types'

/**
 * Shared "house rules" prepended to every role. Small models follow short, imperative,
 * explicit rules far better than prose, so keep this tight and concrete.
 */
export const HOUSE_RULES = [
  'You are one agent in a small team of local AI models collaborating on a coding task.',
  'RULES:',
  '- Be concise. No greetings, no apologies, no restating the task.',
  '- Do exactly your role below — nothing more.',
  '- Never invent APIs, libraries, files, or facts. Prefer the standard library and minimal dependencies.',
  '- If unsure, choose the simplest thing that works.'
].join('\n')

/** One-file example that shows the coder the EXACT output format expected. */
const CODER_FORMAT_EXAMPLE = [
  'OUTPUT FORMAT — for every file, a line "FILE: <relative/path>" then a fenced block with the WHOLE file:',
  'FILE: src/hello.js',
  '```js',
  "console.log('hello')",
  '```',
  'Output ONLY files in that format. No explanation before or after. Always output complete files, never diffs or snippets.'
].join('\n')

export const DEFAULT_ROLE_PROMPTS: Record<AgentRole, string> = {
  planner:
    'ROLE: PLANNER. Turn the task into a SHORT numbered plan (max 6 steps) the coder can follow. ' +
    'Each step is one concrete action. Do NOT write code. Do NOT add explanation after the list.',
  coder:
    'ROLE: CODER. Implement the plan by writing complete files.\n' + CODER_FORMAT_EXAMPLE,
  reviewer:
    'ROLE: REVIEWER. Check the coder output against the task for bugs and missing pieces. ' +
    'If it fully satisfies the task, reply with EXACTLY the single word: APPROVED. ' +
    'Otherwise reply with a SHORT numbered list of concrete required fixes (max 5). Do not rewrite the code yourself.'
}

/**
 * Resolve the system prompt for a role: a user override wins outright; otherwise the
 * shared house rules plus the tuned role default.
 */
export function systemPromptFor(role: AgentRole, overrides?: PromptOverrides): string {
  const override = overrides?.[role]?.trim()
  if (override) return override
  return `${HOUSE_RULES}\n\n${DEFAULT_ROLE_PROMPTS[role]}`
}

export function buildCoderPrompt(
  task: string,
  plan: string,
  feedback: string,
  round: number,
  commandsAllowed = false
): string {
  const parts = [`TASK:\n${task}`]
  parts.push(`\nPLAN:\n${plan.trim() || '(no planner — decide the minimal set of files yourself)'}`)
  if (feedback.trim()) {
    parts.push(`\nThis is round ${round}. The reviewer requires these fixes — address ALL of them:\n${feedback.trim()}`)
  }
  if (commandsAllowed) {
    parts.push(
      '\nYou MAY verify your work by requesting ONE simple command per line, e.g.\n' +
        'RUN: npm test\nOnly request commands when genuinely useful; some may need the user\'s approval.'
    )
  }
  parts.push('\nNow output the complete files in the required FILE: format.')
  return parts.join('\n')
}

/**
 * Extract `RUN: <command>` directives that appear OUTSIDE fenced code blocks (so a command
 * example inside a written file isn't mistaken for a request to run something).
 */
export function parseRunDirectives(out: string): string[] {
  const cmds: string[] = []
  let inFence = false
  for (const line of out.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(/^\s*RUN:\s*(.+?)\s*$/i)
    if (m) cmds.push(m[1].trim())
  }
  return cmds
}

export function buildReviewPrompt(task: string, plan: string, coderOut: string, files: string[]): string {
  const fileList = files.length ? files.join(', ') : '(no files were written)'
  return [
    `TASK:\n${task}`,
    `\nPLAN:\n${plan.trim() || '(none)'}`,
    `\nFILES WRITTEN THIS ROUND: ${fileList}`,
    `\nCODER OUTPUT:\n${coderOut}`,
    '\nReview it now. Reply EXACTLY "APPROVED" if it satisfies the task, otherwise a short numbered list of fixes.'
  ].join('\n')
}

/** Corrective nudge when the coder produced no parseable FILE: blocks. */
export const REPAIR_PROMPT =
  'Your last message contained NO "FILE:" blocks, so nothing could be saved. ' +
  'Output the file(s) now using EXACTLY this format and nothing else:\n' +
  'FILE: relative/path\n```\n<complete file contents>\n```'

/** Prompt appended to the task so the model surfaces clarifying questions before starting. */
export const CLARIFY_PROMPT = [
  'Before starting, identify what is genuinely ambiguous or underspecified about this task.',
  'List UP TO 3 short, specific questions whose answers would change how you build it.',
  'Output ONLY the questions, one per line, each prefixed with "Q: ". Do not ask about things you can',
  'reasonably assume. If you have no real questions, output exactly: NONE'
].join('\n')

/** Parse "Q: ..." (or bulleted / "?"-terminated) lines from a clarify reply; capped at 3, [] on NONE. */
export function parseQuestions(text: string): string[] {
  const qs: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line || /^none\b/i.test(line)) continue
    const hadPrefix = /^(q:|[-*•]|\d+[.)])/i.test(line)
    line = line.replace(/^(q:|[-*•]|\d+[.)])\s*/i, '').trim()
    if (line.endsWith('?') || (hadPrefix && line.length > 3)) qs.push(line)
  }
  return qs.slice(0, 3)
}

// ---------------------------------------------------------------------------
// Continuous mode: the "lead" that picks the next step each cycle (V5)
// ---------------------------------------------------------------------------

export const LEAD_SYSTEM_PROMPT = [
  HOUSE_RULES,
  '',
  'ROLE: LEAD. You drive a long-running project one small step at a time. Given the goal, the current',
  'plan, the progress log, and the file tree, decide the SINGLE next concrete step (something the coder',
  'can finish in one pass). Output EXACTLY two things and nothing else:',
  'NEXT STEP: <one short imperative step>',
  'PLAN:\n<the updated numbered checklist, marking done items with [x]>',
  'If the goal is fully achieved, output exactly "GOAL COMPLETE" on its own line instead of a NEXT STEP.'
].join('\n')

export function buildNextStepPrompt(goal: string, plan: string, progress: string, fileTree: string): string {
  return [
    `GOAL:\n${goal.trim()}`,
    `\nCURRENT PLAN:\n${plan.trim() || '(none yet — create one)'}`,
    `\nPROGRESS SO FAR:\n${progress.trim() || '(nothing done yet)'}`,
    `\nPROJECT FILES:\n${fileTree.trim() || '(empty project)'}`,
    '\nDecide the next step now (or reply GOAL COMPLETE).'
  ].join('\n')
}

export interface NextStep {
  done: boolean
  step: string
  plan: string
}

/** Parse the lead's output into a next step + updated plan, tolerating small-model noise. */
export function parseNextStep(out: string): NextStep {
  if (/^\s*GOAL COMPLETE\s*$/im.test(out)) return { done: true, step: '', plan: '' }

  const stepMatch = out.match(/NEXT STEP:\s*(.+)/i)
  const step = stepMatch ? stepMatch[1].trim() : ''

  const planMatch = out.match(/PLAN:\s*([\s\S]*)$/i)
  const plan = planMatch ? planMatch[1].trim() : ''

  return { done: false, step, plan }
}
