// Entry point for the Discord control bot.
//
// Required env:
//   LOCALAI_DISCORD_TOKEN        the bot token (keep secret; never commit)
//   LOCALAI_PROJECT              absolute path to the project folder to work in
// Optional env:
//   LOCALAI_DISCORD_CHANNEL_ID   restrict to one channel (recommended)
//   LOCALAI_OLLAMA_HOSTS / LOCALAI_SCAN   discovery (see the MCP docs)
//
// The bot needs the "Message Content Intent" enabled in the Discord developer portal.
// Run: npm run bot

import { runBot } from '../src/bot/discordBot'

const token = process.env.LOCALAI_DISCORD_TOKEN
const projectRoot = process.env.LOCALAI_PROJECT
const channelId = process.env.LOCALAI_DISCORD_CHANNEL_ID ?? ''

if (!token || !projectRoot) {
  console.error('Set LOCALAI_DISCORD_TOKEN and LOCALAI_PROJECT (and ideally LOCALAI_DISCORD_CHANNEL_ID).')
  process.exit(2)
}

runBot({ token, projectRoot, channelId }).catch((err) => {
  console.error('bot fatal:', err)
  process.exit(1)
})
