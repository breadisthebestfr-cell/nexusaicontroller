// Entry point: run the LocalAIConnection MCP server over stdio.
//
// Register with Claude Code:
//   claude mcp add localai -- npx -y tsx /ABS/PATH/localaiconnection/src/mcp/index.ts
//
// Optional env:
//   LOCALAI_OLLAMA_HOSTS="192.168.1.20:11434,192.168.1.30:11434"  pinned hosts
//   LOCALAI_SCAN=0                                                 disable the LAN sweep
//   LOCALAI_CACHE_TTL_MS=30000                                     discovery cache TTL

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildServer } from './server'
import { configFromEnv, log } from './tools'

async function main(): Promise<void> {
  const config = configFromEnv()
  log(
    `starting — scan=${config.scanEnabled ? 'on' : 'off'}, pinned=${config.pinnedHosts.length}, ` +
      `cacheTtl=${config.cacheTtlMs}ms`
  )
  const server = buildServer(config)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  log('connected over stdio')
}

main().catch((err) => {
  log('fatal:', err)
  process.exit(1)
})
