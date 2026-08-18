// Persistent settings + known-host storage backed by electron-store.

import Store from 'electron-store'
import { DEFAULT_SETTINGS, type AppSettings, type ManualHost } from '../shared/types'

interface Schema {
  settings: AppSettings
  manualHosts: ManualHost[]
  projectFolder: string | null
}

const store = new Store<Schema>({
  defaults: {
    settings: DEFAULT_SETTINGS,
    manualHosts: [],
    projectFolder: null
  }
})

export function getSettings(): AppSettings {
  // Deep-merge so new sub-keys inside nested objects (added across versions) are backfilled
  // from defaults instead of being left undefined by a shallow spread.
  const stored = store.get('settings') as Partial<AppSettings>
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    temperatures: { ...DEFAULT_SETTINGS.temperatures, ...stored.temperatures },
    promptOverrides: { ...DEFAULT_SETTINGS.promptOverrides, ...stored.promptOverrides },
    continuous: { ...DEFAULT_SETTINGS.continuous, ...stored.continuous },
    cloudProviders: { ...DEFAULT_SETTINGS.cloudProviders, ...stored.cloudProviders },
    jarvisApps: { ...DEFAULT_SETTINGS.jarvisApps, ...stored.jarvisApps },
    localControl: { ...DEFAULT_SETTINGS.localControl, ...stored.localControl }
  }
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
  store.set('settings', next)
  return next
}

export function getManualHosts(): ManualHost[] {
  return store.get('manualHosts')
}

export function addManualHost(host: ManualHost): ManualHost[] {
  const existing = getManualHosts()
  const dedup = existing.filter((h) => !(h.host === host.host && h.port === host.port))
  const next = [...dedup, host]
  store.set('manualHosts', next)
  return next
}

export function removeManualHost(host: ManualHost): ManualHost[] {
  const next = getManualHosts().filter((h) => !(h.host === host.host && h.port === host.port))
  store.set('manualHosts', next)
  return next
}

export function getProjectFolder(): string | null {
  return store.get('projectFolder')
}

export function setProjectFolder(folder: string | null): void {
  store.set('projectFolder', folder)
}
