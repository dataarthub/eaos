import { describe, expect, it } from 'bun:test'
import { McpGatekeeper } from './gatekeeper'

describe('McpGatekeeper audit delivery', () => {
  it('keeps a bounded local view and forwards immutable entries to a host sink', async () => {
    const entries: unknown[] = []
    const gatekeeper = new McpGatekeeper(undefined, { append: entry => entries.push(entry) })
    const entry = gatekeeper.logCall({ toolName: 'read_report', userId: 'user', tenantId: 'tenant', status: 'ALLOWED', riskLevel: 'low' })
    await Promise.resolve()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual(entry)
    expect(entry.previousHash).toBe('00000000000000000000000000000000')
  })

  it('rejects durable audit entries when the sink fails', async () => {
    const gatekeeper = new McpGatekeeper(undefined, { append: async () => { throw new Error('sink unavailable') } })
    await expect(gatekeeper.logCallDurably({ toolName: 'read_report', userId: 'user', tenantId: 'tenant', status: 'ALLOWED', riskLevel: 'low' })).rejects.toThrow('sink unavailable')
    expect(gatekeeper.getAuditLogs()).toHaveLength(0)
  })

  it('does not advance the durable hash chain when delivery is rejected', async () => {
    let fail = true
    const gatekeeper = new McpGatekeeper(undefined, { append: async () => { if (fail) throw new Error('offline') } })
    await expect(gatekeeper.logCallDurably({ toolName: 'read_report', userId: 'user', tenantId: 'tenant', status: 'ALLOWED', riskLevel: 'low' })).rejects.toThrow('offline')
    fail = false
    const entry = await gatekeeper.logCallDurably({ toolName: 'read_report', userId: 'user', tenantId: 'tenant', status: 'ALLOWED', riskLevel: 'low' })
    expect(entry.previousHash).toBe('00000000000000000000000000000000')
  })
})
