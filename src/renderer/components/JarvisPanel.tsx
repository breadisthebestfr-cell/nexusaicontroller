import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, ChatMessage, JarvisOutcome, OllamaInstance } from '../../shared/types'
import { cancelSpeak, speak, ttsSupported } from '../voice'
import { JarvisOrb, type OrbState } from './JarvisOrb'

const ACCEPTED_KEY = 'laic.jarvisAccepted'

interface ModelOption {
  key: string
  label: string
  baseUrl: string
  model: string
  cloud: boolean
}

interface TurnActions {
  turnId: string
  outcomes: JarvisOutcome[]
}

function Disclaimer({ name, onAccept }: { name: string; onAccept: () => void }): JSX.Element {
  return (
    <div className="panel" style={{ maxWidth: 620 }}>
      <h2>⚠️ Enable {name} (desktop assistant)?</h2>
      <p>
        {name} can take actions on your computer — open apps, open web pages, create and open documents, and
        (with your approval) run commands. It follows instructions from an AI model, which can misunderstand
        or make mistakes.
      </p>
      <div className="notice" style={{ borderLeftColor: 'var(--danger)' }}>
        By enabling this, you accept that <strong>you use it at your own risk</strong> and that this app and
        its authors are <strong>not responsible for anything the AI does</strong> to your PC, files, or
        accounts. Start in <strong>Allowlist</strong> mode and only use <strong>Trust</strong> mode once
        you're comfortable.
      </div>
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <div className="spacer" />
        <button className="primary" onClick={onAccept}>
          I understand — enable {name}
        </button>
      </div>
    </div>
  )
}

export function JarvisPanel({ instances }: { instances: OllamaInstance[] }): JSX.Element {
  const [accepted, setAccepted] = useState(localStorage.getItem(ACCEPTED_KEY) === '1')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [sel, setSel] = useState('')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [actions, setActions] = useState<TurnActions[]>([])
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [pulse, setPulse] = useState(0)
  const [expected, setExpected] = useState(0) // actions Jarvis said it would run this turn
  const [debug, setDebug] = useState(false)
  const [lastRaw, setLastRaw] = useState('')
  const [speakOn, setSpeakOn] = useState(localStorage.getItem('laic.jarvisSpeak') !== '0')
  const turnRef = useRef<string | null>(null)
  const speakRef = useRef(speakOn)

  useEffect(() => {
    window.api.getSettings().then(setSettings)
  }, [])
  useEffect(() => {
    speakRef.current = speakOn
    localStorage.setItem('laic.jarvisSpeak', speakOn ? '1' : '0')
    if (!speakOn) cancelSpeak()
  }, [speakOn])

  const options = useMemo<ModelOption[]>(() => {
    const opts: ModelOption[] = []
    for (const inst of instances) {
      if (!inst.online) continue
      for (const m of inst.models) {
        opts.push({ key: `${inst.baseUrl}|${m.name}`, label: `${m.name} @ ${inst.id}`, baseUrl: inst.baseUrl, model: m.name, cloud: inst.source === 'cloud' })
      }
    }
    return opts
  }, [instances])

  // Default to a cloud model (better at picking actions) when available.
  useEffect(() => {
    if (sel && options.some((o) => o.key === sel)) return
    const pick = options.find((o) => o.cloud) ?? options[0]
    if (pick) setSel(pick.key)
  }, [options, sel])

  useEffect(() => {
    const offs = [
      window.api.onJarvisReply((r) => {
        if (r.turnId !== turnRef.current) return
        if (r.error) {
          setMessages((m) => setLastAssistant(m, `[error: ${r.error}]`))
          setBusy(false)
          return
        }
        if (r.delta) setMessages((m) => appendAssistant(m, r.delta!))
        if (r.done) {
          setBusy(false)
          setExpected(r.actions ?? 0)
          setLastRaw(r.raw ?? '')
          const clean = (r.text ?? '').trim()
          if (clean) setMessages((m) => setLastAssistant(m, clean))
          if (clean && speakRef.current) {
            speak(clean, undefined, {
              onStart: () => setSpeaking(true),
              onBoundary: () => setPulse((p) => p + 1),
              onEnd: () => setSpeaking(false)
            })
          }
        }
      }),
      window.api.onJarvisAction((r) => {
        if (r.turnId !== turnRef.current) return
        setActions((prev) => {
          const cur = prev.find((t) => t.turnId === r.turnId)
          if (cur) return prev.map((t) => (t.turnId === r.turnId ? { ...t, outcomes: [...t.outcomes, r.outcome] } : t))
          return [...prev, { turnId: r.turnId, outcomes: [r.outcome] }]
        })
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const send = async () => {
    const option = options.find((o) => o.key === sel)
    if (!option || !input.trim() || busy) return
    const history = messages
    const next: ChatMessage[] = [...messages, { role: 'user', content: input.trim() }, { role: 'assistant', content: '' }]
    setMessages(next)
    setInput('')
    setBusy(true)
    setSpeaking(false)
    setExpected(0)
    cancelSpeak()
    turnRef.current = await window.api.jarvisSend({
      message: input.trim(),
      history,
      baseUrl: option.baseUrl,
      model: option.model
    })
  }

  const setMode = async (mode: 'allowlist' | 'trust') => {
    const next = await window.api.setSettings({ jarvisSafetyMode: mode })
    setSettings(next)
  }

  if (!settings) return <div className="panel">Loading…</div>
  if (!accepted) {
    return (
      <Disclaimer
        name={settings.assistantName}
        onAccept={() => {
          localStorage.setItem(ACCEPTED_KEY, '1')
          setAccepted(true)
        }}
      />
    )
  }

  if (options.length === 0) {
    return (
      <div className="panel">
        <h2>{settings.assistantName}</h2>
        <div className="notice">No online models. Add a cloud key or an Ollama instance on the Instances tab first.</div>
      </div>
    )
  }

  const outcomesForLast = actions.find((t) => t.turnId === turnRef.current)?.outcomes ?? []
  const executing = expected > 0 && outcomesForLast.length < expected
  const orbState: OrbState = speaking ? 'talking' : busy || executing ? 'working' : 'idle'
  const caption = speaking ? 'speaking…' : busy ? 'thinking…' : executing ? 'working…' : 'ready'

  return (
    <div className="panel">
      <div className="row wrap" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>{settings.assistantName}</h2>
        <div className="spacer" />
        <select value={sel} onChange={(e) => setSel(e.target.value)} title="Brain">
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.cloud ? '☁ ' : ''}
              {o.label}
            </option>
          ))}
        </select>
        <select value={settings.jarvisSafetyMode} onChange={(e) => setMode(e.target.value as 'allowlist' | 'trust')} title="Safety mode">
          <option value="allowlist">🔒 Allowlist</option>
          <option value="trust">⚡ Trust</option>
        </select>
        {ttsSupported() && (
          <button className={speakOn ? 'primary' : ''} onClick={() => setSpeakOn((v) => !v)} title="Speak replies">
            {speakOn ? '🔊' : '🔇'}
          </button>
        )}
        <button className={debug ? 'primary' : ''} onClick={() => setDebug((v) => !v)} title="Show the model's raw output">
          🐞
        </button>
        <button onClick={() => { setMessages([]); setActions([]) }} disabled={busy}>
          Clear
        </button>
      </div>

      <JarvisOrb state={orbState} pulse={pulse} />
      <div className="orb-caption">{caption}</div>

      <div className="chat-log" style={{ marginTop: 12 }}>
        {messages.length === 0 && (
          <div className="small muted">
            Try: “open Firefox”, “open a notepad and write a day routine plan”, “search the weather”.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="who">{m.role === 'assistant' ? settings.assistantName : 'you'}</div>
            {m.content || (busy && i === messages.length - 1 ? '…' : '')}
          </div>
        ))}
      </div>

      {outcomesForLast.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {outcomesForLast.map((o, i) => (
            <div key={i} className="small" style={{ color: o.ok ? 'var(--ok)' : 'var(--danger)' }}>
              {o.ok ? '✓' : '✕'} {o.action}: {o.message}
            </div>
          ))}
        </div>
      )}

      {debug && (
        <div className="mono small" style={{ marginTop: 10, padding: 8, border: '1px solid var(--border)', borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
          <div className="muted">Actions parsed this turn: <strong>{expected}</strong> · outcomes: {outcomesForLast.length}</div>
          <div className="muted" style={{ marginTop: 4 }}>Raw model output:</div>
          {lastRaw || '(nothing yet — send a message)'}
        </div>
      )}

      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <textarea
          rows={2}
          style={{ flex: 1, resize: 'vertical' }}
          placeholder={`Tell ${settings.assistantName} what to do… (Ctrl+Enter)`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send()
          }}
        />
        <button className="primary" onClick={send} disabled={busy || !input.trim()} style={{ alignSelf: 'flex-end' }}>
          Send
        </button>
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        Mode: <strong>{settings.jarvisSafetyMode}</strong>. Full mouse/keyboard/screen control (Stage 2) is
        not enabled in this build.
      </div>
    </div>
  )
}

function appendAssistant(messages: ChatMessage[], text: string): ChatMessage[] {
  const copy = [...messages]
  const last = copy[copy.length - 1]
  if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + text }
  else copy.push({ role: 'assistant', content: text })
  return copy
}
function setLastAssistant(messages: ChatMessage[], text: string): ChatMessage[] {
  const copy = [...messages]
  const last = copy[copy.length - 1]
  if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, content: text }
  else copy.push({ role: 'assistant', content: text })
  return copy
}
