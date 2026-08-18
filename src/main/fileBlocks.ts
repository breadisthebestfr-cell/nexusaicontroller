// Parses a coder agent's output into concrete file writes.
//
// The coder is instructed to emit, for each file:
//
//   FILE: relative/path.ext
//   ```lang
//   ...contents...
//   ```
//
// This parser is deliberately tolerant of surrounding prose, language tags on the
// opening fence, and quoted/back-ticked paths. Kept pure so it is unit-testable.

export interface FileBlock {
  path: string
  content: string
}

const FILE_LINE = /^\s*FILE:\s*(.+?)\s*$/i
const FENCE = /^\s*```/
const CLOSE_FENCE = /^\s*```\s*$/

export function parseFileBlocks(text: string): FileBlock[] {
  const lines = text.split(/\r?\n/)

  // First locate every "FILE: <path>" marker. Each file's content is the region up to
  // the next marker (or EOF).
  const markers: Array<{ path: string; line: number }> = []
  lines.forEach((line, idx) => {
    const m = line.match(FILE_LINE)
    if (m) markers.push({ path: cleanPath(m[1]), line: idx })
  })

  const blocks: FileBlock[] = []
  for (let k = 0; k < markers.length; k++) {
    const start = markers[k].line + 1
    const end = k + 1 < markers.length ? markers[k + 1].line : lines.length // exclusive

    // Opening fence: the first fence line in this file's region.
    let open = -1
    for (let j = start; j < end; j++) {
      if (FENCE.test(lines[j])) {
        open = j
        break
      }
    }
    if (open === -1) continue

    // Closing fence: the LAST bare fence line in the region, so a file whose own content
    // contains ``` fences (e.g. a README with code examples) isn't truncated at the first one.
    let close = -1
    for (let j = end - 1; j > open; j--) {
      if (CLOSE_FENCE.test(lines[j])) {
        close = j
        break
      }
    }
    if (close === -1) continue

    blocks.push({ path: markers[k].path, content: lines.slice(open + 1, close).join('\n') })
  }

  return blocks
}

function cleanPath(raw: string): string {
  return raw
    .trim()
    .replace(/^[`'"]+/, '')
    .replace(/[`'"]+$/, '')
    .trim()
}
