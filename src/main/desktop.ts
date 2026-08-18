// Executors for Jarvis desktop actions (Stage 1: open apps/URLs, create documents).
// Electron-bound (uses shell) so it lives in main only.
//
// Stage 2 — moving the mouse, clicking, typing into other apps, reading the screen —
// needs a native automation module and a real desktop to develop against; not built here.

import { shell } from 'electron'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { JarvisOutcome } from '../shared/types'

export async function openUrl(url: unknown): Promise<JarvisOutcome> {
  const u = String(url ?? '').trim()
  if (!u) return { action: 'open_url', ok: false, message: 'no URL given' }
  if (!/^https?:\/\//i.test(u)) {
    // Not a URL — treat it as a web search.
    await shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(u)}`)
    return { action: 'open_url', ok: true, message: `searched the web for "${u}"` }
  }
  await shell.openExternal(u)
  return { action: 'open_url', ok: true, message: `opened ${u}` }
}

export function isKnownApp(name: string, apps: Record<string, string>): boolean {
  const n = name.trim().toLowerCase()
  return Object.keys(apps).some((k) => k.toLowerCase() === n)
}

export async function openApp(name: unknown, apps: Record<string, string>): Promise<JarvisOutcome> {
  const n = String(name ?? '').trim()
  if (!n) return { action: 'open_app', ok: false, message: 'no app name given' }
  const entry = Object.entries(apps).find(([k]) => k.toLowerCase() === n.toLowerCase())
  const command = entry ? entry[1] : n // fall back to the name itself (App Paths / PATH)
  // Reject quotes so the name can't break out of the quoted `start` argument below.
  if (command.includes('"')) return { action: 'open_app', ok: false, message: `invalid app command for ${n}` }
  try {
    if (process.platform === 'win32') {
      // Launch through ShellExecute ("start") so bare names like "firefox" or "chrome" resolve
      // via the Windows App Paths registry — cmd/PATH alone can't find them. The empty "" is the
      // (required) window title so a quoted target isn't mistaken for it.
      await new Promise<void>((resolve, reject) => {
        const child = spawn('cmd', ['/c', 'start', '', command], { windowsHide: true })
        let err = ''
        child.stderr?.on('data', (d) => (err += d.toString()))
        child.once('error', reject)
        child.once('close', (code) =>
          code === 0 ? resolve() : reject(new Error(err.trim() || `the app was not found`))
        )
      })
    } else {
      const child = spawn(command, { shell: true, detached: true, stdio: 'ignore' })
      child.unref()
    }
    return { action: 'open_app', ok: true, message: `launched ${n}` }
  } catch (err) {
    return { action: 'open_app', ok: false, message: `could not launch ${n}: ${(err as Error).message}` }
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || 'note.txt'
}

export async function createDocument(args: Record<string, unknown>, openIt: boolean): Promise<JarvisOutcome> {
  const filename = sanitizeFilename(String(args.filename ?? 'note.txt'))
  const content = String(args.content ?? '')
  const dir = path.join(os.homedir(), 'Nexus')
  await fs.mkdir(dir, { recursive: true })
  const full = path.join(dir, filename)
  await fs.writeFile(full, content, 'utf8')
  if (openIt) await shell.openPath(full)
  return { action: 'create_document', ok: true, message: `saved ${full}` }
}
