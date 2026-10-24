import { describe, expect, test } from 'bun:test'
import {
  createPluginContractSnapshot,
  comparePluginContractSnapshots,
} from './contract-compatibility'
import type { PluginManifest } from './types'

function sampleManifest(parameters: Record<string, unknown>, gatekeeperPolicy?: any): PluginManifest {
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
