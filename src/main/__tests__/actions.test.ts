import { describe, expect, it } from 'vitest'
import {
  buildJarvisSystemPrompt,
  IMPLEMENTED_ACTIONS,
  isSafeAction,
  parseActions,
  SAFE_ACTIONS,
  stripActions
} from '../actions'

describe('parseActions', () => {
  it('parses a single action with JSON args', () => {
    const actions = parseActions('Sure!\nACTION: open_app {"name":"Firefox"}')
    expect(actions).toEqual([{ name: 'open_app', args: { name: 'Firefox' } }])
  })

  it('parses multiple actions, one per line', () => {
    const text = [
      'On it.',
      'ACTION: open_app {"name":"Notepad"}',
      'ACTION: create_document {"filename":"routine.txt","content":"Wake up"}'
    ].join('\n')
    const actions = parseActions(text)
    expect(actions).toHaveLength(2)
    expect(actions[0].name).toBe('open_app')
    expect(actions[1].name).toBe('create_document')
    expect(actions[1].args.filename).toBe('routine.txt')
  })

  it('accepts an action with no args (empty object)', () => {
    expect(parseActions('ACTION: say')).toEqual([{ name: 'say', args: {} }])
  })

  it('lowercases the action name and tolerates ACTION casing', () => {
    expect(parseActions('action: OPEN_URL {"url":"https://x.com"}')).toEqual([
      { name: 'open_url', args: { url: 'https://x.com' } }
    ])
  })

  it('leaves args empty when the JSON is malformed', () => {
    expect(parseActions('ACTION: open_app {not valid json}')).toEqual([{ name: 'open_app', args: {} }])
  })

  it('ignores non-action lines', () => {
    expect(parseActions('just a normal reply\nno actions here')).toEqual([])
  })

  it('tolerates markdown wrapping (backticks, bullets) around the ACTION line', () => {
    expect(parseActions('On it.\n`ACTION: open_url {"url":"https://x.com"}`')).toEqual([
      { name: 'open_url', args: { url: 'https://x.com' } }
    ])
    expect(parseActions('- ACTION: open_app {"name":"Firefox"}')).toEqual([
      { name: 'open_app', args: { name: 'Firefox' } }
    ])
  })

  it('tolerates smart quotes in the args JSON', () => {
    expect(parseActions('ACTION: open_url {“url”:“https://x.com”}')).toEqual([
      { name: 'open_url', args: { url: 'https://x.com' } }
    ])
  })
})

describe('stripActions', () => {
  it('removes ACTION lines and trims the prose', () => {
    const text = 'Opening Firefox for you.\nACTION: open_app {"name":"Firefox"}'
    expect(stripActions(text)).toBe('Opening Firefox for you.')
  })

  it('returns empty string when the reply is only actions', () => {
    expect(stripActions('ACTION: say {"text":"hi"}')).toBe('')
  })

  it('keeps multi-line prose intact', () => {
    const text = 'Line one.\nACTION: open_app {"name":"Notepad"}\nLine two.'
    expect(stripActions(text)).toBe('Line one.\nLine two.')
  })
})

describe('isSafeAction', () => {
  it('treats the safe actions as safe', () => {
    for (const a of SAFE_ACTIONS) expect(isSafeAction(a)).toBe(true)
  })

  it('does not treat run_command as safe', () => {
    expect(isSafeAction('run_command')).toBe(false)
  })

  it('run_command is implemented even though it is not safe', () => {
    expect((IMPLEMENTED_ACTIONS as readonly string[]).includes('run_command')).toBe(true)
  })

  it('unknown actions are neither safe nor implemented', () => {
    expect(isSafeAction('format_disk')).toBe(false)
    expect((IMPLEMENTED_ACTIONS as readonly string[]).includes('format_disk')).toBe(false)
  })
})

describe('buildJarvisSystemPrompt', () => {
  const apps = { Notepad: 'notepad', Firefox: 'firefox' }

  it('names the assistant and lists the known apps', () => {
    const p = buildJarvisSystemPrompt('Aku', apps, 'allowlist')
    expect(p).toContain('You are Aku')
    expect(p).toContain('Notepad, Firefox')
  })

  it('describes trust mode when trusted', () => {
    expect(buildJarvisSystemPrompt('Jarvis', apps, 'trust')).toContain('TRUST mode')
  })

  it('describes allowlist mode otherwise', () => {
    expect(buildJarvisSystemPrompt('Jarvis', apps, 'allowlist')).toContain('ALLOWLIST mode')
  })

  it('handles an empty app map gracefully', () => {
    expect(buildJarvisSystemPrompt('Jarvis', {}, 'allowlist')).toContain('none configured')
  })
})
