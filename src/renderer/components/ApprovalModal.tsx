import { useEffect, useState } from 'react'

interface Pending {
  approvalId: string
  command: string
}

/**
 * Global overlay: when an agent requests a non-allowlisted command, prompt the user to
 * Approve once, Approve & always allow (adds it to the allowlist), or Deny.
 */
export function ApprovalModal(): JSX.Element | null {
  const [queue, setQueue] = useState<Pending[]>([])

  useEffect(() => {
    return window.api.onCommandApprovalRequest((r) => setQueue((q) => [...q, r]))
  }, [])

  const current = queue[0]
  if (!current) return null

  const decide = (decision: 'approve' | 'always' | 'deny') => {
    window.api.commandApprove(current.approvalId, decision)
    setQueue((q) => q.slice(1))
  }

  return (
    <div className="tour-backdrop">
      <div className="tour-card" style={{ width: 'min(560px, 100%)' }}>
        <h2 style={{ marginTop: 0 }}>⚠️ An AI wants to run a command</h2>
        <p className="small muted">
          This runs on your computer with your permissions. Only approve commands you understand.
          {queue.length > 1 ? ` (${queue.length - 1} more queued)` : ''}
        </p>
        <pre className="chat-log mono" style={{ maxHeight: 120, whiteSpace: 'pre-wrap' }}>
          $ {current.command}
        </pre>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button onClick={() => decide('deny')}>Deny</button>
          <div className="spacer" />
          <button onClick={() => decide('always')} title="Run and add to the allowlist">
            Approve &amp; always allow
          </button>
          <button className="primary" onClick={() => decide('approve')}>
            Approve once
          </button>
        </div>
      </div>
    </div>
  )
}
