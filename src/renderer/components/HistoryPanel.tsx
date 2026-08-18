import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RunRecord, RunStatus, RunSummary } from '../../shared/types'
import { FileViewer, TurnCard } from './TurnCard'

function StatTiles({ runs }: { runs: RunSummary[] }): JSX.Element {
  const s = useMemo(() => {
    const sessions = new Set<string>()
    let files = 0
    let completed = 0
    for (const r of runs) {
      files += r.fileCount
      if (r.status === 'completed') completed++
      if (r.sessionId) sessions.add(r.sessionId)
    }
    return { total: runs.length, files, completed, sessions: sessions.size }
  }, [runs])

  const tiles: Array<[string, number]> = [
    ['runs', s.total],
    ['completed', s.completed],
    ['files written', s.files],
    ['continuous sessions', s.sessions]
  ]
  return (
    <div className="row wrap" style={{ gap: 10, marginTop: 10 }}>
      {tiles.map(([label, n]) => (
        <div key={label} className="instance" style={{ margin: 0, minWidth: 120, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>{n}</div>
          <div className="small muted">{label}</div>
        </div>
      ))}
    </div>
  )
}

function statusColor(status: RunStatus): string {
  if (status === 'completed') return 'var(--ok)'
  if (status === 'error') return 'var(--danger)'
  return 'var(--muted)'
}

function when(ms: number): string {
  return new Date(ms).toLocaleString()
}

function RunDetail({ id, onBack }: { id: string; onBack: () => void }): JSX.Element {
  const [record, setRecord] = useState<RunRecord | null>(null)
  const [viewFile, setViewFile] = useState<string | null>(null)

  useEffect(() => {
    window.api.historyGet(id).then(setRecord)
  }, [id])

  const read = useCallback((p: string) => window.api.historyReadFile(id, p), [id])

  if (!record) return <div className="panel">Loading run…</div>

  return (
    <div className="panel">
      <div className="row">
        <button className="small" onClick={onBack}>
          ← Back
        </button>
        <div className="spacer" />
        <span className="small" style={{ color: statusColor(record.status) }}>
          {record.status}
        </span>
      </div>

      <h2 style={{ marginTop: 12 }}>{record.task}</h2>
      <div className="small muted">
        {when(record.startedAt)} · {record.agents.map((a) => `${a.role}:${a.model}`).join('  ')}
      </div>
      <div className="notice" style={{ marginTop: 10, borderLeftColor: statusColor(record.status) }}>
        {record.summary}
        {record.error ? ` — ${record.error}` : ''}
      </div>

      <h2 style={{ marginTop: 14 }}>Transcript</h2>
      {record.transcript.map((t, i) => (
        <TurnCard key={i} turn={t} />
      ))}

      {record.filesWritten.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h2>Files written</h2>
          <div className="row wrap">
            {record.filesWritten.map((f) => (
              <button key={f} className="model-pill mono" onClick={() => setViewFile(f)}>
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      {viewFile && (
        <FileViewer
          path={viewFile}
          read={read}
          reveal={(p) => window.api.revealHistoryFile(id, p)}
          onClose={() => setViewFile(null)}
        />
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <div className="spacer" />
        <button className="small" onClick={() => window.api.historyExport(id)}>
          Export JSON
        </button>
      </div>
    </div>
  )
}

export function HistoryPanel(): JSX.Element {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<RunStatus | 'all'>('all')

  const refresh = useCallback(() => {
    window.api.historyList().then(setRuns)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const remove = async (id: string) => {
    await window.api.historyDelete(id)
    refresh()
  }
  const clearAll = async () => {
    await window.api.historyClear()
    refresh()
  }

  const q = query.trim().toLowerCase()
  const filtered = runs.filter(
    (r) => (statusFilter === 'all' || r.status === statusFilter) && (!q || r.task.toLowerCase().includes(q))
  )

  if (openId) return <RunDetail id={openId} onBack={() => setOpenId(null)} />

  return (
    <div className="panel">
      <div className="row">
        <h2 style={{ margin: 0 }}>Run history</h2>
        <div className="spacer" />
        <button className="small" onClick={refresh}>
          Refresh
        </button>
        {runs.length > 0 && (
          <button className="small" onClick={clearAll}>
            Clear all
          </button>
        )}
      </div>

      {runs.length > 0 && <StatTiles runs={runs} />}

      {runs.length > 0 && (
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <input
            placeholder="Search tasks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 160 }}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as RunStatus | 'all')}>
            <option value="all">all statuses</option>
            <option value="completed">completed</option>
            <option value="error">error</option>
            <option value="cancelled">cancelled</option>
          </select>
        </div>
      )}

      {runs.length === 0 ? (
        <div className="notice" style={{ marginTop: 10 }}>
          No runs yet. Start a collaboration on the Project tab — each run is saved here with its full
          transcript and files.
        </div>
      ) : filtered.length === 0 ? (
        <div className="small muted" style={{ marginTop: 10 }}>No runs match your filter.</div>
      ) : (
        <div style={{ marginTop: 10 }}>
          {filtered.map((r) => (
            <div className="instance" key={r.id}>
              <div className="row">
                <span className="dot on" style={{ background: statusColor(r.status) }} />
                <button
                  className="small"
                  style={{ border: 'none', background: 'none', padding: 0, textAlign: 'left', flex: 1 }}
                  onClick={() => setOpenId(r.id)}
                >
                  <strong>{r.task.length > 80 ? r.task.slice(0, 80) + '…' : r.task}</strong>
                </button>
                <div className="spacer" />
                <span className="small muted">{r.fileCount} files</span>
                <span className="small muted">{when(r.startedAt)}</span>
                <button className="small" onClick={() => remove(r.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
