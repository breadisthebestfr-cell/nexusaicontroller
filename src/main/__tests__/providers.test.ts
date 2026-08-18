import { describe, expect, it } from 'vitest'
import { DEFAULT_BASE, isQuotaError, parseAnthropicDelta, parseModelList, parseOpenAIDelta } from '../providers'

describe('parseOpenAIDelta', () => {
  it('reads the streamed content delta', () => {
    expect(parseOpenAIDelta(JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] }))).toBe('Hi')
  })
  it('returns null for role-only / finish chunks and junk', () => {
    expect(parseOpenAIDelta(JSON.stringify({ choices: [{ delta: {} }] }))).toBeNull()
    expect(parseOpenAIDelta('not json')).toBeNull()
  })
})

describe('parseAnthropicDelta', () => {
  it('reads content_block_delta text', () => {
    expect(parseAnthropicDelta(JSON.stringify({ type: 'content_block_delta', delta: { text: 'Yo' } }))).toBe('Yo')
  })
  it('ignores other event types', () => {
    expect(parseAnthropicDelta(JSON.stringify({ type: 'message_start' }))).toBeNull()
    expect(parseAnthropicDelta('{bad')).toBeNull()
  })
})

describe('DEFAULT_BASE', () => {
  it('has the known providers', () => {
    expect(DEFAULT_BASE.openai).toContain('openai.com')
    expect(DEFAULT_BASE.anthropic).toContain('anthropic.com')
    expect(DEFAULT_BASE.xai).toContain('x.ai')
  })
  it('has the OpenAI-compatible providers', () => {
    expect(DEFAULT_BASE.gemini).toContain('generativelanguage.googleapis.com')
    expect(DEFAULT_BASE.groq).toContain('groq.com')
    expect(DEFAULT_BASE.openrouter).toContain('openrouter.ai')
  })
})

describe('parseModelList', () => {
  it('reads OpenAI-style { data: [{ id }] }', () => {
    expect(parseModelList({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] })).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })
  it('reads { models: [...] } and strips the Gemini "models/" prefix', () => {
    expect(parseModelList({ models: [{ name: 'models/gemini-2.0-flash' }] })).toEqual(['gemini-2.0-flash'])
  })
  it('dedupes and sorts', () => {
    expect(parseModelList({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }] })).toEqual(['a', 'b'])
  })
  it('returns [] for junk shapes', () => {
    expect(parseModelList({})).toEqual([])
    expect(parseModelList('nope')).toEqual([])
  })

  it('freeOnly keeps zero-priced models and ":free" ids', () => {
    const body = {
      data: [
        { id: 'paid/model', pricing: { prompt: '0.001', completion: '0.002' } },
        { id: 'free/model', pricing: { prompt: '0', completion: '0' } },
        { id: 'community/thing:free' }
      ]
    }
    expect(parseModelList(body, true)).toEqual(['community/thing:free', 'free/model'])
  })

  it('freeOnly returns [] when no pricing info is present', () => {
    expect(parseModelList({ data: [{ id: 'gpt-4o' }] }, true)).toEqual([])
  })
})

describe('isQuotaError', () => {
  it('flags quota / credit / rate-limit errors', () => {
    expect(isQuotaError('OpenAI-compatible request failed: HTTP 429 rate limit')).toBe(true)
    expect(isQuotaError('HTTP 402 insufficient_quota')).toBe(true)
    expect(isQuotaError('You have insufficient credit balance')).toBe(true)
    expect(isQuotaError('billing hard limit reached')).toBe(true)
  })
  it('ignores unrelated errors', () => {
    expect(isQuotaError('HTTP 404 model not found')).toBe(false)
    expect(isQuotaError('connection refused')).toBe(false)
  })
})

describe('parseModelList non-chat', () => {
  it('drops non-chat models (guard, whisper, embeddings, tts, image)', () => {
    const body = {
      data: [
        { id: 'llama-3.3-70b-versatile' },
        { id: 'llama-guard-4-12b' },
        { id: 'whisper-large-v3' },
        { id: 'text-embedding-3-small' },
        { id: 'playai-tts' },
        { id: 'dall-e-3' },
        { id: 'gpt-4o' }
      ]
    }
    expect(parseModelList(body)).toEqual(['gpt-4o', 'llama-3.3-70b-versatile'])
  })
})
