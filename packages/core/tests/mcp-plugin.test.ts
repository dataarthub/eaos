import { describe, it, expect, beforeEach } from 'bun:test'
import { PluginRegistry } from '../src/plugin-sdk/registry'
import type { PluginManifest } from '../src/plugin-sdk/types'

describe('PluginRegistry MCP Tools Dynamic Autoloading', () => {
  let registry: PluginRegistry

  beforeEach(() => {
    registry = new PluginRegistry()
  })

  it('registers and retrieves self-contained MCP tools from plugin manifests', () => {
    const mockPlugin: PluginManifest = {
      id: 'test-plugin',
      name: 'テストプラグイン',
      version: '1.0.0',
      description: 'テスト用プラグイン',
      icon: 'box',
      category: 'general',
      targets: ['web'],
      dependencies: [],
      tier: 'standard',
      industries: [],
      contracts: [],
      subscribes: [],
      publishes: [],
      navigation: {},
      schema: { storagePolicy: { maxPayloadBytes: 4 * 1024 * 1024, objectStorage: 'optional', historyRetentionDays: null, archive: { mode: 'none' } }, ownedTables: [], externalReferences: {}, migrationOrder: 100 },
      api: { prefix: '/api/v1/test' },
      mcp: {
        tools: [
          {
            name: 'test_custom_tool',
            description: 'MCP Test Tool',
            parameters: { type: 'object' },
            handler: async (args: any) => ({ success: true, args })
          }
        ]
      }
    }

    registry.register(mockPlugin)

    const allTools = registry.getAllMcpTools()
    expect(allTools.length).toBe(1)
    expect(allTools[0].name).toBe('test_custom_tool')

    const foundTool = registry.getMcpTool('test_custom_tool')
    expect(foundTool).toBeDefined()
    expect(foundTool?.description).toBe('MCP Test Tool')
  })
})
