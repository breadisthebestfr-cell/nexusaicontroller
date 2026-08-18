import { useEffect, useState } from 'react'
import type { AgentRole } from '../../shared/types'

export interface TurnCardData {
  round: number
  role: AgentRole
  model: string
  content: string
  filesTouched: string[]
  /** Present for live runs; omitted for history (always treated as done). */
  status?: 'streaming' | 'done'
}

/** One agent turn in a transcript. Shared by the live Project view and History. */
export function TurnCard({ turn }: { turn: TurnCardData }): JSX.Element {
  return (
    <div className="instance">
      <div className="row">
        <span className={`badge ${turn.role === 'coder' ? 'manual' : ''}`}>{turn.role}</span>
        <span className="small muted mono">{turn.model}</span>
        <span className="small muted">round {turn.round}</span>
        {turn.status === 'streaming' && <span className="small muted">typing…</span>}
        {turn.filesTouched.length > 0 && (
          <span className="small" style={{ color: 'var(--ok)' }}>
            ✎ {turn.filesTouched.length} file{turn.filesTouched.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="msg" style={{ marginTop: 6, marginBottom: 0 }}>
        {turn.content || (turn.status === 'streaming' ? '…' : '')}
      </div>
    </div>
  )
}

/** File content viewer. `read` decouples the source (live project vs a history run). */
export function FileViewer({
  path,
  read,
  reveal,
  onClose
}: {
  path: string
  read: (path: string) => Promise<string | null>
  reveal?: (path: string) => void
  onClose: () => void
}): JSX.Element {
  const [content, setContent] = useState<string | null>(null)
  useEffect(() => {
    read(path).then(setContent)
  }, [path, read])
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="row">
        <h2 style={{ margin: 0 }} className="mono">
          {path}
        </h2>
        <div className="spacer" />
        {reveal && (
          <button className="small" onClick={() => reveal(path)} title="Show in file explorer">
            Reveal
          </button>
        )}
        <button className="small" onClick={onClose}>
          Close
        </button>
      </div>
      <pre className="chat-log mono" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
        {content ?? 'Loading…'}
      </pre>
    </div>
  )
}
