import { describe, expect, it } from 'vitest'
import os from 'node:os'
import { isAllowed, isSafeCommand, runCommand } from '../commands'
import { parseRunDirectives } from '../prompts'

describe('isSafeCommand', () => {
  it('accepts a single simple command', () => {
    expect(isSafeCommand('npm test')).toBe(true)
    expect(isSafeCommand('git status -s')).toBe(true)
  })
  it('rejects chaining, piping, redirection, and substitution', () => {
    for (const bad of ['npm test; rm -rf ~', 'a && b', 'a || b', 'a | b', 'cat x > y', 'echo `id`', 'echo $(id)', 'echo ${X}']) {
      expect(isSafeCommand(bad)).toBe(false)
    }
  })
  it('rejects empty', () => {
    expect(isSafeCommand('   ')).toBe(false)
  })
})

describe('isAllowed', () => {
  it('matches exact and prefix', () => {
    const list = ['npm test', 'git status']
    expect(isAllowed('npm test', list)).toBe(true)
    expect(isAllowed('npm test -- foo', list)).toBe(true)
    expect(isAllowed('git status', list)).toBe(true)
    expect(isAllowed('npm run build', list)).toBe(false)
    expect(isAllowed('npm', list)).toBe(false) // must be the whole token or followed by a space
  })
  it('ignores empty allowlist entries', () => {
    expect(isAllowed('anything', ['', '  '])).toBe(false)
  })
})

describe('runCommand', () => {
  it('captures output and exit code', async () => {
    const r = await runCommand('echo hello', os.tmpdir(), 5000)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('hello')
    expect(r.timedOut).toBe(false)
  })
  it('reports a non-zero exit code', async () => {
    const r = await runCommand('exit 3', os.tmpdir(), 5000)
    expect(r.code).toBe(3)
  })
  it('times out a long command', async () => {
    const r = await runCommand('sleep 5', os.tmpdir(), 300)
    expect(r.timedOut).toBe(true)
  })
})

describe('parseRunDirectives', () => {
  it('extracts RUN: lines outside fences', () => {
    const out = ['RUN: npm test', 'FILE: x.js', '```', 'RUN: not-a-command-inside-a-file', '```', 'RUN: git status'].join('\n')
    expect(parseRunDirectives(out)).toEqual(['npm test', 'git status'])
  })
  it('returns [] when there are none', () => {
    expect(parseRunDirectives('just prose')).toEqual([])
  })
})
