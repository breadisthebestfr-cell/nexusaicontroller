// A tiny saved-prompts library, persisted in localStorage. Shared by Chat and Project.

export interface Snippet {
  id: string
  label: string
  text: string
}

const KEY = 'laic.snippets'

export function getSnippets(): Snippet[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function save(list: Snippet[]): void {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function addSnippet(text: string): Snippet[] {
  const t = text.trim()
  if (!t) return getSnippets()
  const snippet: Snippet = { id: crypto.randomUUID(), label: t.replace(/\s+/g, ' ').slice(0, 50), text: t }
  const list = [snippet, ...getSnippets()].slice(0, 50)
  save(list)
  return list
}

export function removeSnippet(id: string): Snippet[] {
  const list = getSnippets().filter((s) => s.id !== id)
  save(list)
  return list
}
