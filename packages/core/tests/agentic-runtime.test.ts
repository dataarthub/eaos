import { describe, it, expect, vi } from 'bun:test'
import { AgentRuntime } from '../src/agentic/runtime'
import { McpGatekeeper } from '../src/security/gatekeeper'
import { InstinctEngine } from '../src/agentic/instinct-engine'

describe('Agentic Core Engine Tests', () => {
  const mockContext = {
    tenantId: 'tenant_123',
    userId: 'user_456',
    sessionId: 'session_789',
    traceId: 'trace_001',
    userRoles: ['member'],
  }

  describe('AgentRuntime & Hooks', () => {
    it('blocks tools containing plaintext AWS secrets in PreTool hook', async () => {
      const runtime = new AgentRuntime()
      const executor = vi.fn().mockResolvedValue({ success: true })

      const result = await runtime.executeTool(
        'deploy_cloud',
        { apiKey: 'AKIAIOSFODNN7EXAMPLE' },
        mockContext,
        executor
      )

      expect(result.success).toBe(false)
      expect(result.status).toBe('BLOCKED')
      expect(result.riskLevel).toBe('critical')
      expect(executor).not.toHaveBeenCalled()
    })

    it('executes tool and runs PostTool hook when validation passes', async () => {
      const runtime = new AgentRuntime()
      const postHook = vi.fn()
      runtime.registerPostToolHook(postHook)

      const executor = vi.fn().mockResolvedValue({ status: 'ok' })

      const result = await runtime.executeTool(
        'fetch_data',
        { query: 'sales_2026' },
        mockContext,
        executor
      )

      expect(result.success).toBe(true)
      expect(result.status).toBe('COMPLETED')
      expect(executor).toHaveBeenCalledWith({ query: 'sales_2026' })
    })
  })

  describe('McpGatekeeper (L1-L4 Approval & Audit Trail)', () => {
    it('enforces L4_EXECUTIVE approval for critical risk tools', () => {
      const gatekeeper = new McpGatekeeper()
      gatekeeper.registerPolicy('bank_transfer', {
        riskLevel: 'critical',
      })

      const validation = gatekeeper.validateCall({
        toolName: 'bank_transfer',
        tenantId: 'tenant_123',
        userRoles: ['member'],
      })

      expect(validation.allowed).toBe(true)
      expect(validation.requireHumanApproval).toBe(true)
      expect(validation.approvalLevel).toBe('L4_EXECUTIVE')
    })

    it('creates tamper-proof hash-chained audit logs', async () => {
      const gatekeeper = new McpGatekeeper()
      const log1 = await gatekeeper.logCall({
        toolName: 'read_doc',
        userId: 'user_1',
        tenantId: 'tenant_1',
        status: 'ALLOWED',
        riskLevel: 'low',
      })

      const log2 = await gatekeeper.logCall({
        toolName: 'update_price',
        userId: 'user_1',
        tenantId: 'tenant_1',
        status: 'PENDING_APPROVAL',
        riskLevel: 'high',
      })

      expect(log1.hash).toBeDefined()
      expect(log2.previousHash).toBe(log1.hash)
      expect(log2.approvalLevel).toBe('L3_MANAGER')
    })
  })

  describe('InstinctEngine Continuous Learning', () => {
    it('extracts instincts on successful session completion', async () => {
      const engine = new InstinctEngine()
      const instinct = await engine.extractInstinctsFromSession({
        tenantId: 'tenant_1',
        domain: 'repair',
        history: [
          { role: 'user', content: 'Fix air conditioner' },
          { role: 'assistant', content: 'Dispatched crew A' },
        ],
        success: true,
      })

      expect(instinct).not.toBeNull()
      expect(instinct?.domain).toBe('repair')
      expect(instinct?.confidence).toBeGreaterThan(0.8)
    })
  })
})

import { SkillGateBridge } from '../src/agentic/skill-gate-bridge'

describe('SkillGateBridge Integration', () => {
  it('evaluates skill gate and delegates to McpGatekeeper', async () => {
    const gatekeeper = new McpGatekeeper()
    const runtime = new AgentRuntime()
    const bridge = new SkillGateBridge(gatekeeper, runtime)

    bridge.registerSkillGate({
      skillName: 'hotel_ota_pricing_update',
      version: '1.0.0',
      category: 'domain/hotel',
      riskLevel: 'high',
      approvalLevel: 'L3_MANAGER',
      whenToActivate: ['price change'],
    })

    const result = await bridge.evaluateAndExecuteSkill(
      'hotel_ota_pricing_update',
      { newRate: 15000 },
      {
        tenantId: 'tenant_1',
        userId: 'user_1',
        sessionId: 'sess_1',
        traceId: 'trace_1',
        userRoles: ['member'],
      },
      async () => ({ updated: true })
    )

    expect(result.status).toBe('PENDING_APPROVAL')
    expect(result.approvalLevel).toBe('L3_MANAGER')
  })
})
