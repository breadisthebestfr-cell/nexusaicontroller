// Shell command execution for agents — the app's highest-risk surface, so every check
// here matters. Commands run with the user's OS privileges; safety comes from: off by
// default, single-command-only (no shell metacharacters), an allowlist, explicit approval,
// and a hard timeout. No Electron imports so it stays unit-testable.

import { spawn } from 'node:child_process'

const OUTPUT_CAP = 20_000

/**
 * Reject anything that isn't a single, simple command: no chaining/piping/redirection or
 * command/variable substitution. This is what makes an allowlist meaningful — an entry
 * can't be smuggled past with `npm test; rm -rf ~`.
 */
export function isSafeCommand(command: string): boolean {
  const c = command.trim()
  if (!c) return false
  if (/[;&|`\n\r<>]/.test(c)) return false // chaining, piping, redirection, backticks
  if (c.includes('$(') || c.includes('${')) return false // command / variable substitution
  return true
}

/** Prefix match: allowlist entry "npm test" permits "npm test" and "npm test -- x". */
export function isAllowed(command: string, allowlist: string[]): boolean {
  const c = command.trim()
  return allowlist.some((entry) => {
    const e = entry.trim()
    return e.length > 0 && (c === e || c.startsWith(e + ' '))
  })
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/** Run a command in `cwd` with a timeout, capturing (truncated) output. Never rejects. */
export function runCommand(command: string, cwd: string, timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (r: RunResult) => {
      if (settled) return
      settled = true
      resolve({ ...r, stdout: r.stdout.slice(0, OUTPUT_CAP), stderr: r.stderr.slice(0, OUTPUT_CAP) })
    }

    let child
    try {
      child = spawn(command, { cwd, shell: true, windowsHide: true })
    } catch (err) {
      finish({ code: null, stdout: '', stderr: (err as Error).message, timedOut: false })
      return
    }
    child.stdout?.on('data', (d) => {
      if (stdout.length < OUTPUT_CAP) stdout += d.toString()
    })
    child.stderr?.on('data', (d) => {
      if (stderr.length < OUTPUT_CAP) stderr += d.toString()
    })
    const timer = setTimeout(() => {
      child.kill()
      // Resolve promptly even if a lingering child keeps the pipe open, so the agent isn't blocked.
      finish({ code: null, stdout, stderr, timedOut: true })
    }, timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      finish({ code, stdout, stderr, timedOut: false })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      finish({ code: null, stdout, stderr: err.message, timedOut: false })
    })
  })
}
