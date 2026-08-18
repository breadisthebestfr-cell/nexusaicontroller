// Persistence for collaboration run history.
//
// Each run is stored as `<baseDir>/<id>.json`, with a `<baseDir>/index.json` holding the
// lightweight summaries for the list view. The base dir defaults to the Electron userData
// folder but can be overridden with LOCALAI_RUNS_DIR (used by tests, so this module needs
// no Electron runtime to be exercised).

import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { RunRecord, RunSummary } from '../shared/types'

const require = createRequire(import.meta.url)

function baseDir(): string {
  const override = process.env.LOCALAI_RUNS_DIR
  if (override) return override
  // Lazily require electron so tests (which set LOCALAI_RUNS_DIR) never touch it.
  const { app } = require('electron') as typeof import('electron')
  return path.join(app.getPath('userData'), 'runs')
}

const indexPath = () => path.join(baseDir(), 'index.json')
const runPath = (id: string) => path.join(baseDir(), `${id}.json`)

async function ensureDir(): Promise<void> {
  await fs.mkdir(baseDir(), { recursive: true })
}

function toSummary(r: RunRecord): RunSummary {
  return {
    id: r.id,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    status: r.status,
    task: r.task,
    fileCount: r.filesWritten.length
  }
}

async function readIndex(): Promise<RunSummary[]> {
  try {
    const raw = await fs.readFile(indexPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RunSummary[]) : []
  } catch {
    return []
  }
}

async function writeIndex(summaries: RunSummary[]): Promise<void> {
  await ensureDir()
  await fs.writeFile(indexPath(), JSON.stringify(summaries, null, 2), 'utf8')
}

// Serialize index read-modify-write so concurrent, fire-and-forget saves (e.g. an
// orchestrator run and a continuous cycle finishing together) can't clobber each other.
let writeLock: Promise<unknown> = Promise.resolve()
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(fn, fn)
  writeLock = next.catch(() => undefined)
  return next
}

/** Persist a run and update the index (newest first). */
export async function saveRun(record: RunRecord): Promise<void> {
  await ensureDir()
  await fs.writeFile(runPath(record.id), JSON.stringify(record, null, 2), 'utf8')
  await withLock(async () => {
    const index = (await readIndex()).filter((s) => s.id !== record.id)
    index.unshift(toSummary(record))
    await writeIndex(index)
  })
}

/** List run summaries, newest first. */
export async function listRuns(): Promise<RunSummary[]> {
  const index = await readIndex()
  return [...index].sort((a, b) => b.startedAt - a.startedAt)
}

/** Load a full run record, or null if missing. */
export async function getRun(id: string): Promise<RunRecord | null> {
  try {
    return JSON.parse(await fs.readFile(runPath(id), 'utf8')) as RunRecord
  } catch {
    return null
  }
}

/** Delete a single run and drop it from the index. */
export async function deleteRun(id: string): Promise<void> {
  await fs.rm(runPath(id), { force: true })
  await withLock(async () => writeIndex((await readIndex()).filter((s) => s.id !== id)))
}

/** Delete all runs and the index. */
export async function clearRuns(): Promise<void> {
  await withLock(async () => {
    const index = await readIndex()
    await Promise.all(index.map((s) => fs.rm(runPath(s.id), { force: true })))
    await fs.rm(indexPath(), { force: true })
  })
}
