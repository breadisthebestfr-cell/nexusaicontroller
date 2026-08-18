import { afterEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import { Notifier, formatMessage, postWebhook } from '../notifier'

/** A tiny server that captures the last POST body and returns a chosen status. */
function captureServer(status = 204): Promise<{ server: http.Server; url: string; bodies: string[] }> {
  const bodies: string[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      bodies.push(body)
      res.writeHead(status)
      res.end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${addr.port}`, bodies })
    })
  })
}

describe('formatMessage', () => {
  it('prefixes an emoji and the app tag', () => {
    expect(formatMessage('error', 'boom')).toBe('❌ **LocalAIConnection** — boom')
  })
})

describe('postWebhook', () => {
  let ctx: Awaited<ReturnType<typeof captureServer>>
  afterEach(() => ctx?.server.close())

  it('POSTs a JSON {content} body and returns true on 204', async () => {
    ctx = await captureServer(204)
    const ok = await postWebhook(ctx.url, 'hello world')
    expect(ok).toBe(true)
    expect(JSON.parse(ctx.bodies[0])).toEqual({ content: 'hello world' })
  })

  it('returns false on 429 (rate limited)', async () => {
    ctx = await captureServer(429)
    expect(await postWebhook(ctx.url, 'x')).toBe(false)
  })

  it('returns false for an empty url without throwing', async () => {
    expect(await postWebhook('', 'x')).toBe(false)
  })

  it('truncates very long content', async () => {
    ctx = await captureServer(204)
    await postWebhook(ctx.url, 'a'.repeat(5000))
    expect(JSON.parse(ctx.bodies[0]).content.length).toBeLessThanOrEqual(1900)
  })
})

describe('Notifier', () => {
  it('is disabled with no url and a no-op send does not throw', async () => {
    const n = new Notifier(undefined)
    expect(n.enabled).toBe(false)
    await n.send('info', 'ignored')
  })

  it('sends a formatted message when enabled', async () => {
    const ctx = await captureServer(204)
    const n = new Notifier(ctx.url)
    expect(n.enabled).toBe(true)
    await n.send('success', 'done')
    expect(JSON.parse(ctx.bodies[0]).content).toBe('✅ **LocalAIConnection** — done')
    ctx.server.close()
  })

  it('prepends a mention and allows the ping when a user id is set', async () => {
    const ctx = await captureServer(204)
    const n = new Notifier(ctx.url, '42')
    await n.send('info', 'ping me')
    const body = JSON.parse(ctx.bodies[0])
    expect(body.content).toBe('<@42> ℹ️ **LocalAIConnection** — ping me')
    expect(body.allowed_mentions).toEqual({ parse: [], users: ['42'] })
    ctx.server.close()
  })
})
