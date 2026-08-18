import { useMemo, useState } from 'react'
import type { AgentRole, OllamaInstance, RoleChoice } from '../../shared/types'
import { useContinuous } from '../useContinuous'
import { TurnCard } from './TurnCard'

const ROLES: AgentRole[] = ['planner', 'coder', 'reviewer']

interface ModelOption {
  key: string // baseUrl|model
  label: string
}

const AUTO = '__auto__'

function decodeChoice(value: string): RoleChoice | undefined {
  if (value === AUTO) return { auto: true }
  if (!value) return undefined
  const [baseUrl, model] = value.split('|')
  if (!baseUrl || !model) return undefined
  return { auto: false, baseUrl, model }
}

function reasonColor(reason: string): string {
  if (reason === 'goal-complete') return 'var(--ok)'
  if (reason === 'error') return 'var(--danger)'
  return 'var(--muted)'
}

export function ContinuousPanel({ instances }: { instances: OllamaInstance[] }): JSX.Element {
  const [goal, setGoal] = useState('')
  const [choices, setChoices] = useState<Record<AgentRole, string>>({
    planner: '',
    coder: AUTO, // default the coder to auto-best
    reviewer: ''
  })
  const cont = useContinuous()
  const [diffSha, setDiffSha] = useState<string | null>(null)
  const [diffText, setDiffText] = useState<string | null>(null)

  const openDiff = async (sha: string) => {
    setDiffSha(sha)
    setDiffText(null)
    setDiffText((await window.api.commitDiff(sha)) || '(no diff available)')
  }

  const options = useMemo<ModelOption[]>(() => {
    const opts: ModelOption[] = []
    for (const inst of instances) {
      if (!inst.online) continue
      for (const m of inst.models) opts.push({ key: `${inst.baseUrl}|${m.name}`, label: `${m.name} @ ${inst.id}` })
    }
    return opts
  }, [instances])

  const coderChosen = choices.coder === AUTO || choices.coder !== ''
  const canStart = !!goal.trim() && coderChosen && !cont.running

  const start = () => {
    if (!canStart) return
    cont.start({
      goal: goal.trim(),
      coder: decodeChoice(choices.coder) ?? { auto: true },
      planner: decodeChoice(choices.planner),
      reviewer: decodeChoice(choices.reviewer)
    })
  }

  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Continuous mode</h2>
        <p className="small muted">
          The AIs work in cycles: a lead picks the next small step, the coder writes it, the reviewer checks,
          and each cycle is committed to git. It runs until the goal is done, you stop it, or it stalls.
        </p>

        <div className="field">
          <label>Roles (blank = none; coder required)</label>
          {ROLES.map((role) => (
            <div className="row" key={role} style={{ gap: 8, marginBottom: 6 }}>
              <span className="badge" style={{ width: 78, textAlign: 'center' }}>
                {role}
              </span>
              <select
                style={{ flex: 1 }}
                value={choices[role]}
                disabled={cont.running}
                onChange={(e) => setChoices((c) => ({ ...c, [role]: e.target.value }))}
              >
                <option value="">— none —</option>
                <option value={AUTO}>🤖 Auto — best available{role === 'coder' ? ' (coder-optimized)' : ''}</option>
                {options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="field">
          <label>Goal</label>
          <textarea
            rows={3}
            value={goal}
            disabled={cont.running}
            onChange={(e) => setGoal(e.target.value)}
            placeholder='e.g. "Build a small Minecraft Fabric mod that adds a copper hammer item."'
          />
        </div>

        <div className="row">
          <div className="spacer" />
          {cont.running ? (
            <button onClick={cont.stop}>Stop ■</button>
          ) : (
            <button className="primary" onClick={start} disabled={!canStart}>
              Start continuous ▶
            </button>
          )}
        </div>

        {cont.done && (
          <div className="notice" style={{ marginTop: 10, borderLeftColor: reasonColor(cont.done.reason) }}>
            {cont.done.reason === 'goal-complete' ? '✓ ' : ''}
            {cont.done.message} <span className="small muted">({cont.done.reason})</span>
          </div>
        )}
        {cont.error && (
          <div className="notice" style={{ marginTop: 10, borderLeftColor: 'var(--danger)' }}>
            Error: {cont.error}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Cycles</h2>
          {cont.running && (
            <span className="small muted">· cycle {cont.currentCycle}: {cont.currentStep || '…'}</span>
          )}
        </div>

        {cont.running && cont.currentTurns.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="small muted">Current cycle</div>
            {cont.currentTurns.map((t, i) => (
              <TurnCard key={i} turn={t} />
            ))}
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          {cont.cycles.length === 0 && !cont.running && (
            <div className="notice">No cycles yet. Set a goal and press Start.</div>
          )}
          {cont.cycles.map((c) => (
            <div className="instance" key={c.cycle}>
              <div className="row">
                <span className="badge">cycle {c.cycle}</span>
                <strong>{c.step}</strong>
                <div className="spacer" />
                {c.commit ? (
                  <>
                    <span className="small mono" style={{ color: 'var(--ok)' }}>
                      commit {c.commit}
                    </span>
                    <button
                      className="small"
                      onClick={() => (diffSha === c.commit ? setDiffSha(null) : openDiff(c.commit!))}
                    >
                      {diffSha === c.commit ? 'hide diff' : 'diff'}
                    </button>
                  </>
                ) : (
                  <span className="small muted">no commit</span>
                )}
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {c.filesWritten.length ? `files: ${c.filesWritten.join(', ')}` : 'no files changed'}
              </div>
              {diffSha === c.commit && (
                <pre className="chat-log mono" style={{ marginTop: 8, maxHeight: 320, whiteSpace: 'pre-wrap' }}>
                  {diffText ?? 'Loading…'}
                </pre>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
