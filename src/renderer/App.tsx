import { useEffect, useState } from 'react'
import { useInstances } from './useInstances'
import { InstancesPanel } from './components/InstancesPanel'
import { OllamaPanel } from './components/OllamaPanel'
import { ChatPanel } from './components/ChatPanel'
import { ArenaPanel } from './components/ArenaPanel'
import { ProjectPanel } from './components/ProjectPanel'
import { JarvisPanel } from './components/JarvisPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { Onboarding } from './components/Onboarding'
import { ApprovalModal } from './components/ApprovalModal'
import { QuestionModal } from './components/QuestionModal'
import { Toaster } from './components/Toaster'
import { toast } from './toast'

type Tab = 'instances' | 'ollama' | 'chat' | 'arena' | 'jarvis' | 'project' | 'history' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'instances', label: 'Instances' },
  { id: 'ollama', label: 'Ollama' },
  { id: 'chat', label: 'Chat' },
  { id: 'arena', label: 'Arena' },
  { id: 'jarvis', label: 'Jarvis' },
  { id: 'project', label: 'Project' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' }
]

const TOUR_SEEN_KEY = 'laic.onboarded'

const THEMES = ['dark', 'light', 'terminal', 'highcontrast'] as const
type Theme = (typeof THEMES)[number]

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('instances')
  const [tourOpen, setTourOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>((localStorage.getItem('laic.theme') as Theme) || 'dark')
  const instances = useInstances()
  const onlineCount = instances.filter((i) => i.online).length

  // Apply + persist the theme (dark = the bare :root default, so no attribute).
  useEffect(() => {
    if (theme === 'dark') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    localStorage.setItem('laic.theme', theme)
  }, [theme])

  // Auto-open the tour on first launch.
  useEffect(() => {
    if (localStorage.getItem(TOUR_SEEN_KEY) !== '1') setTourOpen(true)
  }, [])

  // Surface unexpected renderer errors instead of failing silently.
  useEffect(() => {
    const onErr = (e: ErrorEvent) => toast(`Error: ${e.message}`, 'error')
    const onRej = (e: PromiseRejectionEvent) => toast(`Error: ${e.reason?.message ?? e.reason}`, 'error')
    window.addEventListener('error', onErr)
    window.addEventListener('unhandledrejection', onRej)
    return () => {
      window.removeEventListener('error', onErr)
      window.removeEventListener('unhandledrejection', onRej)
    }
  }, [])

  const closeTour = () => {
    setTourOpen(false)
    localStorage.setItem(TOUR_SEEN_KEY, '1')
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <h1>Nexus</h1>
        </div>
        <span className="status-chip" title="Online / known AI instances">
          <span className={`dot ${onlineCount > 0 ? 'on' : 'off'}`} />
          {onlineCount} online · {instances.length} known
        </span>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-tools">
          <button className="tab" title="Take the tour" onClick={() => setTourOpen(true)}>
            ?
          </button>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            title="Theme"
            style={{ padding: '4px 8px' }}
          >
            <option value="dark">🌙 Dark</option>
            <option value="light">☀️ Light</option>
            <option value="terminal">🖥️ Terminal</option>
            <option value="highcontrast">◐ High contrast</option>
          </select>
        </div>
      </header>

      <main className="content">
        {tab === 'instances' && <InstancesPanel instances={instances} />}
        {tab === 'ollama' && <OllamaPanel />}
        {tab === 'chat' && <ChatPanel instances={instances} />}
        {tab === 'arena' && <ArenaPanel instances={instances} />}
        {tab === 'jarvis' && <JarvisPanel instances={instances} />}
        {tab === 'project' && <ProjectPanel instances={instances} />}
        {tab === 'history' && <HistoryPanel />}
        {tab === 'settings' && <SettingsPanel />}
      </main>

      {tourOpen && <Onboarding goToTab={(t) => setTab(t as Tab)} onClose={closeTour} />}
      <ApprovalModal />
      <QuestionModal />
      <Toaster />
    </div>
  )
}
