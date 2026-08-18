import { useEffect, useState } from 'react'
import type { OllamaInstance, OllamaModel, ScanProgress } from '../../shared/types'
import { toast } from '../toast'

/** Human-friendly "x ago" from an epoch-ms timestamp. */
function seenAgo(at?: number): string {
  if (!at) return ''
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
}

function formatBytes(n?: number): string {
  if (!n || n <= 0) return ''
  const gb = n / 1e9
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(n / 1e6)} MB`
}

function modelTitle(m: OllamaModel): string {
  return [m.name, m.parameterSize, m.quantization, formatBytes(m.size)].filter(Boolean).join(' · ')
}

function ModelList({ instance }: { instance: OllamaInstance }): JSX.Element {
  if (!instance.online) return <span className="small muted">offline</span>
  if (instance.models.length === 0) return <span className="small muted">no models installed</span>
  const loaded = new Set(instance.loaded ?? [])
  return (
    <div className="row wrap">
      {instance.models.map((m) => (
        <span key={m.name} className="model-pill mono" title={modelTitle(m)}>
          {loaded.has(m.name) && <span className="dot on" style={{ width: 7, height: 7 }} title="loaded in memory" />}
          {m.name}
          {m.parameterSize ? <span className="muted"> · {m.parameterSize}</span> : null}
          {m.size ? <span className="muted"> · {formatBytes(m.size)}</span> : null}
        </span>
      ))}
    </div>
  )
}

function PullModelForm({ instance }: { instance: OllamaInstance }): JSX.Element {
  const [model, setModel] = useState('')
  const [pullId, setPullId] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ status: string; pct: number } | null>(null)

  useEffect(() => {
    const off = window.api.onPullProgress((p) => {
      if (p.pullId !== pullId) return
      const pct = p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0
      setProgress({ status: p.error ? `error: ${p.error}` : p.status, pct })
      if (p.done) {
        setTimeout(() => {
          setPullId(null)
          setProgress(null)
          if (!p.error) setModel('')
        }, 1200)
      }
    })
    return off
  }, [pullId])

  const start = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!model.trim() || pullId) return
    const id = await window.api.pullModel({ baseUrl: instance.baseUrl, model: model.trim(), instanceId: instance.id })
    setPullId(id)
    setProgress({ status: 'starting…', pct: 0 })
  }

  if (!instance.online) return <></>

  return (
    <form className="row wrap" onSubmit={start} style={{ gap: 6, marginTop: 8 }}>
      <input
        placeholder="pull a model, e.g. qwen2.5-coder:7b"
        value={model}
        disabled={!!pullId}
        onChange={(e) => setModel(e.target.value)}
        style={{ flex: 1, minWidth: 200 }}
        className="mono small"
      />
      {pullId ? (
        <button type="button" className="small" onClick={() => window.api.pullModelCancel(pullId)}>
          Cancel
        </button>
      ) : (
        <button type="submit" className="small" disabled={!model.trim()}>
          Pull
        </button>
      )}
      {progress && (
        <div style={{ flexBasis: '100%' }}>
          <div className="progress-bar" style={{ marginTop: 4 }}>
            <div style={{ width: `${progress.pct}%` }} />
          </div>
          <div className="small muted">{progress.status}{progress.pct ? ` · ${progress.pct}%` : ''}</div>
        </div>
      )}
    </form>
  )
}

function InstanceCard({
  instance,
  nickname,
  onRename
}: {
  instance: OllamaInstance
  nickname?: string
  onRename: (id: string, name: string) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(nickname ?? '')
  const remove = () => {
    const [host, portStr] = instance.id.split(':')
    window.api.removeManualHost({ host, port: Number(portStr) })
  }
  const saveName = () => {
    onRename(instance.id, draft.trim())
    setEditing(false)
  }
  return (
    <div className="instance">
      <div className="row">
        <span className={`dot ${instance.online ? 'on' : 'off'}`} />
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
            onBlur={saveName}
            placeholder="nickname (blank to clear)"
            style={{ width: 180 }}
          />
        ) : (
          <>
            {nickname ? (
              <>
                <strong>{nickname}</strong>
                <span className="small muted mono">{instance.id}</span>
              </>
            ) : (
              <strong className="mono">{instance.id}</strong>
            )}
            <button
              className="small"
              title="Rename"
              onClick={() => {
                setDraft(nickname ?? '')
                setEditing(true)
              }}
              style={{ padding: '0 6px' }}
            >
              ✎
            </button>
          </>
        )}
        {instance.source === 'manual' && <span className="badge manual">manual</span>}
        {instance.version && <span className="small muted">v{instance.version}</span>}
        {instance.online && instance.lastSeen && (
          <span className="small muted">· seen {seenAgo(instance.lastSeen)}</span>
        )}
        <div className="spacer" />
        <button className="small" onClick={() => window.api.refreshInstance(instance.id)}>
          Refresh
        </button>
        {instance.source === 'manual' && (
          <button className="small" onClick={remove}>
            Remove
          </button>
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        <ModelList instance={instance} />
      </div>
      <PullModelForm instance={instance} />
      {!instance.online && instance.error && (
        <div className="small" style={{ marginTop: 6, color: 'var(--danger)' }}>
          {instance.error}
        </div>
      )}
    </div>
  )
}

function ManualAddForm(): JSX.Element {
  const [host, setHost] = useState('')
  const [port, setPort] = useState('11434')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const h = host.trim()
    const p = Number(port)
    if (!h) return setError('Enter a host or IP address.')
    if (/\s/.test(h)) return setError('Host cannot contain spaces.')
    if (!Number.isInteger(p) || p < 1 || p > 65535) return setError('Port must be between 1 and 65535.')
    setError('')
    setBusy(true)
    try {
      const list = await window.api.addManualHost({ host: h, port: p })
      const added = list.find((i) => i.id === `${h}:${p}`)
      if (added && !added.online) {
        toast(`Added ${h}:${p} but it isn't responding. Is Ollama running there with OLLAMA_HOST=0.0.0.0 and port ${p} open?`, 'error')
      } else if (added) {
        toast(`Connected to ${h}:${p} (${added.models.length} models)`, 'success')
      }
      setHost('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="row wrap" style={{ gap: 8 }}>
        <input
          placeholder="192.168.1.20 or hostname"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <input placeholder="11434" value={port} onChange={(e) => setPort(e.target.value)} style={{ width: 90 }} />
        <button className="primary" type="submit" disabled={busy}>
          Add host
        </button>
      </div>
      {error && <div className="small" style={{ marginTop: 6, color: 'var(--danger)' }}>{error}</div>}
    </form>
  )
}

function loadNicknames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem('laic.nicknames') || '{}')
  } catch {
    return {}
  }
}

export function InstancesPanel({ instances }: { instances: OllamaInstance[] }): JSX.Element {
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [pollMs, setPollMs] = useState(0)
  const [nicknames, setNicknames] = useState<Record<string, string>>(loadNicknames)

  const renameInstance = (id: string, name: string) => {
    setNicknames((prev) => {
      const next = { ...prev }
      if (name) next[id] = name
      else delete next[id]
      localStorage.setItem('laic.nicknames', JSON.stringify(next))
      return next
    })
  }

  useEffect(() => {
    window.api.getSettings().then((s) => setPollMs(s.healthPollMs))
    const off = window.api.onScanProgress((p) => {
      setProgress(p)
      if (p.done) setScanning(false)
    })
    return off
  }, [])

  const scan = async () => {
    setScanning(true)
    setProgress(null)
    try {
      await window.api.scanLan()
    } finally {
      setScanning(false)
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.scanned / progress.total) * 100) : 0

  return (
    <div className="grid-2">
      <section className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Detected instances</h2>
          {pollMs > 0 && instances.length > 0 && (
            <span className="small muted">· auto-refreshing every {Math.round(pollMs / 1000)}s</span>
          )}
          <div className="spacer" />
          {scanning ? (
            <button onClick={() => window.api.scanCancel()}>Cancel</button>
          ) : (
            <button className="primary" onClick={scan}>
              Scan WiFi
            </button>
          )}
        </div>

        {scanning && progress && (
          <div style={{ margin: '12px 0' }}>
            <div className="progress-bar">
              <div style={{ width: `${pct}%` }} />
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              Probed {progress.scanned}/{progress.total} · found {progress.found}
            </div>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          {instances.length === 0 && !scanning && (
            <div className="notice">
              No instances yet. Click <strong>Scan WiFi</strong> to sweep your subnet, or add a host
              manually. Remote machines must run Ollama with <span className="mono">OLLAMA_HOST=0.0.0.0</span>{' '}
              and allow TCP 11434 through their firewall.
            </div>
          )}
          {instances.map((i) => (
            <InstanceCard key={i.id} instance={i} nickname={nicknames[i.id]} onRename={renameInstance} />
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Add a host manually</h2>
        <p className="small muted">
          Use this for machines the scan misses (different subnet, non-standard port, or a hostname).
        </p>
        <ManualAddForm />
      </section>
    </div>
  )
}
