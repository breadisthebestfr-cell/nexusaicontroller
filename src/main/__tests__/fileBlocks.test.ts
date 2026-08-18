import { describe, expect, it } from 'vitest'
import { parseFileBlocks } from '../fileBlocks'

describe('parseFileBlocks', () => {
  it('parses a single file with a language fence', () => {
    const out = ['FILE: src/app.js', '```js', "console.log('hi')", '```'].join('\n')
    expect(parseFileBlocks(out)).toEqual([{ path: 'src/app.js', content: "console.log('hi')" }])
  })

  it('parses multiple files and preserves multi-line content', () => {
    const out = [
      'Here you go:',
      'FILE: a.txt',
      '```',
      'line 1',
      'line 2',
      '```',
      'FILE: dir/b.py',
      '```python',
      'print(1)',
      '```'
    ].join('\n')
    expect(parseFileBlocks(out)).toEqual([
      { path: 'a.txt', content: 'line 1\nline 2' },
      { path: 'dir/b.py', content: 'print(1)' }
    ])
  })

  it('strips quotes and backticks around the path', () => {
    const out = ['FILE: `index.ts`', '```', 'x', '```'].join('\n')
    expect(parseFileBlocks(out)[0].path).toBe('index.ts')
  })

  it('ignores a FILE line with no following fence', () => {
    expect(parseFileBlocks('FILE: nope.txt\njust prose, no code block')).toEqual([])
  })

  it('returns nothing for plain prose', () => {
    expect(parseFileBlocks('I could not complete the task.')).toEqual([])
  })

  it('does not truncate a file whose content contains its own code fences', () => {
    const out = [
      'FILE: README.md',
      '```',
      '# Title',
      'Example:',
      '```',
      "console.log('x')",
      '```',
      'done',
      '```'
    ].join('\n')
    const blocks = parseFileBlocks(out)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].path).toBe('README.md')
    // The inner fences and everything up to the LAST fence are preserved.
    expect(blocks[0].content).toBe("# Title\nExample:\n```\nconsole.log('x')\n```\ndone")
  })
})
