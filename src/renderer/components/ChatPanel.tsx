import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, ChatStats, OllamaInstance } from '../../shared/types'
import { cancelSpeak, createRecognizer, getVoices, speak, sttSupported, ttsSupported, type Recognizer } from '../voice'
import { SnippetBar } from './SnippetBar'
import { toast } from '../toast'

export function ChatPanel({ instances }: { instances: OllamaInstance[] }): JSX.Element {
  const online = useMemo(() => instances.filter((i) => i.online && i.models.length > 0), [instances])
  const [instanceId, setInstanceId] = useState('')
  const [model, setModel] = useState('')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [sysPrompt, setSysPrompt] = useState('')
  const [lastStats, setLastStats] = useState<ChatStats | null>(null)
  const activeRequest = useRef<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // Voice: TTS (speak replies) + best-effort STT (mic input).
  const [speakOn, setSpeakOn] = useState(localStorage.getItem('laic.speak') === '1')
  const [voiceURI, setVoiceURI] = useState(localStorage.getItem('laic.voice') || '')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [listening, setListening] = useState(false)
  const [voiceNote, setVoiceNote] = useState('')
  const speakOnRef = useRef(speakOn)
  const voiceURIRef = useRef(voiceURI)
  const replyRef = useRef('')
  const recognizerRef = useRef<Recognizer | null>(null)

  useEffect(() => {
    window.api.getSettings().then((s) => setSysPrompt(s.chatSystemPrompt))
  }, [])

  // Keep refs in sync for use inside the once-subscribed chunk handler.
  useEffect(() => {
    speakOnRef.current = speakOn
    localStorage.setItem('laic.speak', speakOn ? '1' : '0')
    if (!speakOn) cancelSpeak()
  }, [speakOn])
  useEffect(() => {
    voiceURIRef.current = voiceURI
    localStorage.setItem('laic.voice', voiceURI)
  }, [voiceURI])

  // Load TTS voices (they populate asynchronously).
  useEffect(() => {
    if (!ttsSupported()) return
    const load = () => setVoices(getVoices())
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])

  const instance = online.find((i) => i.id === instanceId) ?? online[0]

  // Keep selection valid as instances change.
  useEffect(() => {
    if (!instance) {
      setInstanceId('')
      setModel('')
      return
    }
    if (instance.id !== instanceId) setInstanceId(instance.id)
    if (!instance.models.some((m) => m.name === model)) setModel(instance.models[0]?.name ?? '')
  }, [instance, instanceId, model])

  // Subscribe once to streamed chunks; route by the active requestId.
  useEffect(() => {
    const off = window.api.onChatChunk((chunk) => {
      if (chunk.requestId !== activeRequest.current) return
      if (chunk.error) {
        setMessages((m) => appendAssistant(m, `\n[error: ${chunk.error}]`))
        toast(`Chat failed: ${chunk.error}`, 'error')
        setStreaming(false)
        activeRequest.current = null
        return
      }
      if (chunk.delta) {
        replyRef.current += chunk.delta
        setMessages((m) => appendAssistant(m, chunk.delta!))
      }
      if (chunk.done) {
        setStreaming(false)
        activeRequest.current = null
        if (chunk.stats) setLastStats(chunk.stats)
        if (speakOnRef.current && replyRef.current.trim()) speak(replyRef.current, voiceURIRef.current || undefined)
      }
    })
    return off
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages])

  const send = async () => {
    if (!instance || !model || !input.trim() || streaming) return
    const next: ChatMessage[] = [...messages, { role: 'user', content: input.trim() }]
    // Pre-seed an empty assistant message that streaming appends to.
    setMessages([...next, { role: 'assistant', content: '' }])
    setInput('')
    setStreaming(true)
    replyRef.current = ''
    setLastStats(null)
    cancelSpeak()
    // Prepend the concise-style system prompt to what's sent (not to the visible log).
    const sent: ChatMessage[] = sysPrompt.trim() ? [{ role: 'system', content: sysPrompt }, ...next] : next
    activeRequest.current = await window.api.chatStart({
      baseUrl: instance.baseUrl,
      model,
      messages: sent
    })
  }

  const cancel = () => {
    if (activeRequest.current) window.api.chatCancel(activeRequest.current)
    setStreaming(false)
    activeRequest.current = null
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).slice(0, 5)
    for (const f of files) {
      if (f.size > 200_000) {
        setInput((p) => p + `\n\n[skipped ${f.name}: too large]`)
        continue
      }
      const text = await f.text()
      setInput((p) => `${p}${p ? '\n\n' : ''}\`\`\`${f.name}\n${text}\n\`\`\``)
    }
  }

  const toggleMic = () => {
    if (listening) {
      recognizerRef.current?.stop()
      return
    }
    const rec = createRecognizer({
      onResult: (text) => setInput((prev) => (prev ? prev + ' ' : '') + text),
      onError: (m) => {
        setVoiceNote(`Voice input unavailable (${m}). Type instead.`)
        setListening(false)
      },
      onEnd: () => setListening(false)
    })
    if (!rec) {
      setVoiceNote('Voice input isn’t supported in this environment — type instead.')
      return
    }
    recognizerRef.current = rec
    setVoiceNote('')
    setListening(true)
    rec.start()
  }

  if (online.length === 0) {
    return (
      <div className="panel">
        <h2>Chat</h2>
        <div className="notice">
          No online instance with installed models. Scan or add a host on the Instances tab first.
        </div>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Instance</label>
          <select value={instance?.id ?? ''} onChange={(e) => setInstanceId(e.target.value)}>
            {online.map((i) => (
              <option key={i.id} value={i.id}>
                {i.id}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Model</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {instance?.models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="spacer" />
        {ttsSupported() && (
          <>
            <button
              className={speakOn ? 'primary' : ''}
              onClick={() => setSpeakOn((v) => !v)}
              title="Read replies aloud"
            >
              🔊 {speakOn ? 'Speaking' : 'Speak'}
            </button>
            {speakOn && voices.length > 0 && (
              <select value={voiceURI} onChange={(e) => setVoiceURI(e.target.value)} title="Voice">
                <option value="">default voice</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        <button onClick={() => setMessages([])} disabled={streaming}>
          Clear
        </button>
      </div>

      <div className="chat-log" ref={logRef} style={{ marginTop: 12 }}>
        {messages.length === 0 && <div className="small muted">Say something to {model}…</div>}
        {messages.map((m, idx) => (
          <div key={idx} className={`msg ${m.role}`}>
            <div className="who">{m.role}</div>
            {m.content || (streaming && idx === messages.length - 1 ? '…' : '')}
          </div>
        ))}
      </div>

      {lastStats && (
        <div className="small muted" style={{ marginTop: 6 }}>
          ⚡ {Math.round(lastStats.tokensPerSec)} tok/s · {lastStats.evalCount} tokens ·{' '}
          {(lastStats.totalMs / 1000).toFixed(1)}s
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <SnippetBar current={input} onInsert={(t) => setInput((p) => (p ? p + '\n' : '') + t)} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <textarea
          rows={2}
          style={{ flex: 1, resize: 'vertical' }}
          placeholder="Message… (Ctrl+Enter to send · drop a file to attach it)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send()
          }}
        />
        {sttSupported() && (
          <button
            className={listening ? 'primary' : ''}
            onClick={toggleMic}
            title="Speak your message"
            style={{ alignSelf: 'flex-end' }}
          >
            {listening ? '🎙️ …' : '🎤'}
          </button>
        )}
        {streaming ? (
          <button onClick={cancel} style={{ alignSelf: 'flex-end' }}>
            Stop
          </button>
        ) : (
          <button className="primary" onClick={send} disabled={!input.trim()} style={{ alignSelf: 'flex-end' }}>
            Send
          </button>
        )}
      </div>
      {voiceNote && (
        <div className="small muted" style={{ marginTop: 6 }}>
          {voiceNote}
        </div>
      )}
    </div>
  )
}

function appendAssistant(messages: ChatMessage[], text: string): ChatMessage[] {
  const copy = [...messages]
  const last = copy[copy.length - 1]
  if (last && last.role === 'assistant') {
    copy[copy.length - 1] = { ...last, content: last.content + text }
  } else {
    copy.push({ role: 'assistant', content: text })
  }
  return copy
}
