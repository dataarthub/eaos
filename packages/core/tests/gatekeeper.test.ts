import { describe, it, expect, beforeEach } from 'bun:test'
import { McpGatekeeper } from '../src/security/gatekeeper'

describe('McpGatekeeper Security Policy & Audit Logging', () => {
  let gatekeeper: McpGatekeeper

  beforeEach(() => {
    gatekeeper = new McpGatekeeper()
  })

  it('should allow tool execution by default when no policy is registered', () => {
    const result = gatekeeper.validateCall({
      toolName: 'crm_get_leads',
      userRoles: ['USER'],
      tenantId: 'tenant-123',
    })
    expect(result.allowed).toBe(true)
    expect(result.riskLevel).toBe('low')
    expect(result.requireHumanApproval).toBe(false)
  })

  it('should block execution if user lacks required role', () => {
    gatekeeper.registerPolicy('accounting_post_journal', {
      requiredRole: 'ACCOUNTANT_ADMIN',
      riskLevel: 'high',
    })

    const result = gatekeeper.validateCall({
      toolName: 'accounting_post_journal',
      userRoles: ['SALES_REP'],
      tenantId: 'tenant-123',
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('ACCOUNTANT_ADMIN')
  })

  it('should flag human approval required for high-risk operations', () => {
    gatekeeper.registerPolicy('accounting_post_journal', {
      requiredRole: 'ACCOUNTANT_ADMIN',
      riskLevel: 'high',
      requireHumanApproval: true,
    })

    const result = gatekeeper.validateCall({
      toolName: 'accounting_post_journal',
      userRoles: ['ACCOUNTANT_ADMIN'],
      tenantId: 'tenant-123',
    })

    expect(result.allowed).toBe(true)
    expect(result.requireHumanApproval).toBe(true)
    expect(result.riskLevel).toBe('high')
  })

  it('should record audit log entries properly', () => {
    const entry = gatekeeper.logCall({
      toolName: 'crm_get_leads',
      userId: 'user-1',
      tenantId: 'tenant-123',
      status: 'ALLOWED',
      riskLevel: 'low',
    })

    expect(entry.id).toBeDefined()
    expect(entry.timestamp).toBeDefined()
    expect(gatekeeper.getAuditLogs('tenant-123').length).toBe(1)
  })
})
