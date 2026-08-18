import { describe, expect, it } from 'vitest'
import { HELP, handleCommand, parseCommand, type BotEngine } from '../commands'

describe('parseCommand', () => {
  it('parses name + args', () => {
    expect(parseCommand('!start build a game')).toEqual({ name: 'start', args: 'build a game' })
    expect(parseCommand('!status')).toEqual({ name: 'status', args: '' })
  })
  it('returns null for non-commands', () => {
    expect(parseCommand('hello')).toBeNull()
    expect(parseCommand('!')).toBeNull()
  })
})

/** A fake engine that records calls. */
function fakeEngine(running = false): BotEngine & { started: string[]; stopped: number } {
  let isRunning = running
  const started: string[] = []
  let stopped = 0
  return {
    started,
    get stopped() {
      return stopped
    },
    isRunning: () => isRunning,
    async start(goal) {
      started.push(goal)
      isRunning = true
      return { ok: true, message: `Started on: ${goal}` }
    },
    async stop() {
      stopped++
      isRunning = false
      return { ok: true, message: 'Stopping…' }
    },
    async status() {
      return isRunning ? 'Running' : 'Idle'
    }
  }
}

describe('handleCommand', () => {
  it('help returns the help text', async () => {
    expect(await handleCommand({ name: 'help', args: '' }, fakeEngine())).toBe(HELP)
  })

  it('start requires a goal and launches when idle', async () => {
    const eng = fakeEngine()
    expect(await handleCommand({ name: 'start', args: '' }, eng)).toContain('Usage')
    expect(eng.started).toEqual([])

    const reply = await handleCommand({ name: 'start', args: 'make a mod' }, eng)
    expect(reply).toContain('make a mod')
    expect(eng.started).toEqual(['make a mod'])
  })

  it('start refuses when already running', async () => {
    const eng = fakeEngine(true)
    expect(await handleCommand({ name: 'start', args: 'x' }, eng)).toContain('already running')
    expect(eng.started).toEqual([])
  })

  it('stop works only when running', async () => {
    expect(await handleCommand({ name: 'stop', args: '' }, fakeEngine(false))).toContain('No session')
    const eng = fakeEngine(true)
    await handleCommand({ name: 'stop', args: '' }, eng)
    expect(eng.stopped).toBe(1)
  })

  it('unknown command hints at help', async () => {
    expect(await handleCommand({ name: 'frobnicate', args: '' }, fakeEngine())).toContain('help')
  })
})
