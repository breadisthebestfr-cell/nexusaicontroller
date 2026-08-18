import { useEffect, useState } from 'react'

/** A guided step. `tab` (when set) switches the app to that tab so the real UI shows behind the card. */
interface Step {
  tab?: string
  title: string
  body: JSX.Element
}

const STEPS: Step[] = [
  {
    title: '👋 Welcome to Nexus',
    body: (
      <>
        <p>
          Nexus is your <strong>command center for AI</strong>. It finds the AI models running on your PC and
          other machines on your WiFi (Ollama), lets you add <strong>cloud</strong> models too, and puts them
          to work — chatting, building projects together, or acting as <strong>Jarvis</strong>, a desktop
          assistant you can talk to.
        </p>
        <p className="small muted">
          This quick tour points out each tab and what to click. Use <strong>Next</strong> / <strong>Back</strong>,
          or <strong>Skip</strong> anytime. You can reopen it later with the <strong>?</strong> button, top-right.
        </p>
      </>
    )
  },
  {
    tab: 'instances',
    title: '1 · Instances — find your AIs',
    body: (
      <>
        <p>
          Click <strong>Scan WiFi</strong> to sweep your network for Ollama, or use <strong>Add a host
          manually</strong> with an <span className="mono">IP:port</span>. A green dot means online; each
          instance lists its models.
        </p>
        <p className="small muted">
          ⚠️ A model on <em>another</em> PC only shows up if that PC runs Ollama with{' '}
          <span className="mono">OLLAMA_HOST=0.0.0.0</span> and allows port <span className="mono">11434</span>{' '}
          through its firewall. Your own machine is detected automatically. Cloud models (added in Settings)
          appear here too.
        </p>
      </>
    )
  },
  {
    tab: 'chat',
    title: '2 · Chat — try one model',
    body: (
      <>
        <p>
          Pick an instance and a model, then chat with it to confirm everything works. Replies stream in and
          stay short by default.
        </p>
        <p className="small muted">
          Tap <strong>🔊</strong> to have replies read aloud, or <strong>🎤</strong> to dictate. The team stuff
          happens on the Project tab.
        </p>
      </>
    )
  },
  {
    tab: 'arena',
    title: '3 · Arena — compare models',
    body: (
      <p>
        Send <strong>one prompt to up to 4 models at once</strong> (local or cloud) and see their answers
        side-by-side, with speed stats. Handy for picking which model is best for a job.
      </p>
    )
  },
  {
    tab: 'jarvis',
    title: '4 · Jarvis — your desktop assistant',
    body: (
      <>
        <p>
          Type (or hear spoken replies from) <strong>Jarvis</strong> and it can act on your PC — open apps and
          web pages, write documents, and more. The glowing <strong>orb</strong> reacts as it listens, thinks,
          and talks.
        </p>
        <p className="small muted">
          The first time you open it you'll accept a short at-your-own-risk notice. Start in{' '}
          <strong>🔒 Allowlist</strong> mode — risky actions ask your approval first; switch to{' '}
          <strong>⚡ Trust</strong> once you're comfortable. Set its name and known apps in Settings.
        </p>
      </>
    )
  },
  {
    tab: 'project',
    title: '5 · Project — make them build something',
    body: (
      <>
        <p>
          Click <strong>Choose…</strong> to pick a folder, assign roles (or just pick{' '}
          <strong>🤖 Auto — best available</strong> to auto-select your strongest model), type a task, and hit{' '}
          <strong>Run collaboration</strong>.
        </p>
        <p className="small muted">
          A <strong>planner</strong> plans, the <strong>coder</strong> writes files into your folder, and the{' '}
          <strong>reviewer</strong> checks the work. You watch it stream live; files appear in the panel and on disk.
        </p>
      </>
    )
  },
  {
    tab: 'project',
    title: '6 · Continuous — let them keep going',
    body: (
      <>
        <p>
          On the Project tab, switch to the <strong>Continuous</strong> sub-tab, set a <strong>goal</strong>, and
          press <strong>Start</strong>. The AIs work in repeating <strong>cycles</strong>, and each cycle is{' '}
          <strong>committed to git</strong> so you can always undo.
        </p>
        <p className="small muted">
          It runs until the goal is done, you press Stop, or it stalls. Great for slowly building something with
          smaller local models.
        </p>
      </>
    )
  },
  {
    tab: 'history',
    title: '7 · History — review past runs',
    body: (
      <p>
        Every run and every continuous cycle is saved here. Click one to reopen its full transcript and the files
        it wrote, or delete it.
      </p>
    )
  },
  {
    tab: 'settings',
    title: '8 · Settings — keys, tuning & notifications',
    body: (
      <>
        <p>
          Add <strong>cloud API keys</strong> (OpenAI / Claude / Grok) to use hosted models, set{' '}
          <strong>Jarvis</strong>'s name, safety mode, and known apps, and — since small models need help —
          tweak per-role <strong>Agent prompts</strong>, <strong>temperature</strong>, and{' '}
          <strong>Continuous</strong> limits.
        </p>
        <p className="small muted">
          Under <strong>Discord notifications</strong>, paste a webhook URL and press <strong>Test</strong> to get
          progress/errors in your channel. Add your Discord user ID to actually get <strong>pinged</strong> on your
          phone. All keys stay on this machine.
        </p>
      </>
    )
  },
  {
    title: "🎉 You're set!",
    body: (
      <>
        <p>
          That's Nexus: <strong>Instances</strong> → <strong>Chat</strong> → <strong>Arena</strong> →{' '}
          <strong>Jarvis</strong> → <strong>Project</strong> (single or continuous) → <strong>History</strong>{' '}
          → <strong>Settings</strong>.
        </p>
        <p className="small muted">
          To control the AIs from Discord, or let Claude Code drive them, see the README (the Discord bot and MCP
          server). Reopen this tour anytime with the <strong>?</strong> button.
        </p>
      </>
    )
  }
]

export function Onboarding({
  onClose,
  goToTab
}: {
  onClose: () => void
  goToTab: (tab: string) => void
}): JSX.Element {
  const [i, setI] = useState(0)
  const step = STEPS[i]
  const isLast = i === STEPS.length - 1

  // Reveal the relevant tab behind the card as steps advance.
  useEffect(() => {
    if (step.tab) goToTab(step.tab)
  }, [i, step.tab, goToTab])

  return (
    <div className="tour-backdrop" onClick={onClose}>
      <div className="tour-card" onClick={(e) => e.stopPropagation()}>
        <div className="tour-body">
          <h2 style={{ marginTop: 0 }}>{step.title}</h2>
          {step.body}
        </div>

        <div className="tour-dots">
          {STEPS.map((_, idx) => (
            <span key={idx} className={`tour-dot ${idx === i ? 'on' : ''}`} />
          ))}
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="small" onClick={onClose}>
            {isLast ? 'Close' : 'Skip'}
          </button>
          <div className="spacer" />
          <button className="small" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}>
            Back
          </button>
          {isLast ? (
            <button className="primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <button className="primary" onClick={() => setI((n) => Math.min(STEPS.length - 1, n + 1))}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
