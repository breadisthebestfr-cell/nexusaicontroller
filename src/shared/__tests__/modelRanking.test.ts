import { describe, expect, it } from 'vitest'
import { parseParamB, pickBestModel, type ModelCandidate } from '../modelRanking'

const c = (model: string, parameterSize?: string, size?: number): ModelCandidate => ({
  instanceId: 'i',
  baseUrl: 'http://i',
  model,
  parameterSize,
  size
})

describe('parseParamB', () => {
  it('reads the parameterSize field', () => {
    expect(parseParamB({ model: 'x', parameterSize: '14B' })).toBe(14)
    expect(parseParamB({ model: 'x', parameterSize: '1.5B' })).toBe(1.5)
  })
  it('falls back to the tag name', () => {
    expect(parseParamB({ model: 'qwen2.5-coder:7b' })).toBe(7)
    expect(parseParamB({ model: 'llama3.1:70b' })).toBe(70)
  })
  it('returns 0 when unknown', () => {
    expect(parseParamB({ model: 'mystery' })).toBe(0)
  })
})

describe('pickBestModel', () => {
  it('prefers coding models when preferCoding is set', () => {
    const best = pickBestModel([c('llama3.1:14b', '14B'), c('qwen2.5-coder:7b', '7B')], { preferCoding: true })
    expect(best?.model).toBe('qwen2.5-coder:7b')
  })

  it('among coding models, picks the largest', () => {
    const best = pickBestModel(
      [c('qwen2.5-coder:7b', '7B'), c('deepseek-coder:14b', '14B')],
      { preferCoding: true }
    )
    expect(best?.model).toBe('deepseek-coder:14b')
  })

  it('without preferCoding, picks the largest regardless of name', () => {
    const best = pickBestModel([c('qwen2.5-coder:7b', '7B'), c('llama3.1:14b', '14B')], { preferCoding: false })
    expect(best?.model).toBe('llama3.1:14b')
  })

  it('returns null for no candidates', () => {
    expect(pickBestModel([], { preferCoding: true })).toBeNull()
  })
})
