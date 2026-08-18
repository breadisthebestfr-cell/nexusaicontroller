// Sandboxed file operations restricted to a single project-root directory.
// Every path is resolved and checked so agents (V2) can never read or write
// outside the folder the user explicitly selected.

import { promises as fs } from 'node:fs'
import path from 'node:path'

export class PathEscapeError extends Error {
  constructor(requested: string) {
    super(`Refusing to access path outside the project root: ${requested}`)
    this.name = 'PathEscapeError'
  }
}

/**
 * Resolve `relPath` against `root` and guarantee the result stays inside `root`.
 * Throws PathEscapeError on any traversal attempt (e.g. "../secrets").
 */
export function resolveInRoot(root: string, relPath: string): string {
  const normalizedRoot = path.resolve(root)
  const candidate = path.resolve(normalizedRoot, relPath)
  const rel = path.relative(normalizedRoot, candidate)
  if (rel === '' ) return candidate
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathEscapeError(relPath)
  }
  return candidate
}

export interface DirEntry {
  name: string
  path: string // relative to root
  type: 'file' | 'dir'
}

export class ProjectFiles {
  constructor(private readonly root: string) {}

  get rootPath(): string {
    return path.resolve(this.root)
  }

  async list(relDir = '.'): Promise<DirEntry[]> {
    const abs = resolveInRoot(this.root, relDir)
    const entries = await fs.readdir(abs, { withFileTypes: true })
    return entries.map((e) => ({
      name: e.name,
      path: path.relative(this.rootPath, path.join(abs, e.name)),
      type: e.isDirectory() ? 'dir' : 'file'
    }))
  }

  async read(relPath: string): Promise<string> {
    const abs = resolveInRoot(this.root, relPath)
    return fs.readFile(abs, 'utf8')
  }

  async write(relPath: string, content: string): Promise<void> {
    const abs = resolveInRoot(this.root, relPath)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      const abs = resolveInRoot(this.root, relPath)
      await fs.access(abs)
      return true
    } catch {
      return false
    }
  }

  /**
   * A flat newline list of the project's files/dirs (relative paths), for giving
   * agents a sense of the current tree. Skips noise dirs and caps the entry count.
   */
  async listTree(maxEntries = 200): Promise<string> {
    const out: string[] = []
    const skip = new Set(['.git', '.localai', 'node_modules', 'out', 'dist', '.vite'])
    const walk = async (relDir: string): Promise<void> => {
      if (out.length >= maxEntries) return
      let entries
      try {
        entries = await fs.readdir(resolveInRoot(this.root, relDir), { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (out.length >= maxEntries) return
        if (skip.has(e.name)) continue
        const rel = relDir === '.' ? e.name : `${relDir}/${e.name}`
        if (e.isDirectory()) {
          out.push(`${rel}/`)
          await walk(rel)
        } else {
          out.push(rel)
        }
      }
    }
    await walk('.')
    return out.join('\n')
  }
}
