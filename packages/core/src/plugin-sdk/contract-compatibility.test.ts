import { describe, expect, test } from 'bun:test'
import {
  createPluginContractSnapshot,
  comparePluginContractSnapshots,
} from './contract-compatibility'
import type { GatekeeperPolicy, PluginManifest } from './types'
import { McpGatekeeper, type ExtendedGatekeeperPolicy } from '../security/gatekeeper'

function sampleManifest(parameters: Record<string, unknown>, gatekeeperPolicy?: ExtendedGatekeeperPolicy): PluginManifest {
  return {
    id: 'sample',
    name: 'Sample',
    version: '1.0.0',
    description: 'sample',
    icon: 'box',
    category: 'test',
    targets: ['web'],
    dependencies: [],
    tier: 'standard',
    industries: [],
    contracts: [],
    subscribes: [],
    publishes: [],
    navigation: {},
    schema: { ownedTables: [], externalReferences: {}, migrationOrder: 1 },
    api: { prefix: '/api/sample' },
    mcp: {
      tools: [
        {
          name: 'sample_write',
          description: 'write',
          parameters,
          handler: async () => ({}),
        },
      ],
    },
    agentCapabilities: {
      gatekeeperPolicies: {
        sample_write: gatekeeperPolicy ?? { riskLevel: 'medium', requireHumanApproval: true },
      },
    },
  } as any
}

describe('Plugin contract compatibility & AI Risk policy', () => {
  test('flags removed and newly-required input fields', () => {
    const previous = createPluginContractSnapshot(sampleManifest({ type: 'object', properties: { title: { type: 'string' } }, required: [] }))
    const current = createPluginContractSnapshot(sampleManifest({ type: 'object', properties: { title: { type: 'string' }, target: { type: 'string' } }, required: ['target'] }))
    const report = comparePluginContractSnapshots(previous, current)
    expect(report.compatible).toBe(false)
    expect(report.issues.some(issue => issue.kind === 'input-breaking' && issue.message.includes('new required input'))).toBe(true)
  })

  test('treats riskLevel policy changes as incompatible so old approvals cannot be reused', () => {
    const previous = createPluginContractSnapshot(sampleManifest({ type: 'object' }))
    const current = createPluginContractSnapshot(sampleManifest({ type: 'object' }, { riskLevel: 'critical', requireHumanApproval: true }))
    const report = comparePluginContractSnapshots(previous, current)
    expect(report.compatible).toBe(false)
    expect(report.issues[0]?.kind).toBe('policy-change')
  })

  test('detects policy change when aiRiskLevel changes from 1 to 3', () => {
    const previous = createPluginContractSnapshot(sampleManifest({ type: 'object' }, { aiRiskLevel: 1 }))
    const current = createPluginContractSnapshot(sampleManifest({ type: 'object' }, { aiRiskLevel: 3 }))

    expect(previous.tools[0].hash).not.toBe(current.tools[0].hash)
    const report = comparePluginContractSnapshots(previous, current)
    expect(report.compatible).toBe(false)
    expect(report.issues.some(issue => issue.kind === 'policy-change')).toBe(true)
  })
})


test('invalidates approvals when the AI tier changes despite identical stricter explicit policy', () => {
  const explicit = { riskLevel: 'critical', approvalLevel: 'L4_EXECUTIVE', requireHumanApproval: true }
  const previous = createPluginContractSnapshot(sampleManifest({ type: 'object' }, { ...explicit, aiRiskLevel: 2 }))
  const current = createPluginContractSnapshot(sampleManifest({ type: 'object' }, { ...explicit, aiRiskLevel: 3 }))
  expect(previous.tools[0].aiRiskLevel).toBe(2)
  expect(current.tools[0].aiRiskLevel).toBe(3)
  expect(current.tools[0].hash).not.toBe(previous.tools[0].hash)
  expect(current.hash).not.toBe(previous.hash)
  expect(comparePluginContractSnapshots(previous, current).issues.some(issue => issue.kind === 'policy-change')).toBe(true)
})

test('applies tier 3 minimums in captured policy', () => {
  const snapshot = createPluginContractSnapshot(sampleManifest({ type: 'object' }, { aiRiskLevel: 3, riskLevel: 'low', approvalLevel: 'L1_AUTO', requireHumanApproval: false }))
  expect(snapshot.tools[0]).toMatchObject({ riskLevel: 'critical', approvalLevel: 'L4_EXECUTIVE', requireHumanApproval: true })
})

test('rejects malformed AI tiers when capturing policy', () => {
  for (const aiRiskLevel of [0, 4, '3', null, NaN]) {
    expect(() => createPluginContractSnapshot(sampleManifest({ type: 'object' }, { aiRiskLevel }))).toThrow(/AI risk tier/)
  }
})


test('uses the same tier minimums and legacy defaults for snapshots and live evaluation', () => {
  const cases: Array<{ policy: ExtendedGatekeeperPolicy; riskLevel: string; approvalLevel: string; requireHumanApproval: boolean }> = [
    { policy: {}, riskLevel: 'low', approvalLevel: 'L1_AUTO', requireHumanApproval: false },
    { policy: { riskLevel: 'high', requireHumanApproval: false }, riskLevel: 'high', approvalLevel: 'L3_MANAGER', requireHumanApproval: false },
    { policy: { riskLevel: 'critical', approvalLevel: 'L1_AUTO' }, riskLevel: 'critical', approvalLevel: 'L1_AUTO', requireHumanApproval: false },
    { policy: { aiRiskLevel: 1 }, riskLevel: 'low', approvalLevel: 'L1_AUTO', requireHumanApproval: false },
    { policy: { aiRiskLevel: 2, riskLevel: 'low', approvalLevel: 'L1_AUTO', requireHumanApproval: false }, riskLevel: 'medium', approvalLevel: 'L2_LEAD', requireHumanApproval: true },
    { policy: { aiRiskLevel: 2, riskLevel: 'critical', approvalLevel: 'L4_EXECUTIVE', requireHumanApproval: true }, riskLevel: 'critical', approvalLevel: 'L4_EXECUTIVE', requireHumanApproval: true },
  ]
  for (const { policy, riskLevel, approvalLevel, requireHumanApproval } of cases) {
    const canonicalPolicy: GatekeeperPolicy = policy
    const gatekeeper = new McpGatekeeper()
    gatekeeper.registerPolicy('sample_write', { ...canonicalPolicy, ...policy })
    const expected = { riskLevel, approvalLevel, requireHumanApproval }
    expect(gatekeeper.validateCall({ toolName: 'sample_write', userRoles: [], tenantId: 'tenant' })).toMatchObject(expected)
    expect(createPluginContractSnapshot(sampleManifest({ type: 'object' }, policy)).tools[0]).toMatchObject(expected)
  }
})
