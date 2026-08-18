import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PathEscapeError, ProjectFiles, resolveInRoot } from '../fileTools'

describe('resolveInRoot', () => {
  const root = '/home/user/project'

  it('resolves paths inside the root', () => {
    expect(resolveInRoot(root, 'src/index.ts')).toBe(path.resolve(root, 'src/index.ts'))
    expect(resolveInRoot(root, '.')).toBe(path.resolve(root))
  })

  it('rejects traversal outside the root', () => {
    expect(() => resolveInRoot(root, '../secrets.txt')).toThrow(PathEscapeError)
    expect(() => resolveInRoot(root, '../../etc/passwd')).toThrow(PathEscapeError)
    expect(() => resolveInRoot(root, '/etc/passwd')).toThrow(PathEscapeError)
  })
})

describe('ProjectFiles', () => {
  let dir: string
  let pf: ProjectFiles

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laic-test-'))
    pf = new ProjectFiles(dir)
  })
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('writes and reads files, creating parent dirs', async () => {
    await pf.write('src/hello.txt', 'hi there')
    expect(await pf.read('src/hello.txt')).toBe('hi there')
    expect(await pf.exists('src/hello.txt')).toBe(true)
    expect(await pf.exists('nope.txt')).toBe(false)
  })

  it('lists directory entries', async () => {
    const entries = await pf.list('.')
    expect(entries.some((e) => e.name === 'src' && e.type === 'dir')).toBe(true)
  })

  it('refuses to write outside the root', async () => {
    await expect(pf.write('../escape.txt', 'nope')).rejects.toThrow(PathEscapeError)
  })
})
