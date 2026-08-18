import { useEffect, useMemo, useState } from 'react'
import type { AgentConfig, AgentRole, OllamaInstance } from '../../shared/types'
import { DEFAULT_MAX_ROUNDS } from '../../shared/types'
import { pickBestModel } from '../../shared/modelRanking'
import { useOrchestrator } from '../useOrchestrator'
import { FileViewer, TurnCard } from './TurnCard'
import { ContinuousPanel } from './ContinuousPanel'
import { SnippetBar } from './SnippetBar'

const ROLES: AgentRole[] = ['planner', 'coder', 'reviewer']
const AUTO = '__auto__'

/** A selectable "model @ instance" option; value encodes baseUrl|model. */
interface ModelOption {
  key: string
  label: string
  baseUrl: string
  model: string
}

/** Resolve a dropdown value to a concrete agent: "" = none, AUTO = best available, else explicit. */
function resolveAgent(role: AgentRole, value: string, instances: OllamaInstance[]): AgentConfig | null {
  if (!value) return null
  if (value === AUTO) {
    const best = pickBestModel(instances, { preferCoding: role === 'coder' })
    return best ? { role, baseUrl: best.baseUrl, model: best.model } : null
  }
  const [baseUrl, model] = value.split('|')
  if (!baseUrl || !model) return null
  return { role, baseUrl, model }
}

const DRAFT_KEY = 'laic.projectDraft'

function loadDraft(): { task: string; assignments: Record<AgentRole, string>; maxRounds: number } {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')
    return {
      task: typeof d.task === 'string' ? d.task : '',
      assignments: { planner: '', coder: '', reviewer: '', ...(d.assignments || {}) },
      maxRounds: typeof d.maxRounds === 'number' ? d.maxRounds : DEFAULT_MAX_ROUNDS
    }
  } catch {
    return { task: '', assignments: { planner: '', coder: '', reviewer: '' }, maxRounds: DEFAULT_MAX_ROUNDS }
  }
}

export function ProjectPanel({ instances }: { instances: OllamaInstance[] }): JSX.Element {
  const draft = loadDraft()
  const [mode, setMode] = useState<'single' | 'continuous'>('single')
  const [folder, setFolder] = useState<string | null>(null)
  const [task, setTask] = useState(draft.task)
  const [maxRounds, setMaxRounds] = useState(draft.maxRounds)
  const [assignments, setAssignments] = useState<Record<AgentRole, string>>(draft.assignments)
  const [clarify, setClarify] = useState(true)
  const [viewFile, setViewFile] = useState<string | null>(null)

  const orch = useOrchestrator()

  useEffect(() => {
    window.api.getProjectFolder().then(setFolder)
  }, [])

  // Remember the task + role picks so they survive relaunches.
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ task, assignments, maxRounds }))
  }, [task, assignments, maxRounds])

  const options = useMemo<ModelOption[]>(() => {
    const opts: ModelOption[] = []
    for (const inst of instances) {
      if (!inst.online) continue
      for (const m of inst.models) {
        opts.push({ key: `${inst.baseUrl}|${m.name}`, label: `${m.name} @ ${inst.id}`, baseUrl: inst.baseUrl, model: m.name })
      }
    }
    return opts
  }, [instances])

  const pick = async () => setFolder(await window.api.pickFolder())

  const agents = useMemo(
    () => ROLES.map((r) => resolveAgent(r, assignments[r], instances)).filter((a): a is AgentConfig => a !== null),
    [assignments, instances]
  )
  const hasCoder = agents.some((a) => a.role === 'coder')
  const canRun = !!folder && !!task.trim() && hasCoder && !orch.running

  const run = () => {
    if (!canRun) return
    orch.start({ task: task.trim(), agents, maxRounds, clarify })
  }

  const modeSwitch = (
    <div className="row" style={{ gap: 6, marginBottom: 14 }}>
      <button className={`tab ${mode === 'single' ? 'active' : ''}`} onClick={() => setMode('single')}>
        Single run
      </button>
      <button className={`tab ${mode === 'continuous' ? 'active' : ''}`} onClick={() => setMode('continuous')}>
        Continuous
      </button>
    </div>
  )

  if (mode === 'continuous') {
    return (
      <div>
        {modeSwitch}
        <ContinuousPanel instances={instances} />
      </div>
    )
  }

  return (
    <div>
      {modeSwitch}
      <div className="grid-2">
      <section className="panel">
        <h2>Collaboration setup</h2>

        <div className="field">
          <label>Project folder</label>
          <div className="row" style={{ gap: 8 }}>
            <input readOnly value={folder ?? ''} placeholder="No folder selected" style={{ flex: 1 }} className="mono" />
            <button className="primary" onClick={pick} disabled={orch.running}>
              Choose…
            </button>
            {folder && (
              <button onClick={() => window.api.openProjectFolder()} title="Open in file explorer">
                Open
              </button>
            )}
          </div>
        </div>

        <div className="field">
          <label>Assign roles (planner → coder → reviewer)</label>
          {ROLES.map((role) => (
            <div className="row" key={role} style={{ gap: 8, marginBottom: 6 }}>
              <span className="badge" style={{ width: 78, textAlign: 'center' }}>
                {role}
              </span>
              <select
                style={{ flex: 1 }}
                value={assignments[role]}
                disabled={orch.running}
                onChange={(e) => setAssignments((a) => ({ ...a, [role]: e.target.value }))}
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
          <div className="small muted">
            Coder is required. Planner and Reviewer are optional — add a Reviewer to enable the
            review/iterate loop. "Auto" picks the strongest online model for the role.
          </div>
        </div>

        <div className="field">
          <label>Task</label>
          <SnippetBar current={task} onInsert={(t) => setTask(t)} />
          <textarea
            rows={3}
            value={task}
            disabled={orch.running}
            onChange={(e) => setTask(e.target.value)}
            placeholder='e.g. "Make a Minecraft mod scaffold with a basic block and item."'
          />
        </div>

        <div className="row" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Max rounds</label>
            <input
              type="number"
              min={1}
              max={10}
              value={maxRounds}
              disabled={orch.running}
              onChange={(e) => setMaxRounds(Math.max(1, Number(e.target.value) || 1))}
              style={{ width: 80 }}
            />
          </div>
          <label className="row small" style={{ gap: 6, alignSelf: 'flex-end', marginBottom: 6 }} title="Let the agents ask you clarifying questions before starting">
            <input type="checkbox" checked={clarify} disabled={orch.running} onChange={(e) => setClarify(e.target.checked)} />
            Ask me questions first
          </label>
          <div className="spacer" />
          {orch.running ? (
            <button onClick={orch.cancel} style={{ alignSelf: 'flex-end' }}>
              Stop ■
            </button>
          ) : (
            <button className="primary" onClick={run} disabled={!canRun} style={{ alignSelf: 'flex-end' }}>
              Run collaboration ▶
            </button>
          )}
        </div>
        {!hasCoder && <div className="small muted" style={{ marginTop: 6 }}>Assign a Coder to run.</div>}
      </section>

      <section className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Transcript</h2>
          <div className="spacer" />
          {orch.running && <span className="small muted">running…</span>}
        </div>

        {orch.turns.length === 0 && !orch.running && (
          <div className="notice" style={{ marginTop: 10 }}>
            Configure roles and a task, then run. Each agent's output streams here live; files the coder
            writes appear below and land in your project folder.
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          {orch.turns.map((t) => (
            <TurnCard key={t.key} turn={t} />
          ))}
        </div>

        {orch.summary && (
          <div className="notice" style={{ marginTop: 10, borderLeftColor: 'var(--ok)' }}>
            ✓ {orch.summary}
          </div>
        )}
        {orch.error && (
          <div className="notice" style={{ marginTop: 10, borderLeftColor: 'var(--danger)' }}>
            Error: {orch.error}
          </div>
        )}

        {orch.filesWritten.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <h2>Files written</h2>
            <div className="row wrap">
              {orch.filesWritten.map((f) => (
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
            read={(p) => window.api.readProjectFile(p)}
            reveal={(p) => window.api.revealProjectFile(p)}
            onClose={() => setViewFile(null)}
          />
        )}
      </section>
      </div>
    </div>
  )
}
