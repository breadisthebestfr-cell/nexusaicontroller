// Minimal git integration for continuous mode's per-cycle checkpoints.
//
// Only fixed `git` subcommands are ever run, always with cwd = the project root.
// This is app-initiated version control, NOT agent shell access — the agents never
// choose commands here (that stays a future, approval-gated feature).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

async function git(dir: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return exec('git', args, { cwd: dir, windowsHide: true })
}

/** Is the `git` binary available on this machine? */
export async function hasGit(): Promise<boolean> {
  try {
    await exec('git', ['--version'], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

/** Is `dir` inside a git work tree? */
export async function isRepo(dir: string): Promise<boolean> {
  try {
    const { stdout } = await git(dir, ['rev-parse', '--is-inside-work-tree'])
    return stdout.trim() === 'true'
  } catch {
    return false
  }
}

/**
 * Ensure `dir` is a git repo with a usable identity. Inits if needed and sets a
 * local user.name/email only when none is configured (so commits don't fail on a
 * fresh machine). Returns false if git is unavailable.
 */
export async function ensureRepo(dir: string): Promise<boolean> {
  if (!(await hasGit())) return false
  if (!(await isRepo(dir))) {
    await git(dir, ['init'])
  }
  await ensureIdentity(dir)
  return true
}

async function ensureIdentity(dir: string): Promise<void> {
  const has = async (key: string) => {
    try {
      const { stdout } = await git(dir, ['config', key])
      return stdout.trim().length > 0
    } catch {
      return false
    }
  }
  if (!(await has('user.name'))) await git(dir, ['config', 'user.name', 'LocalAIConnection'])
  if (!(await has('user.email'))) await git(dir, ['config', 'user.email', 'localai@localhost'])
}

/**
 * Stage everything and commit. Returns the new commit's short sha, or null when
 * there was nothing to commit (a clean tree). Throws only on unexpected git errors.
 */
export async function commitAll(dir: string, message: string): Promise<string | null> {
  await git(dir, ['add', '-A'])

  // Nothing staged? Then there is nothing to commit.
  try {
    await git(dir, ['diff', '--cached', '--quiet'])
    return null // exit 0 = no staged changes
  } catch {
    // non-zero exit = there ARE staged changes; fall through to commit
  }

  await git(dir, ['commit', '-m', message])
  const { stdout } = await git(dir, ['rev-parse', '--short', 'HEAD'])
  return stdout.trim()
}

/** Return the diff (stat + patch) for a commit. `sha` is validated to be hex only. */
export async function showCommit(dir: string, sha: string): Promise<string> {
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) return ''
  try {
    const { stdout } = await git(dir, ['show', '--stat', '--patch', sha])
    return stdout.slice(0, 100_000)
  } catch {
    return ''
  }
}
