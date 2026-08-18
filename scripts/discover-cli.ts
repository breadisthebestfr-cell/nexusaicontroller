// Headless discovery check — runnable without Electron or a GUI.
// Probes a set of loopback ports (default 11434) and prints any Ollama instances found.
// Pair with `npm run mock` to verify end-to-end:
//   Terminal A: npm run mock -- 11434 11435
//   Terminal B: npm run discover -- 11434 11435

import { inspectInstance } from '../src/main/discovery'

async function main(): Promise<void> {
  const ports = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0)
  const chosen = ports.length ? ports : [11434]

  console.log(`Probing 127.0.0.1 on ports: ${chosen.join(', ')}`)
  const results = await Promise.all(chosen.map((p) => inspectInstance('127.0.0.1', p, 'scan', 1000)))

  const online = results.filter((r) => r.online)
  if (online.length === 0) {
    console.log('No instances found. Is `npm run mock` (or real Ollama) running?')
    process.exitCode = 1
    return
  }
  for (const inst of online) {
    console.log(`\n✓ ${inst.id}  (Ollama v${inst.version})`)
    for (const m of inst.models) {
      console.log(`    - ${m.name}${m.parameterSize ? ` (${m.parameterSize})` : ''}`)
    }
  }
}

main()
