import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runContinuous, type ContinuousConfig, type ContinuousDeps, type ContinuousHandlers } from '../continuous'
import type { AskFn } from '../orchestrator'
import type { ContinuousStopReason } from '../../shared/types'

const coder = { role: 'coder' as const, baseUrl: 'http://m', model: 'coder-m' }
const reviewer = { role: 'reviewer' as const, baseUrl: 'http://m', model: 'rev-m' }

interface AskOpts {
  leadDoneAfter?: number // return GOAL COMPLETE after this many lead calls
  coderEmpty?: boolean // coder emits no FILE blocks (forces a no-change cycle)
}

function makeAsk(opts: AskOpts): AskFn {
  let leadCalls = 0
  let coderCalls = 0
  return async (_agent, messages) => {
    const sys = messages[0].content
    if (sys.includes('ROLE: LEAD')) {
      leadCalls++
      if (opts.leadDoneAfter !== undefined && leadCalls > opts.leadDoneAfter) return 'GOAL COMPLETE'
      return `NEXT STEP: step ${leadCalls}\nPLAN:\n1. do ${leadCalls}`
    }
    if (sys.includes('ROLE: REVIEWER')) return 'APPROVED'
    // coder
    coderCalls++
    if (opts.coderEmpty) return 'Sorry, I cannot produce files.'
    return `FILE: file${coderCalls}.txt\n\`\`\`\ncontent ${coderCalls}\n\`\`\``
  }
}

function recorder() {
  const cycles: number[] = []
  let done: { reason: ContinuousStopReason; cycles: number; message: string } | null = null
  let error: string | null = null
  const handlers: ContinuousHandlers = {
    onCycleStart: () => {},
    onTurn: () => {},
    onCycleEnd: (r) => cycles.push(r.cycle),
    onDone: (reason, n, message) => (done = { reason, cycles: n, message }),
    onError: (m) => (error = m)
  }
  return { cycles, handlers, get done() { return done }, get error() { return error } }
}

const fakeGitSha = (): ContinuousDeps['git'] => {
  let n = 0
  return { ensureRepo: async () => true, commitAll: async () => `sha${++n}` }
}
const fakeGitNull = (): ContinuousDeps['git'] => ({ ensureRepo: async () => true, commitAll: async () => null })

function baseConfig(dir: string, over: Partial<ContinuousConfig> = {}): ContinuousConfig {
  return {
    goal: 'build a thing',
    projectRoot: dir,
    agents: { coder, reviewer },
    maxCycles: 10,
    cycleDelayMs: 0,
    stallThreshold: 3,
    gitAutoCommit: true,
    ...over
  }
}

describe('runContinuous', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cont-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('runs cycles, writes memory files, and stops on GOAL COMPLETE', async () => {
    const rec = recorder()
    await runContinuous(baseConfig(dir), rec.handlers, { ask: makeAsk({ leadDoneAfter: 2 }), git: fakeGitSha() })

    expect(rec.done?.reason).toBe('goal-complete')
    expect(rec.cycles).toEqual([1, 2]) // two cycles ran, then the lead said complete
    // Externalized memory exists.
    expect(await fs.readFile(path.join(dir, '.localai/goal.md'), 'utf8')).toContain('build a thing')
    expect(await fs.readFile(path.join(dir, '.localai/progress.md'), 'utf8')).toContain('Cycle 1')
    // The coder's files landed on disk.
    expect(await fs.readFile(path.join(dir, 'file1.txt'), 'utf8')).toContain('content 1')
    expect(rec.error).toBeNull()
  })

  it('stops via the stall guard when nothing changes', async () => {
    const rec = recorder()
    await runContinuous(
      baseConfig(dir, { stallThreshold: 2 }),
      rec.handlers,
      { ask: makeAsk({ coderEmpty: true }), git: fakeGitNull() }
    )
    expect(rec.done?.reason).toBe('stalled')
    expect(rec.cycles.length).toBe(2) // two no-change cycles hit the threshold
  })

  it('stops at the maxCycles cap', async () => {
    const rec = recorder()
    await runContinuous(
      baseConfig(dir, { maxCycles: 3 }),
      rec.handlers,
      { ask: makeAsk({}), git: fakeGitSha() } // lead never signals done
    )
    expect(rec.done?.reason).toBe('max-cycles')
    expect(rec.cycles).toEqual([1, 2, 3])
  })
})
