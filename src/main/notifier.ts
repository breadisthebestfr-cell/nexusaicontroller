// Outbound Discord notifications via an incoming webhook.
//
// A webhook is send-only: it can post messages to a channel but cannot receive
// commands (that's the bot, in src/bot). Electron-free so the app, the headless
// continuous runner, and the MCP server can all use it.
//
// Discord webhook API: POST { content } to the URL; 204 on success, 429 with a
// retry when rate-limited. Content is capped at 2000 chars.

const MAX_LEN = 1900

export type NotifyLevel = 'info' | 'success' | 'warn' | 'error'

const EMOJI: Record<NotifyLevel, string> = {
  info: 'ℹ️',
  success: '✅',
  warn: '⚠️',
  error: '❌'
}

/**
 * Post a message to a Discord webhook. Never throws — on any failure it logs to
 * stderr and resolves false, so notifications can't break the work they report on.
 * When `mentionUserId` is given, that user is allowed to be pinged (so a leading
 * `<@id>` in the content actually notifies them).
 */
export async function postWebhook(url: string, content: string, mentionUserId?: string): Promise<boolean> {
  if (!url) return false
  const payload: Record<string, unknown> = { content: content.slice(0, MAX_LEN) }
  if (mentionUserId) payload.allowed_mentions = { parse: [], users: [mentionUserId] }
  const body = JSON.stringify(payload)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    })
    if (res.status === 429) {
      // Rate-limited — best effort, skip this one.
      console.error('[notifier] rate-limited by Discord; dropped a message')
      return false
    }
    return res.ok || res.status === 204
  } catch (err) {
    console.error('[notifier] webhook post failed:', (err as Error).message)
    return false
  }
}

/** Format a leveled line with an emoji + a bold app tag. */
export function formatMessage(level: NotifyLevel, text: string): string {
  return `${EMOJI[level]} **LocalAIConnection** — ${text}`
}

/**
 * A small notifier bound to one webhook URL. When the URL is empty it is a no-op,
 * so callers can always call it without checking configuration.
 */
export class Notifier {
  constructor(
    private readonly webhookUrl: string | undefined,
    private readonly mentionUserId?: string
  ) {}

  get enabled(): boolean {
    return !!this.webhookUrl
  }

  async send(level: NotifyLevel, text: string): Promise<void> {
    if (!this.webhookUrl) return
    const mention = this.mentionUserId ? `<@${this.mentionUserId}> ` : ''
    await postWebhook(this.webhookUrl, mention + formatMessage(level, text), this.mentionUserId)
  }

  /** Raw content (already formatted by the caller). */
  async raw(content: string): Promise<void> {
    if (!this.webhookUrl) return
    await postWebhook(this.webhookUrl, content, this.mentionUserId)
  }
}
