import { useState } from 'react'
import { addSnippet, getSnippets, removeSnippet, type Snippet } from '../snippets'

/** Save the current text as a reusable snippet, and insert saved ones. */
export function SnippetBar({ current, onInsert }: { current: string; onInsert: (text: string) => void }): JSX.Element {
  const [list, setList] = useState<Snippet[]>(getSnippets)
  const [selected, setSelected] = useState('')

  return (
    <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
      <select
        value={selected}
        onChange={(e) => {
          const s = list.find((x) => x.id === e.target.value)
          setSelected(e.target.value)
          if (s) onInsert(s.text)
        }}
        style={{ maxWidth: 240 }}
        title="Insert a saved prompt"
      >
        <option value="">★ Saved prompts…</option>
        {list.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <button className="small" disabled={!current.trim()} onClick={() => setList(addSnippet(current))}>
        Save
      </button>
      {selected && (
        <button
          className="small"
          title="Delete this saved prompt"
          onClick={() => {
            setList(removeSnippet(selected))
            setSelected('')
          }}
        >
          Delete
        </button>
      )}
    </div>
  )
}
