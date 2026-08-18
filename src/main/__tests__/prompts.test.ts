import { describe, expect, it } from 'vitest'
import { DEFAULT_ROLE_PROMPTS, HOUSE_RULES, parseQuestions, systemPromptFor } from '../prompts'

describe('systemPromptFor', () => {
  it('combines house rules with the tuned role default', () => {
    const p = systemPromptFor('coder')
    expect(p).toContain(HOUSE_RULES)
    expect(p).toContain(DEFAULT_ROLE_PROMPTS.coder)
    expect(p).toContain('FILE:') // the coder gets the format example
  })

  it('uses an override when provided', () => {
    const p = systemPromptFor('planner', { planner: 'CUSTOM PLANNER PROMPT' })
    expect(p).toBe('CUSTOM PLANNER PROMPT')
    expect(p).not.toContain(HOUSE_RULES)
  })

  it('ignores blank/whitespace overrides', () => {
    const p = systemPromptFor('reviewer', { reviewer: '   ' })
    expect(p).toContain(HOUSE_RULES)
    expect(p).toContain(DEFAULT_ROLE_PROMPTS.reviewer)
  })
})

describe('parseQuestions', () => {
  it('parses "Q:" prefixed questions and caps at 3', () => {
    const text = 'Q: What language?\nQ: Which framework?\nQ: Target OS?\nQ: A fourth one?'
    expect(parseQuestions(text)).toEqual(['What language?', 'Which framework?', 'Target OS?'])
  })
  it('parses bulleted or plain question-mark lines', () => {
    expect(parseQuestions('- Should it be async?\n2. What port?')).toEqual(['Should it be async?', 'What port?'])
  })
  it('returns [] on NONE', () => {
    expect(parseQuestions('NONE')).toEqual([])
  })
  it('ignores non-question prose', () => {
    expect(parseQuestions('I will start now.\nHere is my plan.')).toEqual([])
  })
})
