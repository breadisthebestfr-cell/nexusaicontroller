// Headless continuous runner — run an autonomous session without the GUI.
//
// Usage:
//   LOCALAI_OLLAMA_HOSTS=192.168.1.20:11434 LOCALAI_SCAN=0 \
//     tsx scripts/continuous-cli.ts <projectDir> "<goal>"
//
// Env: LOCALAI_OLLAMA_HOSTS / LOCALAI_SCAN (discovery, see the MCP docs),
//      LOCALAI_MAX_CYCLES (default 5), LOCALAI_CYCLE_DELAY_MS (default 0).
// The coder is auto-picked (strongest coding model); a reviewer is added when a
// second model is available.

import { ToolContext, configFromEnv } from '../src/mcp/tools'
import { pickBestModel } from '../src/shared/modelRanking'
import { runContinuous } from '../src/main/continuous'
import { Notifier } from '../src/main/notifier'

async function main(): Promise<void> {
  const projectRoot = process.argv[2] ?? process.env.LOCALAI_PROJECT
  const goal = process.argv.slice(3).join(' ') || process.env.LOCALAI_GOAL
  if (!projectRoot || !goal) {
    console.error('Usage: tsx scripts/continuous-cli.ts <projectDir> "<goal>"')
    process.exit(2)
  }

  const ctx = new ToolContext(configFromEnv())
  const instances = await ctx.getInstances(true)
  const best = pickBestModel(instances, { preferCoding: true })
  if (!best) {
    console.error('No online models found. Set LOCALAI_OLLAMA_HOSTS or start Ollama/the mock.')
    process.exit(1)
  }
  const coder = { role: 'coder' as const, baseUrl: best.baseUrl, model: best.model }
  const reviewer = { role: 'reviewer' as const, baseUrl: best.baseUrl, model: best.model }
  console.error(`[continuous] coder = ${coder.model} @ ${best.instanceId}`)

  const controller = new AbortController()
  process.on('SIGINT', () => controller.abort())

  const notifier = new Notifier(process.env.LOCALAI_DISCORD_WEBHOOK, process.env.LOCALAI_DISCORD_MENTION_USER_ID)
  await notifier.send('info', `Continuous session started: ${goal}`)

  await runContinuous(
    {
      goal,
      projectRoot,
      agents: { coder, reviewer },
      maxCycles: Number(process.env.LOCALAI_MAX_CYCLES) || 5,
      cycleDelayMs: Number(process.env.LOCALAI_CYCLE_DELAY_MS) || 0,
      stallThreshold: 3,
      gitAutoCommit: true
    },
    {
      signal: controller.signal,
      onCycleStart: (cycle, step) => console.error(`\n[cycle ${cycle}] ${step}`),
      onTurn: () => {},
      onCycleEnd: (r) => {
        console.error(`  files: ${r.filesWritten.join(', ') || 'none'} · commit ${r.commit ?? 'none'}`)
        notifier.send('info', `Cycle ${r.cycle}: ${r.step} — ${r.filesWritten.length} file(s), commit ${r.commit ?? 'none'}`)
      },
      onDone: (reason, cycles, message) => {
        console.error(`\n[done] ${reason} after ${cycles} cycle(s): ${message}`)
        notifier.send(reason === 'error' ? 'error' : reason === 'goal-complete' ? 'success' : 'warn', `Session ended (${reason}) after ${cycles} cycle(s): ${message}`)
      },
      onError: (m) => console.error(`[error] ${m}`)
    }
  )
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
