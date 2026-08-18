import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProjectFiles } from '../fileTools'
import { runCollaboration, type AskFn, type EmittedTurn, type RunConfig } from '../orchestrator'
import type { AgentConfig } from '../../shared/types'

const agent = (role: AgentConfig['role']): AgentConfig => ({ role, baseUrl: 'http://mock', model: `${role}-model` })

const CODER_OUTPUT = ['FILE: hello.txt', '```', 'hi there', '```'].join('\n')

/** Collect handler callbacks into a recorded result. */
function recorder() {
  const turns: EmittedTurn[] = []
  let summary: string | null = null
  let error: string | null = null
  return {
    turns,
    get summary() {
      return summary
    },
    get error() {
      return error
    },
    handlers: {
      onTurnStart: () => {},
      onDelta: () => {},
      onTurnEnd: (t: EmittedTurn) => turns.push(t),
      onDone: (s: string) => (summary = s),
      onError: (m: string) => (error = m)
    }
  }
}

describe('runCollaboration', () => {
  let dir: string
  let files: ProjectFiles

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laic-orch-'))
    files = new ProjectFiles(dir)
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('runs planner -> coder -> reviewer, writes files, and stops on approval', async () => {
    const ask: AskFn = async (a) => {
      if (a.role === 'planner') return '1. do it'
      if (a.role === 'coder') return CODER_OUTPUT
      return 'APPROVED'
    }
    const config: RunConfig = {
      task: 'make hello.txt',
      projectRoot: dir,
      agents: [agent('planner'), agent('coder'), agent('reviewer')],
      maxRounds: 3
    }
    const rec = recorder()
    await runCollaboration(config, { files }, rec.handlers, { ask })

    expect(rec.turns.map((t) => t.role)).toEqual(['planner', 'coder', 'reviewer'])
    expect(rec.summary).toContain('approved')
    expect(rec.error).toBeNull()
    // The coder's file actually landed on disk inside the sandbox.
    expect(await files.read('hello.txt')).toBe('hi there')
    const coderTurn = rec.turns.find((t) => t.role === 'coder')!
    expect(coderTurn.filesTouched).toEqual(['hello.txt'])
  })

  it('iterates when the reviewer requests changes, then approves', async () => {
    let reviews = 0
    const ask: AskFn = async (a) => {
      if (a.role === 'coder') return CODER_OUTPUT
      if (a.role === 'reviewer') return ++reviews === 1 ? '1. add more' : 'APPROVED'
      return ''
    }
    const config: RunConfig = {
      task: 't',
      projectRoot: dir,
      agents: [agent('coder'), agent('reviewer')],
      maxRounds: 5
    }
    const rec = recorder()
    await runCollaboration(config, { files }, rec.handlers, { ask })

    const roles = rec.turns.map((t) => t.role)
    expect(roles).toEqual(['coder', 'reviewer', 'coder', 'reviewer'])
    expect(rec.summary).toContain('2 round')
  })

  it('does not treat "DISAPPROVED" (or other approve-substrings) as approval', async () => {
    let reviews = 0
    const ask: AskFn = async (a) => {
      if (a.role === 'coder') return CODER_OUTPUT
      if (a.role === 'reviewer') return ++reviews === 1 ? 'DISAPPROVED — fix the bug' : 'APPROVED'
      return ''
    }
    const config: RunConfig = {
      task: 't',
      projectRoot: dir,
      agents: [agent('coder'), agent('reviewer')],
      maxRounds: 5
    }
    const rec = recorder()
    await runCollaboration(config, { files }, rec.handlers, { ask })
    // Must iterate to a real APPROVED (round 2), not stop on the "DISAPPROVED" substring.
    expect(rec.turns.map((t) => t.role)).toEqual(['coder', 'reviewer', 'coder', 'reviewer'])
    expect(rec.summary).toContain('2 round')
  })

  it('runs RUN: directives via the injected command executor and records the result', async () => {
    const ran: string[] = []
    const runCommand = async (command: string) => {
      ran.push(command)
      return { command, approved: true, code: 0, stdout: 'tests pass', stderr: '', timedOut: false }
    }
    const ask: AskFn = async (a) => (a.role === 'coder' ? `${CODER_OUTPUT}\nRUN: npm test` : 'APPROVED')
    const config: RunConfig = {
      task: 't',
      projectRoot: dir,
      agents: [agent('coder'), agent('reviewer')],
      maxRounds: 1
    }
    const rec = recorder()
    await runCollaboration(config, { files, runCommand }, rec.handlers, { ask })

    expect(ran).toEqual(['npm test'])
    const coderTurn = rec.turns.find((t) => t.role === 'coder')!
    expect(coderTurn.content).toContain('[$ npm test]')
    expect(coderTurn.content).toContain('tests pass')
  })

  it('does a single coder pass when no reviewer is assigned', async () => {
    const ask: AskFn = async () => CODER_OUTPUT
    const config: RunConfig = { task: 't', projectRoot: dir, agents: [agent('coder')], maxRounds: 3 }
    const rec = recorder()
    await runCollaboration(config, { files }, rec.handlers, { ask })

    expect(rec.turns.map((t) => t.role)).toEqual(['coder'])
    expect(rec.summary).toContain('single pass')
  })

  it('errors when no coder is assigned', async () => {
    const ask: AskFn = async () => ''
    const config: RunConfig = { task: 't', projectRoot: dir, agents: [agent('planner')], maxRounds: 3 }
    const rec = recorder()
    await runCollaboration(config, { files }, rec.handlers, { ask })

    expect(rec.error).toContain('Coder')
    expect(rec.turns).toHaveLength(0)
  })

  it('auto-repairs when the first coder reply has no FILE blocks', async () => {
    let coderCalls = 0
    const ask: AskFn = async (a) => {
      if (a.role !== 'coder') return ''
      coderCalls++
      // First reply is prose (no blocks); the repair reply contains a real FILE block.
      return coderCalls === 1 ? 'Sure, I will create the file for you.' : CODER_OUTPUT
    }
    const config: RunConfig = { task: 't', projectRoot: dir, agents: [agent('coder')], maxRounds: 1 }
    const rec = recorder()
    await runCollaboration(config, { files }, rec.handlers, { ask })

    expect(coderCalls).toBe(2) // original + one repair
    const coderTurn = rec.turns.find((t) => t.role === 'coder')!
    expect(coderTurn.content).toContain('[auto-repair applied]')
    expect(coderTurn.filesTouched).toEqual(['hello.txt'])
    expect(await files.read('hello.txt')).toBe('hi there')
  })

  it('passes a per-role temperature to the ask function', async () => {
    const seen: Record<string, number | undefined> = {}
    const ask: AskFn = async (a, _m, _d, _s, options) => {
      seen[a.role] = options?.temperature
      return a.role === 'coder' ? CODER_OUTPUT : 'APPROVED'
    }
    const config: RunConfig = {
      task: 't',
      projectRoot: dir,
      agents: [agent('coder'), agent('reviewer')],
      maxRounds: 1,
      temperatures: { planner: 0.9, coder: 0.1, reviewer: 0.3 }
    }
    await runCollaboration(config, { files }, recorder().handlers, { ask })
    expect(seen.coder).toBe(0.1)
    expect(seen.reviewer).toBe(0.3)
  })

  it('skips file writes that try to escape the sandbox', async () => {
    const escaping = ['FILE: ../evil.txt', '```', 'nope', '```'].join('\n')
    const ask: AskFn = async () => escaping
    const config: RunConfig = { task: 't', projectRoot: dir, agents: [agent('coder')], maxRounds: 1 }
    const rec = recorder()
    await runCollaboration(config, { files }, rec.handlers, { ask })

    const coderTurn = rec.turns.find((t) => t.role === 'coder')!
    expect(coderTurn.filesTouched).toEqual([]) // nothing written
    expect(coderTurn.content).toContain('skipped')
    // And the file did not appear outside the sandbox.
    await expect(fs.access(path.join(dir, '..', 'evil.txt'))).rejects.toBeTruthy()
  })
})
