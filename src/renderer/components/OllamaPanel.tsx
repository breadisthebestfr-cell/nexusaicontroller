import { useEffect, useRef, useState } from 'react'
import { LOCAL_OLLAMA_BASE, type LocalOllamaStatus, type OllamaModel } from '../../shared/types'
import { toast } from '../toast'

// A short, curated list of solid local models across sizes. Users can also type any tag.
const POPULAR = [
  'llama3.2:3b',
  'llama3.2:1b',
  'llama3.1:8b',
  'qwen2.5:7b',
  'qwen2.5-coder:7b',
  'gemma2:9b',
  'phi3.5',
  'mistral:7b',
  'deepseek-r1:8b'
]

function humanSize(bytes?: number): string {
  if (!bytes) return ''
  const gb = bytes / 1e9
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

export function OllamaPanel(): JSX.Element {
  const [status, setStatus] = useState<LocalOllamaStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState<string>('') // model name currently being acted on

  // Pull state
  const [pullName, setPullName] = useState('')
  const [pulling, setPulling] = useState(false)
  const [pullMsg, setPullMsg] = useState('')
  const pullIdRef = useRef<string | null>(null)

  // Inline run state
  const [runModel, setRunModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [output, setOutput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const requestRef = useRef<string | null>(null)

  const refresh = async () => {
    setRefreshing(true)
    const s = await window.api.ollamaStatus()
    setStatus(s)
    setRefreshing(false)
    // Keep the run selection valid.
    if (s.models.length && !s.models.some((m) => m.name === runModel)) setRunModel(s.models[0].name)
  }

  useEffect(() => {
    refresh()
  }, [])

  // Pull progress subscription.
  useEffect(() => {
    const off = window.api.onPullProgress((p) => {
      if (p.pullId !== pullIdRef.current) return
      if (p.error) {
        setPullMsg(`Error: ${p.error}`)
        setPulling(false)
        pullIdRef.current = null
        return
      }
      if (p.done) {
        setPullMsg('Done.')
        setPulling(false)
        pullIdRef.current = null
        refresh()
        return
      }
      const pct = p.total > 0 ? ` ${Math.round((p.completed / p.total) * 100)}%` : ''
      setPullMsg(`${p.status}${pct}`)
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Chat-chunk subscription for the inline runner.
  useEffect(() => {
    const off = window.api.onChatChunk((c) => {
      if (c.requestId !== requestRef.current) return
      if (c.error) {
        setOutput((o) => o + `\n[error: ${c.error}]`)
        setStreaming(false)
        requestRef.current = null
        return
      }
      if (c.delta) setOutput((o) => o + c.delta)
      if (c.done) {
        setStreaming(false)
        requestRef.current = null
      }
    })
    return off
  }, [])

  const startPull = async (name: string) => {
    const model = name.trim()
    if (!model || pulling) return
    setPulling(true)
    setPullMsg('Starting…')
    pullIdRef.current = await window.api.pullModel({ baseUrl: LOCAL_OLLAMA_BASE, model, instanceId: 'local' })
  }

  const cancelPull = async () => {
    if (pullIdRef.current) await window.api.pullModelCancel(pullIdRef.current)
    setPulling(false)
    setPullMsg('Cancelled.')
    pullIdRef.current = null
  }

  const del = async (name: string) => {
    if (!confirm(`Delete ${name}? This removes it from disk.`)) return
    setBusy(name)
    const res = await window.api.ollamaDelete(name)
    setBusy('')
    if (res.ok) {
      toast(`Deleted ${name}`, 'success')
      refresh()
    } else {
      toast(`Delete failed: ${res.error}`, 'error')
    }
  }

  const setLoaded = async (name: string, load: boolean) => {
    setBusy(name)
    const res = await window.api.ollamaSetLoaded(name, load)
    setBusy('')
    if (res.ok) refresh()
    else toast(`${load ? 'Load' : 'Unload'} failed: ${res.error}`, 'error')
  }

  const run = async () => {
    if (!runModel || !prompt.trim() || streaming) return
    setOutput('')
    setStreaming(true)
    requestRef.current = await window.api.chatStart({
      baseUrl: LOCAL_OLLAMA_BASE,
      model: runModel,
      messages: [{ role: 'user', content: prompt.trim() }]
    })
  }

  const stopRun = async () => {
    if (requestRef.current) await window.api.chatCancel(requestRef.current)
    setStreaming(false)
    requestRef.current = null
  }

  if (!status) return <div className="panel">Loading…</div>

  if (!status.online) {
    return (
      <div className="panel">
        <div className="row" style={{ gap: 8 }}>
          <h2 style={{ margin: 0 }}>Ollama</h2>
          <div className="spacer" />
          <button onClick={refresh} disabled={refreshing}>{refreshing ? 'Checking…' : 'Refresh'}</button>
        </div>
        <div className="notice" style={{ marginTop: 12, borderLeftColor: 'var(--warn)' }}>
          <strong>Ollama isn't reachable at {LOCAL_OLLAMA_BASE}.</strong>
          <p className="small" style={{ marginBottom: 0 }}>
            Make sure Ollama is installed and running (launch the Ollama app, or run <code>ollama serve</code> in a
            terminal), then hit Refresh. If it runs on another machine, use the Instances tab to add it.
          </p>
        </div>
      </div>
    )
  }

  const running = new Set(status.running)

  return (
    <div className="panel">
      <div className="row wrap" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>Ollama</h2>
        <span className="status-chip"><span className="dot on" /> v{status.version} · {status.models.length} installed</span>
        <div className="spacer" />
        <button onClick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {/* Pull a model */}
      <h3 style={{ marginBottom: 6 }}>Pull a model</h3>
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <input
          className="mono"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="model tag, e.g. llama3.2:3b"
          value={pullName}
          onChange={(e) => setPullName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') startPull(pullName) }}
          list="popular-models"
        />
        <datalist id="popular-models">
          {POPULAR.map((m) => <option key={m} value={m} />)}
        </datalist>
        <button className="primary" onClick={() => startPull(pullName)} disabled={pulling || !pullName.trim()}>Pull</button>
        {pulling && <button onClick={cancelPull}>Cancel</button>}
      </div>
      <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
        {POPULAR.map((m) => (
          <button key={m} className="small" onClick={() => setPullName(m)} disabled={pulling} title="Put this tag in the box">
            {m}
          </button>
        ))}
      </div>
      {pullMsg && <div className="small muted" style={{ marginTop: 6 }}>{pullMsg}</div>}

      {/* Installed models */}
      <h3 style={{ marginTop: 18, marginBottom: 6 }}>Installed models</h3>
      {status.models.length === 0 && <div className="small muted">None yet — pull one above.</div>}
      {status.models.map((m: OllamaModel) => (
        <div className="instance" key={m.name} style={{ marginBottom: 8 }}>
          <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
            <strong className="mono">{m.name}</strong>
            {running.has(m.name) && <span className="status-chip"><span className="dot on" /> loaded</span>}
            <span className="small muted">
              {[m.parameterSize, m.quantization, humanSize(m.size)].filter(Boolean).join(' · ')}
            </span>
            <div className="spacer" />
            <button onClick={() => { setRunModel(m.name); setPrompt(''); setOutput('') }}>Run</button>
            {running.has(m.name)
              ? <button onClick={() => setLoaded(m.name, false)} disabled={busy === m.name}>Unload</button>
              : <button onClick={() => setLoaded(m.name, true)} disabled={busy === m.name}>Load</button>}
            <button onClick={() => del(m.name)} disabled={busy === m.name} title="Delete from disk">🗑</button>
          </div>
        </div>
      ))}

      {/* Inline runner */}
      <h3 style={{ marginTop: 18, marginBottom: 6 }}>Run</h3>
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <select value={runModel} onChange={(e) => setRunModel(e.target.value)}>
          {status.models.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
        </select>
      </div>
      <textarea
        rows={2}
        style={{ width: '100%', resize: 'vertical', marginTop: 8 }}
        placeholder="Prompt… (Ctrl+Enter to run)"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run() }}
      />
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <button className="primary" onClick={run} disabled={streaming || !runModel || !prompt.trim()}>
          {streaming ? 'Running…' : 'Run'}
        </button>
        {streaming && <button onClick={stopRun}>Stop</button>}
      </div>
      {output && (
        <div className="mono small" style={{ marginTop: 8, padding: 8, border: '1px solid var(--border)', borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
          {output}
        </div>
      )}
    </div>
  )
}
