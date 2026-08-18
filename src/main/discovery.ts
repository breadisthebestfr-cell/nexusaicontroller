// LAN discovery of Ollama instances.
// No Electron imports here so the logic is unit-testable and script-usable.

import net from 'node:net'
import os from 'node:os'
import { baseUrlFor, getVersion, listModels, listRunningModels } from './ollamaClient'
import type { AppSettings, ManualHost, OllamaInstance } from '../shared/types'

/** Convert a dotted IPv4 string to a 32-bit unsigned int. */
export function ipToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`)
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

/** Convert a 32-bit unsigned int back to a dotted IPv4 string. */
export function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

/**
 * Given a host IP and its netmask, return every usable host address in that subnet
 * (excluding the network and broadcast addresses). Capped to avoid scanning huge ranges:
 * subnets larger than a /22 are treated as /24 around the host to stay responsive.
 */
export function hostsInSubnet(ip: string, netmask: string): string[] {
  const ipInt = ipToInt(ip)
  let maskInt = ipToInt(netmask)

  // Cap the range: never scan more than a /22 (1024 addresses).
  const minMask = ipToInt('255.255.252.0')
  if ((maskInt >>> 0) < (minMask >>> 0)) {
    maskInt = ipToInt('255.255.255.0') // fall back to the host's /24
  }

  const network = (ipInt & maskInt) >>> 0
  const broadcast = (network | (~maskInt >>> 0)) >>> 0

  const hosts: string[] = []
  for (let addr = network + 1; addr < broadcast; addr++) {
    hosts.push(intToIp(addr >>> 0))
  }
  return hosts
}

/** Enumerate candidate host IPs from all non-internal IPv4 interfaces on this machine. */
export function localScanTargets(): string[] {
  const seen = new Set<string>()
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      for (const h of hostsInSubnet(info.address, info.netmask)) seen.add(h)
    }
  }
  return [...seen]
}

/** Attempt a TCP connection; resolve true if the port accepts within the timeout. */
export function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

/** Run tasks with a bounded concurrency pool. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const runners: Promise<void>[] = []
  const n = Math.max(1, Math.min(limit, queue.length))
  for (let i = 0; i < n; i++) {
    runners.push(
      (async () => {
        for (;;) {
          const item = queue.shift()
          if (item === undefined) return
          await worker(item)
        }
      })()
    )
  }
  await Promise.all(runners)
}

/** Build an OllamaInstance by verifying the endpoint and fetching its models. */
export async function inspectInstance(
  host: string,
  port: number,
  source: OllamaInstance['source'],
  timeoutMs: number
): Promise<OllamaInstance> {
  const baseUrl = baseUrlFor(host, port)
  const version = await getVersion(baseUrl, Math.max(timeoutMs, 2000))
  const online = version !== null
  const [models, loaded] = online
    ? await Promise.all([listModels(baseUrl), listRunningModels(baseUrl)])
    : [[], []]
  return {
    id: `${host}:${port}`,
    host,
    port,
    baseUrl,
    online,
    version: version ?? undefined,
    models,
    loaded,
    source,
    lastSeen: online ? Date.now() : undefined,
    error: online ? undefined : 'No response from /api/version'
  }
}

export interface ScanOptions {
  settings: AppSettings
  /** Extra explicit targets (e.g. the loopback address for the local machine). */
  extraTargets?: string[]
  /** Called as probing progresses. */
  onProgress?: (scanned: number, total: number, found: number) => void
  signal?: AbortSignal
}

/**
 * Scan the local subnet(s) for Ollama instances.
 * Phase 1: cheap TCP probe of every candidate host:port.
 * Phase 2: verify open ports via /api/version and pull their models.
 */
export async function scanLan(opts: ScanOptions): Promise<OllamaInstance[]> {
  const { settings, extraTargets = [], onProgress, signal } = opts
  const targets = [...new Set([...localScanTargets(), ...extraTargets])]
  const ports = settings.scanPorts.length ? settings.scanPorts : [11434]

  const pairs: Array<{ host: string; port: number }> = []
  for (const host of targets) for (const port of ports) pairs.push({ host, port })

  const total = pairs.length
  let scanned = 0
  let found = 0
  const openPairs: Array<{ host: string; port: number }> = []

  await pool(pairs, settings.scanConcurrency, async ({ host, port }) => {
    if (signal?.aborted) return
    const open = await probeTcp(host, port, settings.connectTimeoutMs)
    scanned++
    if (open) {
      found++
      openPairs.push({ host, port })
    }
    onProgress?.(scanned, total, found)
  })

  const instances: OllamaInstance[] = []
  await pool(openPairs, 16, async ({ host, port }) => {
    if (signal?.aborted) return
    instances.push(await inspectInstance(host, port, 'scan', settings.connectTimeoutMs))
  })

  // Only keep endpoints that actually spoke the Ollama protocol.
  return instances.filter((i) => i.online).sort((a, b) => a.id.localeCompare(b.id))
}

/** Verify a manually-entered host:port and return its instance record (online or not). */
export async function addManualHost(manual: ManualHost, timeoutMs = 3000): Promise<OllamaInstance> {
  return inspectInstance(manual.host, manual.port, 'manual', timeoutMs)
}

/**
 * Re-inspect a known list of instances (health poll). Returns the merged, updated list
 * with fresh online/offline status, version, and models. Preserves each instance's source.
 */
export async function refreshInstances(existing: OllamaInstance[], timeoutMs: number): Promise<OllamaInstance[]> {
  if (existing.length === 0) return existing
  const refreshed: OllamaInstance[] = []
  await pool(existing, 16, async (inst) => {
    refreshed.push(await inspectInstance(inst.host, inst.port, inst.source, timeoutMs))
  })
  return mergeInstances(existing, refreshed)
}

/** Every IPv4 address that belongs to THIS machine (plus loopback aliases). */
export function localAddresses(): Set<string> {
  const set = new Set<string>(['127.0.0.1', 'localhost', '0.0.0.0'])
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4') set.add(info.address)
    }
  }
  return set
}

/**
 * Collapse duplicate entries for the SAME local Ollama seen at more than one of this
 * machine's own addresses (e.g. 127.0.0.1:11434 and 192.168.1.5:11434 are the same server).
 * Own IPs are unique to this machine, so this never merges a genuinely separate host. The
 * loopback entry is preferred as canonical when present.
 */
export function dedupeSelf(instances: OllamaInstance[]): OllamaInstance[] {
  const own = localAddresses()
  const out: OllamaInstance[] = []
  const localPortIndex = new Map<number, number>() // port -> index in `out`
  for (const inst of instances) {
    if (!own.has(inst.host)) {
      out.push(inst)
      continue
    }
    const existing = localPortIndex.get(inst.port)
    if (existing === undefined) {
      localPortIndex.set(inst.port, out.length)
      out.push(inst)
    } else if (inst.host === '127.0.0.1') {
      out[existing] = inst // prefer loopback as the canonical entry for this local port
    }
  }
  return out
}

/** Merge freshly-discovered instances into a known list, preserving manual entries. */
export function mergeInstances(existing: OllamaInstance[], incoming: OllamaInstance[]): OllamaInstance[] {
  const byId = new Map<string, OllamaInstance>()
  for (const inst of existing) byId.set(inst.id, inst)
  for (const inst of incoming) {
    const prev = byId.get(inst.id)
    // Never downgrade a manual entry's source to 'scan'.
    const source = prev?.source === 'manual' ? 'manual' : inst.source
    byId.set(inst.id, { ...inst, source })
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}
