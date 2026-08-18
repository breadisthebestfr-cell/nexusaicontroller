import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RunRecord } from '../../shared/types'

// Point runStore at a temp dir BEFORE importing it (env is read lazily per-call, but set early to be safe).
let dir: string

async function freshStore() {
  // Import after env is set so the module resolves the base dir correctly.
  return import('../runStore')
}

const record = (id: string, task: string): RunRecord => ({
  id,
  startedAt: Date.now(),
  endedAt: Date.now(),
  status: 'completed',
  task,
  projectRoot: '/tmp/x',
  agents: [{ role: 'coder', model: 'm', baseUrl: 'http://x' }],
  summary: 'ok',
  filesWritten: ['a.txt', 'b.txt'],
  transcript: []
})

describe('runStore', () => {
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runstore-'))
    process.env.LOCALAI_RUNS_DIR = dir
  })
  afterEach(async () => {
    delete process.env.LOCALAI_RUNS_DIR
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('saves, lists, and gets runs (newest first)', async () => {
    const rs = await freshStore()
    await rs.saveRun(record('r1', 'first'))
    await new Promise((r) => setTimeout(r, 5))
    await rs.saveRun(record('r2', 'second'))

    const list = await rs.listRuns()
    expect(list.map((s) => s.id)).toEqual(['r2', 'r1'])
    expect(list[0].fileCount).toBe(2)

    const full = await rs.getRun('r1')
    expect(full?.task).toBe('first')
    expect(await rs.getRun('missing')).toBeNull()
  })

  it('deletes a single run', async () => {
    const rs = await freshStore()
    await rs.saveRun(record('r1', 'a'))
    await rs.saveRun(record('r2', 'b'))
    await rs.deleteRun('r1')

    const list = await rs.listRuns()
    expect(list.map((s) => s.id)).toEqual(['r2'])
    expect(await rs.getRun('r1')).toBeNull()
  })

  it('clears all runs', async () => {
    const rs = await freshStore()
    await rs.saveRun(record('r1', 'a'))
    await rs.clearRuns()
    expect(await rs.listRuns()).toEqual([])
  })
})
