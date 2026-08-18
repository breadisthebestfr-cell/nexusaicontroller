import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { commitAll, ensureRepo, hasGit, isRepo } from '../git'

describe('git module', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-test-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('git is available in this environment', async () => {
    expect(await hasGit()).toBe(true)
  })

  it('ensureRepo initializes a repo with identity', async () => {
    expect(await isRepo(dir)).toBe(false)
    expect(await ensureRepo(dir)).toBe(true)
    expect(await isRepo(dir)).toBe(true)
  })

  it('commitAll commits changes and returns a sha, then null when clean', async () => {
    await ensureRepo(dir)
    await fs.writeFile(path.join(dir, 'a.txt'), 'hello')
    const sha1 = await commitAll(dir, 'first')
    expect(sha1).toBeTruthy()
    expect(sha1).toMatch(/^[0-9a-f]{7,}$/)

    // Nothing changed since the last commit.
    expect(await commitAll(dir, 'noop')).toBeNull()

    await fs.writeFile(path.join(dir, 'a.txt'), 'changed')
    const sha2 = await commitAll(dir, 'second')
    expect(sha2).toBeTruthy()
    expect(sha2).not.toBe(sha1)
  })
})
