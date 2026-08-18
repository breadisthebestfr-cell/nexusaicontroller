// Pure command dispatcher for the Discord control bot. No discord.js here so it is
// unit-testable; the gateway wiring in discordBot.ts is thin glue over this.

/** The engine the bot drives (continuous mode). Abstracted so commands are testable. */
export interface BotEngine {
  isRunning(): boolean
  start(goal: string): Promise<{ ok: boolean; message: string }>
  stop(): Promise<{ ok: boolean; message: string }>
  status(): Promise<string>
}

export interface ParsedCommand {
  name: string
  args: string
}

/** Parse a `!command args` message. Returns null when it isn't a command. */
export function parseCommand(text: string, prefix = '!'): ParsedCommand | null {
  if (!text.startsWith(prefix)) return null
  const body = text.slice(prefix.length).trim()
  if (!body) return null
  const sp = body.indexOf(' ')
  if (sp === -1) return { name: body.toLowerCase(), args: '' }
  return { name: body.slice(0, sp).toLowerCase(), args: body.slice(sp + 1).trim() }
}

export const HELP = [
  '**LocalAIConnection bot**',
  '`!start <goal>` — start a continuous session on the configured project folder',
  '`!stop` — stop the running session',
  '`!status` — show whether a session is running and the current cycle/step',
  '`!help` — this message'
].join('\n')

/** Route a parsed command to the engine and return the reply text. */
export async function handleCommand(cmd: ParsedCommand, engine: BotEngine): Promise<string> {
  switch (cmd.name) {
    case 'help':
      return HELP
    case 'status':
      return engine.status()
    case 'start':
      if (!cmd.args) return 'Usage: `!start <goal>`'
      if (engine.isRunning()) return 'A session is already running — use `!stop` first.'
      return (await engine.start(cmd.args)).message
    case 'stop':
      if (!engine.isRunning()) return 'No session is running.'
      return (await engine.stop()).message
    default:
      return `Unknown command \`${cmd.name}\`. Try \`!help\`.`
  }
}
