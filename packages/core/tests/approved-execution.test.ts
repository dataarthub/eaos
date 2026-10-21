import { describe, expect, test } from 'bun:test'
import { approvalBindingMatches, comparePluginContractSnapshots, createApprovedExecutionEvent, createApprovalBinding, createPluginContractSnapshot, type PluginManifest } from '../src/index'

const contract = {
  operation: 'estate_voice_create',
  version: '1.0.0',
  permission: 'estate_voice_create',
  sideEffect: 'write' as const,
  riskLevel: 'medium' as const,
  approvalLevel: 'L2_LEAD' as const,
  inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
}

test('approval binding detects changed input, target revision and contract meaning', () => {
  const input = { title: 'Leak report' }
  const binding = createApprovalBinding({ tenantId: 'tenant-a', requestedBy: 'user-a', operation: contract.operation, target: { type: 'equipment', id: 'eq-1', revision: 4 }, input, contract })
  expect(approvalBindingMatches(binding, { tenantId: 'tenant-a', requestedBy: 'user-a', operation: contract.operation, target: { type: 'equipment', id: 'eq-1', revision: 4 }, input, contract })).toBe(true)
  expect(approvalBindingMatches(binding, { tenantId: 'tenant-a', requestedBy: 'user-a', operation: contract.operation, target: { type: 'equipment', id: 'eq-1', revision: 5 }, input, contract })).toBe(false)
  expect(approvalBindingMatches(binding, { tenantId: 'tenant-a', requestedBy: 'user-a', operation: contract.operation, target: { type: 'equipment', id: 'eq-1', revision: 4 }, input: { ...input, title: 'Changed' }, contract })).toBe(false)
  const event = createApprovedExecutionEvent({ binding, producer: 'estate-voice', topic: 'estate-voice.report.confirm', payload: input })
  expect(event.idempotencyKey).toBe(binding.bindingHash)
  expect(event.payload.binding.bindingHash).toBe(binding.bindingHash)
})

test('approval binding expiry is enforced when rehydrating an old approval', () => {
  const issuedAt = new Date('2026-09-21T00:00:00.000Z')
  const expiresAt = new Date('2026-09-21T00:05:00.000Z')
  const binding = createApprovalBinding({ tenantId: 'tenant-a', requestedBy: 'user-a', operation: contract.operation, input: { title: 'Leak report' }, contract, expiresAt }, { now: issuedAt })
  expect(approvalBindingMatches(binding, { tenantId: 'tenant-a', requestedBy: 'user-a', operation: contract.operation, input: { title: 'Leak report' }, contract, expiresAt }, { now: new Date('2026-09-21T00:04:59.000Z') })).toBe(true)
  expect(approvalBindingMatches(binding, { tenantId: 'tenant-a', requestedBy: 'user-a', operation: contract.operation, input: { title: 'Leak report' }, contract, expiresAt }, { now: new Date('2026-09-21T00:05:00.000Z') })).toBe(false)
})

function manifest(parameters: Record<string, unknown>, patch: Partial<PluginManifest['mcp']> = {}): PluginManifest {
  return {
    id: 'sample', name: 'Sample', version: '1.0.0', description: 'sample', icon: 'box', category: 'test', targets: ['web'], dependencies: [], tier: 'standard', industries: [], contracts: [], subscribes: [], publishes: [], navigation: {}, schema: { ownedTables: [], externalReferences: {}, migrationOrder: 1 }, api: { prefix: '/api/sample' }, mcp: { tools: [{ name: 'sample_write', description: 'write', parameters, handler: async () => ({}), ...patch?.tools?.[0] }] }, agentCapabilities: { gatekeeperPolicies: { sample_write: { riskLevel: 'medium', requireHumanApproval: true } } },
  }
}

describe('plugin contract compatibility', () => {
  test('flags removed and newly-required input fields', () => {
    const previous = createPluginContractSnapshot(manifest({ type: 'object', properties: { title: { type: 'string' } }, required: [] }))
    const current = createPluginContractSnapshot(manifest({ type: 'object', properties: { title: { type: 'string' }, target: { type: 'string' } }, required: ['target'] }))
    const report = comparePluginContractSnapshots(previous, current)
    expect(report.compatible).toBe(false)
    expect(report.issues.some(issue => issue.kind === 'input-breaking' && issue.message.includes('new required input'))).toBe(true)
  })

  test('treats policy changes as incompatible so old approvals cannot be reused', () => {
    const previous = createPluginContractSnapshot(manifest({ type: 'object' }))
    const current = createPluginContractSnapshot({ ...manifest({ type: 'object' }), agentCapabilities: { gatekeeperPolicies: { sample_write: { riskLevel: 'critical', requireHumanApproval: true } } } })
    const report = comparePluginContractSnapshots(previous, current)
    expect(report.compatible).toBe(false)
    expect(report.issues[0]?.kind).toBe('policy-change')
  })
})
