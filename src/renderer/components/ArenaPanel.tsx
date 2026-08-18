import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatStats, OllamaInstance } from '../../shared/types'

interface ModelOption {
  key: string
  label: string
  baseUrl: string
  model: string
}

interface Column {
  key: string
  label: string
  text: string
  done: boolean
  error?: string
  stats?: ChatStats
}

/** Ask the same prompt to several models at once and compare answers side-by-side. */
export function ArenaPanel({ instances }: { instances: OllamaInstance[] }): JSX.Element {
  const options = useMemo<ModelOption[]>(() => {
    const opts: ModelOption[] = []
    for (const inst of instances) {
      if (!inst.online) continue
      for (const m of inst.models) opts.push({ key: `${inst.baseUrl}|${m.name}`, label: `${m.name} @ ${inst.id}`, baseUrl: inst.baseUrl, model: m.name })
    }
    return opts
  }, [instances])

  const [selected, setSelected] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [columns, setColumns] = useState<Column[]>([])
  const [running, setRunning] = useState(false)
  const reqMap = useRef<Record<string, number>>({})
  const activeReqs = useRef<string[]>([])
  const doneCount = useRef(0)

  useEffect(() => {
    return window.api.onChatChunk((chunk) => {
      const idx = reqMap.current[chunk.requestId]
      if (idx === undefined) return
      setColumns((cols) =>
        cols.map((c, i) =>
          i !== idx
            ? c
            : { ...c, text: c.text + (chunk.delta ?? ''), done: chunk.done || c.done, error: chunk.error ?? c.error, stats: chunk.stats ?? c.stats }
        )
      )
      if (chunk.done) {
        doneCount.current++
        if (doneCount.current >= activeReqs.current.length) setRunning(false)
      }
    })
  }, [])

  const toggle = (key: string) =>
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : s.length >= 4 ? s : [...s, key]))

  const ask = async () => {
    const chosen = options.filter((o) => selected.includes(o.key))
    if (!prompt.trim() || chosen.length === 0 || running) return
    reqMap.current = {}
    activeReqs.current = []
    doneCount.current = 0
    setColumns(chosen.map((o) => ({ key: o.key, label: o.label, text: '', done: false })))
    setRunning(true)
    for (let i = 0; i < chosen.length; i++) {
      const id = await window.api.chatStart({
        baseUrl: chosen[i].baseUrl,
        model: chosen[i].model,
        messages: [{ role: 'user', content: prompt.trim() }]
      })
      reqMap.current[id] = i
      activeReqs.current.push(id)
    }
  }

  const stop = () => {
    activeReqs.current.forEach((id) => window.api.chatCancel(id))
    setRunning(false)
  }

  if (options.length === 0) {
    return (
      <div className="panel">
        <h2>Model Arena</h2>
        <div className="notice">No online models. Scan or add a host on the Instances tab first.</div>
      </div>
    )
  }

  return (
    <div className="panel">
      <h2>Model Arena</h2>
      <p className="small muted">Pick up to 4 models, ask one prompt, compare the answers side-by-side.</p>

      <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
        {options.map((o) => (
          <button
            key={o.key}
            className={selected.includes(o.key) ? 'primary' : ''}
            onClick={() => toggle(o.key)}
            disabled={running}
            style={{ fontSize: 12 }}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <textarea
          rows={2}
          style={{ flex: 1, resize: 'vertical' }}
          placeholder="Prompt for all selected models…"
          value={prompt}
          disabled={running}
          onChange={(e) => setPrompt(e.target.value)}
        />
        {running ? (
          <button onClick={stop} style={{ alignSelf: 'flex-end' }}>
            Stop
          </button>
        ) : (
          <button className="primary" onClick={ask} disabled={!prompt.trim() || selected.length === 0} style={{ alignSelf: 'flex-end' }}>
            Ask {selected.length || ''} model{selected.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {columns.length > 0 && (
        <div className="row" style={{ gap: 10, marginTop: 12, overflowX: 'auto', alignItems: 'stretch' }}>
          {columns.map((c) => (
            <div key={c.key} className="instance" style={{ minWidth: 260, flex: 1, margin: 0 }}>
              <div className="row">
                <strong className="small mono">{c.label}</strong>
                {!c.done && running && <span className="small muted">…</span>}
              </div>
              <div className="msg" style={{ whiteSpace: 'pre-wrap', marginTop: 6, maxHeight: 360, overflow: 'auto' }}>
                {c.error ? <span style={{ color: 'var(--danger)' }}>{c.error}</span> : c.text || '…'}
              </div>
              {c.stats && (
                <div className="small muted" style={{ marginTop: 6 }}>
                  ⚡ {Math.round(c.stats.tokensPerSec)} tok/s · {(c.stats.totalMs / 1000).toFixed(1)}s
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
