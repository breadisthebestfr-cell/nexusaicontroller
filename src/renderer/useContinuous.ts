import { useCallback, useEffect, useRef, useState } from 'react'
import type { ContinuousCycleEnd, ContinuousStartRequest, ContinuousStopReason } from '../shared/types'
import type { TurnCardData } from './components/TurnCard'

export interface CycleLogEntry {
  cycle: number
  step: string
  filesWritten: string[]
  commit: string | null
  verdict: string
}

export interface ContinuousState {
  running: boolean
  currentCycle: number
  currentStep: string
  currentTurns: TurnCardData[]
  cycles: CycleLogEntry[]
  done: { reason: ContinuousStopReason; message: string } | null
  error: string | null
  start: (req: ContinuousStartRequest) => Promise<void>
  stop: () => void
}

export function useContinuous(): ContinuousState {
  const [running, setRunning] = useState(false)
  const [currentCycle, setCurrentCycle] = useState(0)
  const [currentStep, setCurrentStep] = useState('')
  const [currentTurns, setCurrentTurns] = useState<TurnCardData[]>([])
  const [cycles, setCycles] = useState<CycleLogEntry[]>([])
  const [done, setDone] = useState<{ reason: ContinuousStopReason; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sidRef = useRef<string | null>(null)

  useEffect(() => {
    const offs = [
      window.api.onContCycleStart((c) => {
        if (c.sessionId !== sidRef.current) return
        setCurrentCycle(c.cycle)
        setCurrentStep(c.step)
        setCurrentTurns([])
      }),
      window.api.onContTurn((t) => {
        if (t.sessionId !== sidRef.current) return
        setCurrentTurns((prev) => [...prev, { round: t.round, role: t.role, model: t.model, content: t.content, filesTouched: t.filesTouched, status: 'done' }])
      }),
      window.api.onContCycleEnd((c: ContinuousCycleEnd) => {
        if (c.sessionId !== sidRef.current) return
        setCycles((prev) => [
          { cycle: c.cycle, step: c.step, filesWritten: c.filesWritten, commit: c.commit, verdict: c.verdict },
          ...prev
        ])
      }),
      window.api.onContDone((d) => {
        if (d.sessionId !== sidRef.current) return
        setRunning(false)
        setDone({ reason: d.reason, message: d.message })
      }),
      window.api.onContError((e) => {
        if (e.sessionId !== sidRef.current) return
        setError(e.message)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const start = useCallback(async (req: ContinuousStartRequest) => {
    setCycles([])
    setCurrentTurns([])
    setCurrentCycle(0)
    setCurrentStep('')
    setDone(null)
    setError(null)
    setRunning(true)
    const sid = await window.api.continuousStart(req)
    if (!sid) {
      setRunning(false)
      setError('Pick a project folder and make sure at least one model is online (for the coder).')
      return
    }
    sidRef.current = sid
  }, [])

  const stop = useCallback(() => {
    if (sidRef.current) window.api.continuousStop(sidRef.current)
    setRunning(false)
  }, [])

  return { running, currentCycle, currentStep, currentTurns, cycles, done, error, start, stop }
}
