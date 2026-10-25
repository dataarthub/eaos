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


describe('McpGatekeeper AI policy minimums', () => {
  it('prevents explicit low policy from downgrading tier 3', () => {
    const gatekeeper = new McpGatekeeper()
    gatekeeper.registerPolicy('write', { aiRiskLevel: 3, riskLevel: 'low', approvalLevel: 'L1_AUTO', requireHumanApproval: false })
    expect(gatekeeper.validateCall({ toolName: 'write', userRoles: [], tenantId: 'tenant' })).toEqual({
      allowed: true, riskLevel: 'critical', approvalLevel: 'L4_EXECUTIVE', requireHumanApproval: true,
    })
  })

  it('rejects malformed AI tiers at registration', () => {
    for (const aiRiskLevel of [0, 4, '3', null, NaN]) {
      const gatekeeper = new McpGatekeeper()
      expect(() => gatekeeper.registerPolicy('write', { aiRiskLevel } as any)).toThrow(/AI risk tier/)
    }
  })

  it('rejects a malformed tier introduced by later policy mutation', () => {
    const gatekeeper = new McpGatekeeper()
    const policy = { aiRiskLevel: 2 as any }
    gatekeeper.registerPolicy('write', policy)
    policy.aiRiskLevel = 0
    expect(() => gatekeeper.validateCall({ toolName: 'write', userRoles: [], tenantId: 'tenant' })).toThrow(/AI risk tier/)
  })
})
