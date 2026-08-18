// Browser voice helpers. Text-to-speech (the AI talks) is reliable via the OS voices.
// Speech-to-text (you talk) is best-effort: Chromium's recognizer often needs network and
// may be unavailable in Electron, so callers must handle the unsupported/error paths.

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function getVoices(): SpeechSynthesisVoice[] {
  return ttsSupported() ? window.speechSynthesis.getVoices() : []
}

export interface SpeakHandlers {
  /** Fired when speech actually begins. */
  onStart?: () => void
  /** Fired at each word/sentence boundary — good for driving a "talking" animation. */
  onBoundary?: () => void
  /** Fired when speech finishes, is cancelled, or errors. */
  onEnd?: () => void
}

/** Speak text aloud, cancelling anything currently speaking. */
export function speak(text: string, voiceURI?: string, handlers?: SpeakHandlers): void {
  if (!ttsSupported() || !text.trim()) return
  const u = new SpeechSynthesisUtterance(text)
  const v = getVoices().find((x) => x.voiceURI === voiceURI)
  if (v) u.voice = v
  if (handlers) {
    let ended = false
    const end = () => {
      if (ended) return
      ended = true
      handlers.onEnd?.()
    }
    u.onstart = () => handlers.onStart?.()
    u.onboundary = () => handlers.onBoundary?.()
    u.onend = end
    u.onerror = end
  }
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(u)
}

export function cancelSpeak(): void {
  if (ttsSupported()) window.speechSynthesis.cancel()
}

export function sttSupported(): boolean {
  if (typeof window === 'undefined') return false
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
}

export interface Recognizer {
  start(): void
  stop(): void
}

export interface RecognizerHandlers {
  onResult: (text: string) => void
  onError: (message: string) => void
  onEnd: () => void
}

/** Create a one-shot speech recognizer, or null if the platform has none. */
export function createRecognizer(handlers: RecognizerHandlers): Recognizer | null {
  const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!Ctor) return null

  // The recognizer's event shapes aren't in lib.dom; treat it loosely.
  const rec = new Ctor() as {
    lang: string
    interimResults: boolean
    maxAlternatives: number
    onresult: (e: { results: Array<Array<{ transcript: string }>> }) => void
    onerror: (e: { error?: string }) => void
    onend: () => void
    start(): void
    stop(): void
  }
  rec.lang = 'en-US'
  rec.interimResults = false
  rec.maxAlternatives = 1
  rec.onresult = (e) => {
    const text = e.results?.[0]?.[0]?.transcript ?? ''
    if (text) handlers.onResult(text)
  }
  rec.onerror = (e) => handlers.onError(e?.error ?? 'speech error')
  rec.onend = () => handlers.onEnd()

  return {
    start: () => {
      try {
        rec.start()
      } catch (err) {
        handlers.onError((err as Error).message)
      }
    },
    stop: () => {
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
    }
  }
}
