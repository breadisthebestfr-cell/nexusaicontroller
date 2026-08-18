import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type AgentRole, type AppSettings, type CloudProviderConfig } from '../../shared/types'

const ROLES: AgentRole[] = ['planner', 'coder', 'reviewer']
const CLOUD_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  xai: 'xAI (Grok)',
  gemini: 'Google (Gemini)',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  cerebras: 'Cerebras',
  mistral: 'Mistral'
}

// Providers with a genuinely usable free tier (free daily tokens / free models), newest-friendly first.
const FREE_KEYS: Array<{ id: string; name: string; blurb: string; url: string }> = [
  { id: 'groq', name: 'Groq', blurb: 'Free & very fast. Generous daily limits, no card needed.', url: 'https://console.groq.com/keys' },
  { id: 'gemini', name: 'Google Gemini', blurb: 'Free tier with a daily quota. Sign in with a Google account.', url: 'https://aistudio.google.com/app/apikey' },
  { id: 'cerebras', name: 'Cerebras', blurb: 'Free tier, extremely fast inference. No card to start.', url: 'https://cloud.cerebras.ai' },
  { id: 'mistral', name: 'Mistral', blurb: 'Free "La Plateforme" tier (Experiment plan).', url: 'https://console.mistral.ai/api-keys' },
  { id: 'openrouter', name: 'OpenRouter', blurb: 'Many :free community models; some give free daily calls.', url: 'https://openrouter.ai/keys' }
]

export function SettingsPanel(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.getSettings().then(setSettings)
  }, [])

  const update = (patch: Partial<AppSettings>) => {
    setSettings((s) => ({ ...s, ...patch }))
    setSaved(false)
  }

  const save = async () => {
    const next = await window.api.setSettings(settings)
    setSettings(next)
    setSaved(true)
    window.api.getControlInfo().then(setCtrl)
  }

  const [testResult, setTestResult] = useState('')

  const setTemp = (role: AgentRole, value: number) =>
    update({ temperatures: { ...settings.temperatures, [role]: value } })
  const setPrompt = (role: AgentRole, value: string) =>
    update({ promptOverrides: { ...settings.promptOverrides, [role]: value } })
  const setProvider = (id: string, patch: Partial<CloudProviderConfig>) =>
    update({ cloudProviders: { ...settings.cloudProviders, [id]: { ...settings.cloudProviders[id], ...patch } } })

  const [showFree, setShowFree] = useState(false)
  const [modelStatus, setModelStatus] = useState<Record<string, string>>({})
  const fetchModels = async (id: string, freeOnly = false) => {
    const cfg = settings.cloudProviders[id]
    if (!cfg?.apiKey) {
      setModelStatus((s) => ({ ...s, [id]: 'Add an API key first.' }))
      return
    }
    setModelStatus((s) => ({ ...s, [id]: freeOnly ? 'Finding free models…' : 'Fetching…' }))
    const res = await window.api.listProviderModels({ providerId: id, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, freeOnly })
    if (res.ok) {
      setProvider(id, { models: res.models })
      const label = freeOnly ? 'free model(s)' : 'model(s)'
      setModelStatus((s) => ({ ...s, [id]: `Found ${res.models.length} ${label} — trim to what you want, then Save.` }))
    } else {
      setModelStatus((s) => ({ ...s, [id]: `Failed: ${res.error}` }))
    }
  }

  const validateModels = async (id: string) => {
    const cfg = settings.cloudProviders[id]
    if (!cfg?.apiKey || cfg.models.length === 0) {
      setModelStatus((s) => ({ ...s, [id]: 'Add a key and some models first.' }))
      return
    }
    setModelStatus((s) => ({ ...s, [id]: `Testing ${cfg.models.length} models… (this can take a moment)` }))
    const r = await window.api.validateProviderModels({ providerId: id, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, models: cfg.models })
    // Keep everything that isn't confirmed gone: working + rate-limited + ambiguous errors.
    const keep = [...r.ok, ...r.quota, ...r.errors.map((e) => e.model)].sort()
    setProvider(id, { models: keep })
    const bits = [`${r.ok.length} ok`]
    if (r.quota.length) bits.push(`${r.quota.length} rate-limited (kept)`)
    if (r.dead.length) bits.push(`${r.dead.length} removed`)
    setModelStatus((s) => ({ ...s, [id]: `${bits.join(' · ')}${r.dead.length ? ' — Save to keep.' : ''}` }))
  }

  const testWebhook = async () => {
    setTestResult('Sending…')
    // Persist first so the main process tests the current URL.
    await window.api.setSettings(settings)
    const ok = await window.api.notifyTest()
    setTestResult(ok ? 'Sent — check your Discord channel.' : 'Failed — check the URL.')
  }

  // MCP registration snippet for Claude Code.
  const [mcp, setMcp] = useState<{ command: string; json: string; entry: string; hasCloud: boolean } | null>(null)
  const [copied, setCopied] = useState('')
  const [ctrl, setCtrl] = useState<{ enabled: boolean; running: boolean; port: number; lan: boolean; token: string; urls: string[]; error: string | null } | null>(null)
  useEffect(() => {
    window.api.getMcpConfig().then(setMcp)
    window.api.getControlInfo().then(setCtrl)
  }, [])
  const setLocalControl = (patch: Partial<AppSettings['localControl']>) =>
    update({ localControl: { ...settings.localControl, ...patch } })
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      setCopied('copy failed')
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 620 }}>
      <h2>Scan settings</h2>

      <div className="field">
        <label>Ports to probe (comma-separated)</label>
        <input
          className="mono"
          value={settings.scanPorts.join(', ')}
          onChange={(e) =>
            update({
              scanPorts: e.target.value
                .split(',')
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isInteger(n) && n > 0 && n < 65536)
            })
          }
        />
      </div>

      <div className="field">
        <label>Per-host connect timeout (ms)</label>
        <input
          type="number"
          value={settings.connectTimeoutMs}
          onChange={(e) => update({ connectTimeoutMs: Number(e.target.value) || 400 })}
        />
      </div>

      <div className="field">
        <label>Scan concurrency</label>
        <input
          type="number"
          value={settings.scanConcurrency}
          onChange={(e) => update({ scanConcurrency: Number(e.target.value) || 64 })}
        />
      </div>

      <div className="field">
        <label>Health re-poll interval (ms, 0 = off)</label>
        <input
          type="number"
          value={settings.healthPollMs}
          onChange={(e) => update({ healthPollMs: Number(e.target.value) || 0 })}
        />
      </div>

      <h2 style={{ marginTop: 22 }}>Agent helper (for small local models)</h2>
      <p className="small muted">
        Lower temperature = more focused/deterministic (better for coding). Leave a prompt blank to use
        the built-in, small-model-tuned default. These apply to collaboration runs on the Project tab.
      </p>

      {ROLES.map((role) => (
        <div className="field" key={role}>
          <label style={{ textTransform: 'capitalize' }}>
            {role} — temperature
          </label>
          <input
            type="number"
            step={0.1}
            min={0}
            max={2}
            value={settings.temperatures[role]}
            onChange={(e) => setTemp(role, Math.max(0, Math.min(2, Number(e.target.value))))}
            style={{ width: 100 }}
          />
          <label style={{ marginTop: 6 }}>{role} — system prompt override</label>
          <textarea
            rows={3}
            placeholder="Leave blank to use the tuned default"
            value={settings.promptOverrides[role] ?? ''}
            onChange={(e) => setPrompt(role, e.target.value)}
          />
        </div>
      ))}

      <h2 style={{ marginTop: 22 }}>Continuous mode</h2>
      <div className="field">
        <label>Max cycles per session</label>
        <input
          type="number"
          min={1}
          value={settings.continuous.maxCycles}
          onChange={(e) => update({ continuous: { ...settings.continuous, maxCycles: Math.max(1, Number(e.target.value) || 1) } })}
          style={{ width: 100 }}
        />
      </div>
      <div className="field">
        <label>Delay between cycles (ms)</label>
        <input
          type="number"
          min={0}
          value={settings.continuous.cycleDelayMs}
          onChange={(e) => update({ continuous: { ...settings.continuous, cycleDelayMs: Math.max(0, Number(e.target.value) || 0) } })}
          style={{ width: 120 }}
        />
      </div>
      <div className="field">
        <label>Stall threshold (no-change cycles before pausing)</label>
        <input
          type="number"
          min={1}
          value={settings.continuous.stallThreshold}
          onChange={(e) => update({ continuous: { ...settings.continuous, stallThreshold: Math.max(1, Number(e.target.value) || 1) } })}
          style={{ width: 100 }}
        />
      </div>
      <div className="field">
        <label className="row" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={settings.continuous.gitAutoCommit}
            onChange={(e) => update({ continuous: { ...settings.continuous, gitAutoCommit: e.target.checked } })}
            style={{ width: 'auto' }}
          />
          Auto-commit each cycle to git (recommended — your undo net)
        </label>
      </div>

      <h2 style={{ marginTop: 22 }}>Chat style</h2>
      <div className="field">
        <label>System prompt for the Chat tab (keeps replies short &amp; direct)</label>
        <textarea
          rows={3}
          value={settings.chatSystemPrompt}
          onChange={(e) => update({ chatSystemPrompt: e.target.value })}
          placeholder="Leave blank for no system prompt"
        />
      </div>

      <h2 style={{ marginTop: 22 }}>Agent shell commands</h2>
      <div className="notice" style={{ borderLeftColor: 'var(--danger)' }}>
        ⚠️ When enabled, agents can request shell commands that run on <strong>your computer with your
        permissions</strong>. Interactive runs ask you to approve each command; continuous/bot runs only run
        commands on the allowlist below. Keep this off unless you understand the risk.
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label className="row" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={settings.commandsEnabled}
            onChange={(e) => update({ commandsEnabled: e.target.checked })}
            style={{ width: 'auto' }}
          />
          Enable agent shell commands
        </label>
      </div>
      <div className="field">
        <label>Allowlist — one command per line (prefix match; these run without asking)</label>
        <textarea
          rows={4}
          className="mono"
          placeholder={'npm test\nnpm run build\ngit status'}
          value={settings.commandAllowlist.join('\n')}
          onChange={(e) =>
            update({ commandAllowlist: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })
          }
        />
      </div>
      <div className="field">
        <label>Per-command timeout (ms)</label>
        <input
          type="number"
          min={1000}
          value={settings.commandTimeoutMs}
          onChange={(e) => update({ commandTimeoutMs: Number(e.target.value) || 60000 })}
          style={{ width: 120 }}
        />
      </div>

      <h2 style={{ marginTop: 22 }}>Jarvis (desktop assistant)</h2>
      <p className="small muted">
        The name and known apps for the Jarvis tab. In <strong>Allowlist</strong> mode, opening an unknown app
        or running a command asks for your approval; <strong>Trust</strong> mode runs everything without
        asking. Each app is <em>Name = launch command</em> (the command is what Windows runs, e.g.{' '}
        <code>notepad</code>, <code>firefox</code>, <code>calc</code>).
      </p>
      <div className="field">
        <label>Assistant name</label>
        <input
          value={settings.assistantName}
          onChange={(e) => update({ assistantName: e.target.value })}
          placeholder="Jarvis"
          style={{ width: 200 }}
        />
      </div>
      <div className="field">
        <label>Safety mode</label>
        <select
          value={settings.jarvisSafetyMode}
          onChange={(e) => update({ jarvisSafetyMode: e.target.value as 'allowlist' | 'trust' })}
          style={{ width: 200 }}
        >
          <option value="allowlist">🔒 Allowlist (ask for risky actions)</option>
          <option value="trust">⚡ Trust (run without asking)</option>
        </select>
      </div>
      <div className="field">
        <label>Known apps — one per line, <code>Name = command</code></label>
        <textarea
          rows={4}
          className="mono"
          placeholder={'Notepad = notepad\nFirefox = firefox\nCalculator = calc'}
          value={Object.entries(settings.jarvisApps)
            .map(([name, cmd]) => `${name} = ${cmd}`)
            .join('\n')}
          onChange={(e) =>
            update({
              jarvisApps: Object.fromEntries(
                e.target.value
                  .split('\n')
                  .map((line) => line.split('='))
                  .filter((parts) => parts.length >= 2 && parts[0].trim())
                  .map((parts) => [parts[0].trim(), parts.slice(1).join('=').trim()])
              )
            })
          }
        />
      </div>

      <h2 style={{ marginTop: 22 }}>Cloud providers (optional)</h2>
      <p className="small muted">
        Add API keys to use hosted models (OpenAI, Claude, Grok…) alongside your local ones — they show up in
        Chat, Arena, and as agent roles. Keys are stored only on this machine. Leave a key blank to disable
        that provider. Use <strong>Fetch models</strong> on a provider to pull its live model list (kills the
        stale-id 404s). Or grab a free key below.
      </p>

      <button onClick={() => setShowFree((v) => !v)} style={{ marginBottom: 8 }}>
        {showFree ? 'Hide free API keys' : '🎁 Find free API keys'}
      </button>
      {showFree && (
        <div className="instance" style={{ marginBottom: 12 }}>
          <p className="small muted" style={{ marginTop: 0 }}>
            These have real free tiers (free daily tokens / free models). Click to open the provider's key page,
            paste the key into its card below, then hit <strong>Fetch models</strong>.
          </p>
          {FREE_KEYS.map((f) => (
            <div key={f.id} className="row" style={{ gap: 8, alignItems: 'baseline', marginTop: 6 }}>
              <button onClick={() => window.api.openExternal(f.url)}>Get {f.name} key →</button>
              <span className="small muted">{f.blurb}</span>
            </div>
          ))}
        </div>
      )}
      {Object.entries(settings.cloudProviders).map(([id, cfg]) => (
        <div className="instance" key={id} style={{ marginBottom: 10 }}>
          <strong style={{ textTransform: 'capitalize' }}>{CLOUD_LABELS[id] ?? id}</strong>
          <div className="field" style={{ marginTop: 6 }}>
            <label>API key</label>
            <input
              type="password"
              className="mono"
              placeholder="paste key (stays on this machine)"
              value={cfg.apiKey}
              onChange={(e) => setProvider(id, { apiKey: e.target.value.trim() })}
            />
          </div>
          <div className="field">
            <label>Models (comma-separated)</label>
            <input
              className="mono"
              value={cfg.models.join(', ')}
              onChange={(e) => setProvider(id, { models: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
            <div className="row" style={{ gap: 8, marginTop: 4, alignItems: 'center' }}>
              <button onClick={() => fetchModels(id)} disabled={!cfg.apiKey} title="Fetch the live model list from this provider">
                Fetch models
              </button>
              <button onClick={() => fetchModels(id, true)} disabled={!cfg.apiKey} title="Only models this provider reports as free (e.g. OpenRouter :free)">
                Free only
              </button>
              <button onClick={() => validateModels(id)} disabled={!cfg.apiKey || cfg.models.length === 0} title="Ping each model and remove ones that are gone (404/retired). Keeps rate-limited ones.">
                Validate &amp; clean
              </button>
              {modelStatus[id] && <span className="small muted">{modelStatus[id]}</span>}
            </div>
          </div>
          <div className="field">
            <label>Base URL override (optional)</label>
            <input
              className="mono"
              placeholder="leave blank for the default"
              value={cfg.baseUrl ?? ''}
              onChange={(e) => setProvider(id, { baseUrl: e.target.value.trim() })}
            />
          </div>
        </div>
      ))}

      <h2 style={{ marginTop: 22 }}>Connect to Claude Code (MCP)</h2>
      <p className="small muted">
        Let Claude Code drive your models through this app's MCP server. Run <strong>one</strong> of the
        following on the machine where you use Claude Code (this checkout must be present). Then restart Claude
        Code and ask it to use the <code>localai</code> tools.
        {mcp?.hasCloud && (
          <>
            {' '}
            <strong>This includes your configured cloud API keys</strong> so Claude can use cloud models too —
            treat the snippet as a secret.
          </>
        )}
      </p>
      {mcp && (
        <>
          <label className="small muted">Quick add (run in a terminal):</label>
          <pre className="chat-log mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 90 }}>{mcp.command}</pre>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={() => copy(mcp.command, 'command')}>{copied === 'command' ? 'Copied ✓' : 'Copy command'}</button>
          </div>
          <label className="small muted" style={{ marginTop: 10, display: 'block' }}>…or add to a <code>.mcp.json</code>:</label>
          <pre className="chat-log mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 160 }}>{mcp.json}</pre>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={() => copy(mcp.json, 'json')}>{copied === 'json' ? 'Copied ✓' : 'Copy JSON'}</button>
          </div>
        </>
      )}

      <h2 style={{ marginTop: 22 }}>Remote control (LAN)</h2>
      <p className="small muted">
        Serve a control page + API so you can drive Nexus from your phone or another device. Protected by a
        token, but <strong>anyone on your network with the URL can use it</strong> — leave it off on untrusted
        networks. Changes apply when you press <strong>Save</strong>.
      </p>
      <label className="row small" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={settings.localControl.enabled}
          onChange={(e) => setLocalControl({ enabled: e.target.checked })}
        />
        Enable the control server
      </label>
      <div className="row wrap" style={{ gap: 12, marginTop: 8 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Port</label>
          <input
            type="number"
            className="mono"
            style={{ width: 100 }}
            value={settings.localControl.port}
            onChange={(e) => setLocalControl({ port: Math.min(65535, Math.max(1, Number(e.target.value) || 8765)) })}
          />
        </div>
        <label className="row small" style={{ gap: 6, alignSelf: 'flex-end', marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={settings.localControl.lan}
            onChange={(e) => setLocalControl({ lan: e.target.checked })}
          />
          Reachable from other devices on my WiFi
        </label>
        <button style={{ alignSelf: 'flex-end', marginBottom: 6 }} onClick={() => setLocalControl({ token: '' })} title="Clear the token; a new one is generated on Save">
          Regenerate token
        </button>
      </div>
      {ctrl?.error && (
        <div className="small" style={{ color: 'var(--danger)', marginTop: 6 }}>⚠ {ctrl.error}</div>
      )}
      {ctrl && ctrl.enabled && ctrl.urls.length > 0 && (
        <div className="instance" style={{ marginTop: 8 }}>
          <div className="small muted">{ctrl.running ? 'Running — open on the device you want to control from:' : 'Saved — will start on next launch.'}</div>
          {ctrl.urls.map((u) => (
            <div className="row" key={u} style={{ gap: 8, marginTop: 4, alignItems: 'center' }}>
              <code className="mono small" style={{ wordBreak: 'break-all', flex: 1 }}>{u}</code>
              <button onClick={() => copy(u, u)}>{copied === u ? 'Copied ✓' : 'Copy'}</button>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 22 }}>Discord notifications</h2>
      <p className="small muted">
        Paste an <strong>incoming webhook URL</strong> from your Discord channel (Channel → Edit → Integrations
        → Webhooks). The app posts continuous-mode progress, errors, and completions here. Leave blank to
        disable. Keep this URL private.
      </p>
      <div className="field">
        <label>Webhook URL</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="mono"
            style={{ flex: 1 }}
            placeholder="https://discord.com/api/webhooks/…"
            value={settings.discordWebhookUrl}
            onChange={(e) => update({ discordWebhookUrl: e.target.value.trim() })}
          />
          <button onClick={testWebhook} disabled={!settings.discordWebhookUrl}>
            Test
          </button>
        </div>
        {testResult && <div className="small muted" style={{ marginTop: 4 }}>{testResult}</div>}
      </div>
      <div className="field">
        <label>Your Discord user ID (optional — to actually @-ping you)</label>
        <input
          className="mono"
          placeholder="e.g. 123456789012345678"
          value={settings.discordMentionUserId}
          onChange={(e) => update({ discordMentionUserId: e.target.value.trim() })}
        />
        <div className="small muted">
          Enable Developer Mode in Discord, then right-click your name → Copy User ID. Leave blank for
          notifications that don't ping.
        </div>
      </div>

      <div className="row">
        <button className="primary" onClick={save}>
          Save settings
        </button>
        {saved && <span className="small muted">Saved ✓</span>}
      </div>
    </div>
  )
}
