import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import {
  dedupeSelf,
  hostsInSubnet,
  inspectInstance,
  intToIp,
  ipToInt,
  localAddresses,
  mergeInstances,
  probeTcp
} from '../discovery'
import type { OllamaInstance } from '../../shared/types'
import { startMockOllama } from '../../../scripts/mock-ollama'

describe('subnet math', () => {
  it('round-trips ip <-> int', () => {
    expect(intToIp(ipToInt('192.168.1.20'))).toBe('192.168.1.20')
    expect(ipToInt('0.0.0.0')).toBe(0)
    expect(intToIp(ipToInt('255.255.255.255'))).toBe('255.255.255.255')
  })

  it('rejects invalid IPs', () => {
    expect(() => ipToInt('999.1.1.1')).toThrow()
    expect(() => ipToInt('1.2.3')).toThrow()
  })

  it('enumerates a /24 without network or broadcast', () => {
    const hosts = hostsInSubnet('192.168.1.20', '255.255.255.0')
    expect(hosts).toHaveLength(254)
    expect(hosts[0]).toBe('192.168.1.1')
    expect(hosts[hosts.length - 1]).toBe('192.168.1.254')
    expect(hosts).not.toContain('192.168.1.0')
    expect(hosts).not.toContain('192.168.1.255')
  })

  it('caps oversized subnets to a /24', () => {
    // A /8 would be millions of hosts; we cap to the host /24 (254 usable).
    const hosts = hostsInSubnet('10.0.0.5', '255.0.0.0')
    expect(hosts).toHaveLength(254)
    expect(hosts[0]).toBe('10.0.0.1')
  })
})

describe('mergeInstances', () => {
  const mk = (id: string, source: OllamaInstance['source']): OllamaInstance => {
    const [host, port] = id.split(':')
    return { id, host, port: Number(port), baseUrl: `http://${id}`, online: true, models: [], source }
  }

  it('dedupes by id and never downgrades a manual source to scan', () => {
    const merged = mergeInstances([mk('1.1.1.1:11434', 'manual')], [mk('1.1.1.1:11434', 'scan')])
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe('manual')
  })

  it('adds new instances and sorts by id', () => {
    const merged = mergeInstances([mk('1.1.1.2:11434', 'scan')], [mk('1.1.1.1:11434', 'scan')])
    expect(merged.map((m) => m.id)).toEqual(['1.1.1.1:11434', '1.1.1.2:11434'])
  })
})

describe('dedupeSelf', () => {
  const mk = (host: string, port: number): OllamaInstance => ({
    id: `${host}:${port}`,
    host,
    port,
    baseUrl: `http://${host}:${port}`,
    online: true,
    models: [],
    source: 'scan'
  })

  it('collapses this machine seen at loopback + a local IP into one (prefers loopback)', () => {
    const localIp = [...localAddresses()].find((a) => a !== '127.0.0.1' && a !== 'localhost' && a !== '0.0.0.0')
    if (!localIp) return // no non-loopback IPv4 in this environment; nothing to collapse
    const out = dedupeSelf([mk(localIp, 11434), mk('127.0.0.1', 11434)])
    expect(out).toHaveLength(1)
    expect(out[0].host).toBe('127.0.0.1')
  })

  it('leaves genuinely different remote hosts alone', () => {
    const out = dedupeSelf([mk('10.9.9.9', 11434), mk('10.9.9.8', 11434)])
    expect(out).toHaveLength(2)
  })

  it('keeps different ports on the local machine separate', () => {
    const out = dedupeSelf([mk('127.0.0.1', 11434), mk('127.0.0.1', 11435)])
    expect(out).toHaveLength(2)
  })
})

describe('probe + inspect against a mock Ollama', () => {
  let server: Server
  const port = 21434

  beforeAll(async () => {
    server = await startMockOllama(port)
  })
  afterAll(() => {
    server.close()
  })

  it('TCP-probes the open port', async () => {
    expect(await probeTcp('127.0.0.1', port, 1000)).toBe(true)
  })

  it('reports a closed port as unreachable', async () => {
    expect(await probeTcp('127.0.0.1', 21999, 500)).toBe(false)
  })

  it('inspects the instance and reads its models', async () => {
    const inst = await inspectInstance('127.0.0.1', port, 'scan', 1000)
    expect(inst.online).toBe(true)
    expect(inst.version).toContain('mock')
    expect(inst.models.map((m) => m.name)).toContain('qwen2.5-coder:7b')
    expect(inst.models[0].parameterSize).toBeTruthy()
  })
})
