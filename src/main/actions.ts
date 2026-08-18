// Jarvis action protocol — parsing + gating. Electron-free so it's unit-testable.
//
// The assistant talks normally, and when it wants to DO something it emits lines like:
//   ACTION: open_app {"name":"Firefox"}
//   ACTION: open_url {"url":"https://youtube.com"}
//   ACTION: create_document {"filename":"routine.txt","content":"..."}
//   ACTION: run_command {"command":"npm test"}
// One action per line; the JSON args must be on the same line.

import type { JarvisAction } from '../shared/types'

/** Actions considered low-risk (auto-run even in allowlist mode). */
export const SAFE_ACTIONS = ['open_url', 'open_app', 'create_document', 'say'] as const
/** Actions that run in Stage 1 (the rest are Stage-2 stubs). */
export const IMPLEMENTED_ACTIONS = [...SAFE_ACTIONS, 'run_command'] as const

export function isSafeAction(name: string): boolean {
  return (SAFE_ACTIONS as readonly string[]).includes(name)
}

// Tolerate the noise models wrap ACTION lines in: leading bullets/blockquote/backticks
// (e.g. "- ACTION:", "`ACTION: ...`", "> ACTION:") and trailing backticks/fences.
const ACTION_LINE = /^[\s>*`-]*ACTION:\s*([a-z_]+)\s*(\{.*\})?\s*`*\s*$/i
const ACTION_PREFIX = /^[\s>*`-]*ACTION:\s*[a-z_]+/i

/** Normalize smart quotes small models emit so the args JSON still parses. */
function normalizeJson(s: string): string {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
}

export function parseActions(text: string): JarvisAction[] {
  const out: JarvisAction[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(ACTION_LINE)
    if (!m) continue
    let args: Record<string, unknown> = {}
    if (m[2]) {
      try {
        args = JSON.parse(normalizeJson(m[2]))
      } catch {
        /* leave args empty on malformed JSON */
      }
    }
    out.push({ name: m[1].toLowerCase(), args })
  }
  return out
}

/** Strip ACTION: lines from a reply so the spoken/visible text is clean prose. */
export function stripActions(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !ACTION_PREFIX.test(l))
    .join('\n')
    .trim()
}

/** Build the assistant's system prompt describing who it is and what it can do. */
export function buildJarvisSystemPrompt(assistantName: string, apps: Record<string, string>, mode: string): string {
  const appList = Object.keys(apps).length ? Object.keys(apps).join(', ') : '(none configured yet)'
  return [
    `You are ${assistantName}, a calm, witty butler-style desktop assistant on the user's Windows PC.`,
    'You do not just talk — you ACT on the PC. Talk alone accomplishes nothing here.',
    '',
    'HOW YOU REPLY — every reply that DOES something has TWO parts:',
    '  1) One short spoken line (2–6 words), e.g. "On it, sir." · "Right away." · "Opening it now."',
    '  2) One or more ACTION lines that actually perform the task.',
    'The ACTION lines are the real work; they are hidden from the user (stripped before your line is spoken),',
    'so the ONLY way anything happens — a browser opens, a file is written — is if you emit them. If the user',
    'asked you to do something and you reply with only a spoken line, NOTHING happens and you have failed.',
    '',
    'ACTIONS you can use (one per line, single-line JSON on the SAME line as ACTION:):',
    '- open_app {"name":"<one of the known apps>"} — launch an app',
    '- open_url {"url":"https://..."} — open a link, or a plain query to web-search it',
    '- create_document {"filename":"name.txt","content":"<full text>","open":true} — write a file and open it',
    '- run_command {"command":"<single shell command>"} — only when truly needed',
    '- say {"text":"..."} — just speak (rarely needed; your spoken line already speaks)',
    `Known apps: ${appList}.`,
    '',
    'EXAMPLES (copy this shape exactly):',
    'User: open youtube',
    'You:',
    'On it, sir.',
    'ACTION: open_url {"url":"https://youtube.com"}',
    '',
    'User: open notepad and write a simple day routine',
    'You:',
    'Right away.',
    'ACTION: create_document {"filename":"day-routine.txt","content":"7:00 Wake up\\n7:30 Coffee\\n8:00 Work","open":true}',
    '',
    "User: what's the weather like",
    'You:',
    'Checking now.',
    'ACTION: open_url {"url":"weather today"}',
    '',
    'RULES: never invent apps not in the known list (fall back to open_url or run_command if unsure);',
    'put ALL generated text (plans, notes) inside create_document content, never in the spoken line;',
    'keep the spoken line a bare confirmation — never read the command, URL, or file contents aloud;',
    'only ask a question (with no ACTION) if you genuinely cannot act without more info; ask before anything destructive.',
    mode === 'trust'
      ? 'The user has enabled TRUST mode — actions run without asking.'
      : 'The user is in ALLOWLIST mode — risky actions (commands, unknown apps) need their approval.'
  ].join('\n')
}
