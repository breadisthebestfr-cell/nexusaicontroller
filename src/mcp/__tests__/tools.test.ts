import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startMockOllama } from '../../../scripts/mock-ollama'
import {
  ToolContext,
  askModel,
  cloudConfigFromEnv,
  configFromEnv,
  listInstances,
  listModels,
  parsePinnedHosts,
  runTask
} from '../tools'

describe('parsePinnedHosts', () => {
  it('parses host:port pairs and defaults the port', () => {
    expect(parsePinnedHosts('192.168.1.20:11434, 10.0.0.5')).toEqual([
      { host: '192.168.1.20', port: 11434 },
      { host: '10.0.0.5', port: 11434 }
    ])
  })
  it('returns [] for empty input', () => {
    expect(parsePinnedHosts(undefined)).toEqual([])
    expect(parsePinnedHosts('')).toEqual([])
  })
})

describe('configFromEnv', () => {
  it('reads scan + pinned hosts from env', () => {
    const cfg = configFromEnv({ LOCALAI_SCAN: '0', LOCALAI_OLLAMA_HOSTS: '127.0.0.1:11434' } as NodeJS.ProcessEnv)
    expect(cfg.scanEnabled).toBe(false)
    expect(cfg.pinnedHosts).toEqual([{ host: '127.0.0.1', port: 11434 }])
  })
})

describe('cloudConfigFromEnv', () => {
  it('reads provider keys, model lists, and base overrides from env', () => {
    const cloud = cloudConfigFromEnv({
      LOCALAI_OPENAI_KEY: 'sk-1',
      LOCALAI_OPENAI_MODELS: 'gpt-4o, gpt-4o-mini',
      LOCALAI_GROQ_KEY: 'gsk-2',
      LOCALAI_GROQ_BASE: 'https://example/v1'
    } as NodeJS.ProcessEnv)
    expect(cloud.openai).toEqual({ apiKey: 'sk-1', baseUrl: undefined, models: ['gpt-4o', 'gpt-4o-mini'] })
    expect(cloud.groq).toEqual({ apiKey: 'gsk-2', baseUrl: 'https://example/v1', models: [] })
    expect(cloud.anthropic).toBeUndefined()
  })
  it('is empty when no keys are set', () => {
    expect(cloudConfigFromEnv({} as NodeJS.ProcessEnv)).toEqual({})
  })
})

describe('tools against a mock Ollama', () => {
  let server: Server
  const port = 24434
  const baseUrl = `http://127.0.0.1:${port}`
  // Scan disabled; the mock is reached purely via a pinned host, keeping the test hermetic.
  const ctx = () => new ToolContext({ pinnedHosts: [{ host: '127.0.0.1', port }], scanEnabled: false, cacheTtlMs: 0 })

  beforeAll(async () => {
    server = await startMockOllama(port)
  })
  afterAll(() => {
    server.close()
  })

  it('list_instances finds the pinned mock', async () => {
    const instances = await listInstances(ctx())
    const found = instances.find((i) => i.baseUrl === baseUrl)
    expect(found).toBeTruthy()
    expect(found!.online).toBe(true)
    expect(found!.modelCount).toBeGreaterThan(0)
  })

  it('list_models returns the mock models', async () => {
    const models = await listModels(ctx())
    expect(models.map((m) => m.model)).toContain('qwen2.5-coder:7b')
    expect(models.every((m) => m.baseUrl.startsWith('http://'))).toBe(true)
  })

  it('ask_model returns a text reply', async () => {
    const reply = await askModel({ baseUrl, model: 'llama3.1:8b', prompt: 'hi' })
    expect(reply.toLowerCase()).toContain('mock')
  })
})

describe('run_multi_agent_task', () => {
  let server: Server
  const port = 24435
  const baseUrl = `http://127.0.0.1:${port}`
  let dir: string

  beforeAll(async () => {
    server = await startMockOllama(port)
  })
  afterAll(() => {
    server.close()
  })
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-run-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('runs the loop and writes files into projectRoot', async () => {
    const result = await runTask({
      task: 'make a hello file',
      projectRoot: dir,
      planner: { baseUrl, model: 'planner-m' },
      coder: { baseUrl, model: 'coder-m' },
      reviewer: { baseUrl, model: 'reviewer-m' },
      maxRounds: 3
    })

    expect(result.filesWritten).toContain('hello.txt')
    expect(result.summary.toLowerCase()).toContain('approved')
    expect(result.transcript.map((t) => t.role)).toEqual(['planner', 'coder', 'reviewer'])
    // File is really on disk inside the sandbox.
    expect(await fs.readFile(path.join(dir, 'hello.txt'), 'utf8')).toContain('Hello from')
  })
})
