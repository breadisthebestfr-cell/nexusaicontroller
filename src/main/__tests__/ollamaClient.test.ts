import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { baseUrlFor, buildChatBody, listRunningModels, parsePs, parseStats, parseTags, pullModel } from '../ollamaClient'
import { startMockOllama } from '../../../scripts/mock-ollama'

describe('parseStats', () => {
  it('computes tokens/sec and total ms', () => {
    const s = parseStats({ eval_count: 20, eval_duration: 500_000_000, total_duration: 700_000_000 })
    expect(s).not.toBeNull()
    expect(s!.tokensPerSec).toBeCloseTo(40)
    expect(s!.evalCount).toBe(20)
    expect(s!.totalMs).toBeCloseTo(700)
  })
  it('returns null without eval_count', () => {
    expect(parseStats({})).toBeNull()
  })
})

describe('parsePs', () => {
  it('extracts loaded model names', () => {
    expect(parsePs({ models: [{ name: 'a' }, { name: 'b' }] })).toEqual(['a', 'b'])
    expect(parsePs({})).toEqual([])
    expect(parsePs(null)).toEqual([])
  })
})

describe('model management against a mock', () => {
  let server: Server
  const port = 26234
  const baseUrl = `http://127.0.0.1:${port}`
  beforeAll(async () => {
    server = await startMockOllama(port)
  })
  afterAll(() => server.close())

  it('listRunningModels returns the loaded model', async () => {
    const running = await listRunningModels(baseUrl)
    expect(running).toContain('qwen2.5-coder:7b')
  })

  it('pullModel streams progress and completes', async () => {
    const statuses: string[] = []
    let done = false
    await pullModel(baseUrl, 'some-model', {
      onProgress: (status) => statuses.push(status),
      onDone: () => (done = true),
      onError: (m) => {
        throw new Error(m)
      }
    })
    expect(done).toBe(true)
    expect(statuses).toContain('pulling manifest')
    expect(statuses).toContain('success')
  })
})

describe('buildChatBody', () => {
  it('always sets model, messages, and stream', () => {
    const body = JSON.parse(buildChatBody('m', [{ role: 'user', content: 'hi' }]))
    expect(body).toMatchObject({ model: 'm', stream: true })
    expect(body.messages).toHaveLength(1)
    expect(body.options).toBeUndefined()
  })

  it('includes options only when provided', () => {
    const body = JSON.parse(buildChatBody('m', [], { temperature: 0.2 }))
    expect(body.options).toEqual({ temperature: 0.2 })
  })

  it('includes num_ctx when set', () => {
    const body = JSON.parse(buildChatBody('m', [], { temperature: 0.5, num_ctx: 8192 }))
    expect(body.options).toEqual({ temperature: 0.5, num_ctx: 8192 })
  })
})

describe('baseUrlFor', () => {
  it('builds a base url', () => {
    expect(baseUrlFor('192.168.1.5', 11434)).toBe('http://192.168.1.5:11434')
  })
})

describe('parseTags', () => {
  it('maps the /api/tags payload into model records', () => {
    const models = parseTags({
      models: [
        {
          name: 'llama3.1:8b',
          size: 123,
          details: { parameter_size: '8B', quantization_level: 'Q4_K_M' }
        }
      ]
    })
    expect(models).toEqual([
      { name: 'llama3.1:8b', size: 123, parameterSize: '8B', quantization: 'Q4_K_M' }
    ])
  })

  it('handles missing / malformed payloads gracefully', () => {
    expect(parseTags(null)).toEqual([])
    expect(parseTags({})).toEqual([])
    expect(parseTags({ models: [{ notName: true }] })).toEqual([])
  })
})
