// discord.js gateway wiring for the control bot. Thin glue over engine.ts + commands.ts.

import { Client, Events, GatewayIntentBits, type TextChannel } from 'discord.js'
import { ToolContext, configFromEnv } from '../mcp/tools'
import { createContinuousBotEngine } from './engine'
import { handleCommand, parseCommand } from './commands'

export interface BotConfig {
  token: string
  /** Restrict commands + updates to this channel (empty = any channel the bot sees). */
  channelId: string
  projectRoot: string
}

export async function runBot(config: BotConfig): Promise<void> {
  const ctx = new ToolContext(configFromEnv())
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
  })

  const broadcast = (text: string): void => {
    if (!config.channelId) return
    const ch = client.channels.cache.get(config.channelId) as TextChannel | undefined
    ch?.send(text.slice(0, 1900)).catch(() => {})
  }

  const engine = createContinuousBotEngine({
    projectRoot: config.projectRoot,
    getInstances: () => ctx.getInstances(false),
    broadcast
  })

  client.once(Events.ClientReady, (c) => {
    console.error(`[bot] logged in as ${c.user.tag}`)
    broadcast('🤖 LocalAIConnection bot online. Type `!help`.')
  })

  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return
    if (config.channelId && msg.channelId !== config.channelId) return
    const cmd = parseCommand(msg.content)
    if (!cmd) return
    try {
      const reply = await handleCommand(cmd, engine)
      await msg.reply(reply.slice(0, 1900))
    } catch (err) {
      await msg.reply(`Error: ${(err as Error).message}`).catch(() => {})
    }
  })

  await client.login(config.token)
}
