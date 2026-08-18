// One-command webhook self-test — verify your Discord webhook from a terminal
// without opening the app or pasting anything into a chat.
//
// Usage:
//   npm run notify:test -- "<webhook-url>" "your message here"
//   # optional ping: set LOCALAI_DISCORD_MENTION_USER_ID=<your id>
//
// The webhook URL stays on your machine — it's a command argument, nothing more.

import { postWebhook } from '../src/main/notifier'

async function main(): Promise<void> {
  const url = process.argv[2]
  const message = process.argv.slice(3).join(' ') || 'LocalAIConnection webhook test ✅'
  if (!url) {
    console.error('Usage: npm run notify:test -- "<webhook-url>" "message"')
    process.exit(2)
  }
  const mention = process.env.LOCALAI_DISCORD_MENTION_USER_ID
  const content = (mention ? `<@${mention}> ` : '') + message
  const ok = await postWebhook(url, content, mention)
  console.log(ok ? 'Sent — check your Discord channel.' : 'Failed — check the webhook URL.')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
