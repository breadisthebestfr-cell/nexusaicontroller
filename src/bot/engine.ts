// Bridges the bot's commands to the continuous engine. discord.js-free so it is
// testable; discordBot.ts supplies `broadcast` (channel.send) and `getInstances`.

import { runContinuous } from '../main/continuous'
import { pickBestModel } from '../shared/modelRanking'
import type { OllamaInstance } from '../shared/types'
import type { BotEngine } from './commands'

export interface EngineDeps {
  projectRoot: string
  getInstances: () => Promise<OllamaInstance[]>
  /** Push a line to the Discord channel. */
  broadcast: (text: string) => void
  maxCycles?: number
  cycleDelayMs?: number
}

export function createContinuousBotEngine(deps: EngineDeps): BotEngine {
  let controller: AbortController | null = null
  const state = { goal: '', cycle: 0, step: '' }

  return {
    isRunning: () => controller !== null,

    async start(goal) {
      if (controller) return { ok: false, message: 'already running' }
      const instances = await deps.getInstances()
      const best = pickBestModel(instances, { preferCoding: true })
      if (!best) return { ok: false, message: 'No online models found — cannot start.' }

      controller = new AbortController()
      state.goal = goal
      state.cycle = 0
      state.step = 'starting'
      const coder = { role: 'coder' as const, baseUrl: best.baseUrl, model: best.model }
      const reviewer = { role: 'reviewer' as const, baseUrl: best.baseUrl, model: best.model }

      // Fire and forget — updates stream to the channel via broadcast.
      runContinuous(
        {
          goal,
          projectRoot: deps.projectRoot,
          agents: { coder, reviewer },
          maxCycles: deps.maxCycles ?? 20,
          cycleDelayMs: deps.cycleDelayMs ?? 2000,
          stallThreshold: 3,
          gitAutoCommit: true
        },
        {
          signal: controller.signal,
          onCycleStart: (cycle, step) => {
            state.cycle = cycle
            state.step = step
            deps.broadcast(`▶ Cycle ${cycle}: ${step}`)
          },
          onTurn: () => {},
          onCycleEnd: (r) => deps.broadcast(`  ↳ ${r.filesWritten.length} file(s), commit ${r.commit ?? 'none'}`),
          onDone: (reason, cycles, message) => {
            controller = null
            deps.broadcast(`■ Ended (${reason}) after ${cycles} cycle(s): ${message}`)
          },
          onError: (m) => deps.broadcast(`⚠ Error: ${m}`)
        }
      )

      return { ok: true, message: `Started on: ${goal}\ncoder: ${best.model}` }
    },

    async stop() {
      if (!controller) return { ok: false, message: 'nothing running' }
      controller.abort()
      controller = null
      return { ok: true, message: 'Stopping the session…' }
    },

    async status() {
      const online = (await deps.getInstances()).filter((i) => i.online).length
      if (!controller) return `Idle. ${online} instance(s) online. Use \`!start <goal>\`.`
      return `Running — cycle ${state.cycle}: ${state.step}\nGoal: ${state.goal}`
    }
  }
}
