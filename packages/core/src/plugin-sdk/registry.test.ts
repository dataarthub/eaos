import { describe, it, expect } from 'bun:test'
import { PluginRegistry } from './registry'
import type { PluginManifest } from './types'

describe('PluginRegistry Help, Docs & Agent Skills', () => {
  it('registers and resolves help contexts correctly', () => {
    const registry = new PluginRegistry()
    const sampleManifest: PluginManifest = {
      id: 'crm',
      name: 'CRM',
      version: '1.0.0',
      description: 'CRM domain',
      icon: 'users',
      category: 'sales',
      targets: ['web'],
      dependencies: [],
      tier: 'standard',
      industries: ['all'],
      contracts: [],
      subscribes: [],
      publishes: [],
      navigation: { web: { label: 'CRM', icon: 'users', order: 10, children: [] } },
      schema: { ownedTables: [], externalReferences: {}, migrationOrder: 10 },
      api: { prefix: '/crm' },
      docs: {
        category: 'Sales & Marketing',
        specPath: './docs/spec.md',
        userGuidePath: './docs/user-guide.md',
        helpContexts: {
          'deals.pipeline': {
            title: '商談パイプラインの使い方',
            summary: 'パイプラインステージをドラッグ＆ドロップして進捗を更新します。',
            docAnchor: '#pipeline-stage-update'
          }
        }
      }
    }

    registry.register(sampleManifest)

    // Direct lookup
    const foundDirect = registry.getHelpContext('deals.pipeline')
    expect(foundDirect).toBeDefined()
    expect(foundDirect?.pluginId).toBe('crm')
    expect(foundDirect?.item.title).toBe('商談パイプラインの使い方')

    // Prefixed lookup
    const foundPrefixed = registry.getHelpContext('crm:deals.pipeline')
    expect(foundPrefixed).toBeDefined()
    expect(foundPrefixed?.item.title).toBe('商談パイプラインの使い方')

    // All help contexts
    const all = registry.getAllHelpContexts()
    expect(all.length).toBe(1)
    expect(all[0].contextKey).toBe('deals.pipeline')
  })

  it('collects runtime-discoverable skill metadata from plugins', () => {
    const registry = new PluginRegistry()
    const sampleManifest: PluginManifest = {
      id: 'milestones',
      name: 'Milestones',
      version: '1.0.0',
      description: 'Cross-system milestones',
      icon: 'workflow',
      category: 'operations',
      targets: ['web'],
      dependencies: [],
      tier: 'standard',
      industries: ['construction'],
      contracts: [],
      subscribes: [],
      publishes: [],
      navigation: { web: { label: 'Milestones', icon: 'workflow', order: 10, children: [] } },
      schema: { ownedTables: [], externalReferences: {}, migrationOrder: 10 },
      api: { prefix: '/milestones' },
      agentCapabilities: {
        skills: [{
          id: 'milestones.cross-system-status',
          name: 'Cross-system milestone status',
          description: 'Summarize milestone status across connected systems.',
          category: 'operations',
          capabilities: ['milestones.read'],
          actionNames: ['milestones.getStatus']
        }]
      }
    }

    registry.register(sampleManifest)

    expect(registry.getAllAgentSkills()).toEqual([{
      pluginId: 'milestones',
      skill: sampleManifest.agentCapabilities?.skills?.[0]
    }])

    expect(registry.getEligibleAgentSkills({ os: 'darwin', bins: ['eaos'] })).toHaveLength(1)
  })

  it('filters skills by host-provided runtime requirements', () => {
    const registry = new PluginRegistry()
    const manifest = { ...minimalManifest('ops'), agentCapabilities: { skills: [
      { id: 'ops.local', name: 'Local', description: 'Local', requirements: { bins: ['local-cli'] } },
      { id: 'ops.any', name: 'Any', description: 'Any', requirements: { anyBins: ['goose', 'opencode'] } },
    ] } }
    registry.register(manifest)

    expect(registry.getEligibleAgentSkills({ os: 'linux', bins: ['opencode'] }).map(item => item.skill.id)).toEqual(['ops.any'])
  })

  it('loads eligible Skill documents only through a host-provided loader', async () => {
    const registry = new PluginRegistry()
    const manifest = { ...minimalManifest('docs'), agentCapabilities: { skills: [
      { id: 'docs.safe', name: 'Safe', description: 'Safe', documentPath: 'skills/safe/SKILL.md' },
    ] } }
    registry.register(manifest)

    const loaded = await registry.getEligibleAgentSkillDocuments({ os: 'linux' }, {
      load: ({ pluginId, path }) => `# ${pluginId}\nloaded ${path}`
    })
    expect(loaded).toHaveLength(1)
    expect(loaded[0].content).toContain('loaded skills/safe/SKILL.md')

    const missingPathRegistry = new PluginRegistry()
    missingPathRegistry.register({ ...minimalManifest('missing'), agentCapabilities: { skills: [
      { id: 'missing.skill', name: 'Missing', description: 'Missing', documentPath: '../secret/SKILL.md' },
    ] } })
    await expect(missingPathRegistry.getEligibleAgentSkillDocuments({ os: 'linux' }, { load: () => '# unused' })).rejects.toThrow('missing:missing.skill')
  })
})

function minimalManifest(id: string): PluginManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: id,
    icon: 'box',
    category: 'test',
    targets: ['web'],
    dependencies: [],
    tier: 'free',
    industries: ['all'],
    contracts: [],
    subscribes: [],
    publishes: [],
    navigation: { web: { label: id, icon: 'box', order: 1, children: [] } },
    schema: { ownedTables: [], externalReferences: {}, migrationOrder: 1 },
    api: { prefix: `/${id}` },
  }
}
