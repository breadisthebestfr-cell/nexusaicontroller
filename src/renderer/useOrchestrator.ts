import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentRole, OrchestratorRunRequest } from '../shared/types'

export interface TurnView {
  key: string // `${round}:${role}`
  round: number
  role: AgentRole
  model: string
  content: string
  filesTouched: string[]
  status: 'streaming' | 'done'
}

export interface OrchestratorState {
  turns: TurnView[]
  filesWritten: string[]
  running: boolean
  summary: string | null
  error: string | null
  start: (req: OrchestratorRunRequest) => Promise<void>
  cancel: () => void
  reset: () => void
}

const keyFor = (round: number, role: AgentRole) => `${round}:${role}`

export function useOrchestrator(): OrchestratorState {
  const [turns, setTurns] = useState<TurnView[]>([])
  const [filesWritten, setFilesWritten] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runIdRef = useRef<string | null>(null)

  useEffect(() => {
    const offs = [
      window.api.onOrchTurnStart((t) => {
        if (t.runId !== runIdRef.current) return
        setTurns((prev) => [
          ...prev,
          { key: keyFor(t.round, t.role), round: t.round, role: t.role, model: t.model, content: '', filesTouched: [], status: 'streaming' }
        ])
      }),
      window.api.onOrchDelta((d) => {
        if (d.runId !== runIdRef.current) return
        const key = keyFor(d.round, d.role)
        setTurns((prev) => prev.map((t) => (t.key === key ? { ...t, content: t.content + d.delta } : t)))
      }),
      window.api.onOrchTurnEnd((turn) => {
        if (turn.runId !== runIdRef.current) return
        const key = keyFor(turn.round, turn.role)
        setTurns((prev) =>
          prev.map((t) =>
            t.key === key ? { ...t, content: turn.content, filesTouched: turn.filesTouched, status: 'done' } : t
          )
        )
        if (turn.filesTouched.length) {
          setFilesWritten((prev) => [...new Set([...prev, ...turn.filesTouched])])
        }
      }),
      window.api.onOrchDone((d) => {
        if (d.runId !== runIdRef.current) return
        setRunning(false)
        setSummary(d.summary)
      }),
      window.api.onOrchError((e) => {
        if (e.runId !== runIdRef.current) return
        setRunning(false)
        setError(e.message)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const start = useCallback(async (req: OrchestratorRunRequest) => {
    setTurns([])
    setFilesWritten([])
    setSummary(null)
    setError(null)
    setRunning(true)
    const runId = await window.api.orchestratorStart(req)
    if (!runId) {
      setRunning(false)
      setError('Select a project folder first.')
      return
    }
    runIdRef.current = runId
  }, [])

  const cancel = useCallback(() => {
    if (runIdRef.current) window.api.orchestratorCancel(runIdRef.current)
    setRunning(false)
  }, [])

  const reset = useCallback(() => {
    setTurns([])
    setFilesWritten([])
    setSummary(null)
    setError(null)
  }, [])

  return { turns, filesWritten, running, summary, error, start, cancel, reset }
}
