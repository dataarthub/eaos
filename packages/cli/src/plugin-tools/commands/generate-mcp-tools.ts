import fs from 'node:fs'
import path from 'node:path'
import { CommandOptions, findPluginDir, pascalCase, writeDraft } from '../utils'

/**
 * Scan source service methods and write a deliberately unbound MCP tool draft.
 * @param workspaceRoot - Trusted workspace containing the plugin.
 * @param options - plugin is required; check compares the draft and write permits replacement.
 * @returns Resolves without a value; a missing services directory is reported and skipped.
 * @throws Rejects missing plugin selection, invalid paths or draft/filesystem errors.
 * @remarks Uses source-pattern heuristics, not semantic method validation. Generated handlers throw until connected to real domain services; no tool is registered or executed.
 * @example
 * import { generateMcpTools } from '@alneas/eaos-cli/plugin-tools'
 * export async function checkTools(root: string) { await generateMcpTools(root, { plugin: 'notes', check: true }) }
 */
export async function generateMcpTools(workspaceRoot: string, options: CommandOptions): Promise<void> {
  const pluginId = options.plugin
  if (!pluginId) {
    throw new Error('--plugin <plugin-id> is required for generate-mcp-tools')
  }

  const pluginDir = findPluginDir(workspaceRoot, pluginId)
  const servicesDir = path.join(pluginDir, 'src', 'services')
  const mcpToolsPath = path.join(pluginDir, 'src', 'mcp', 'tools.generated.ts')

  if (!fs.existsSync(servicesDir)) {
    console.log(`ℹ️ [generate-mcp-tools] No src/services directory found in plugin '${pluginId}'. Skipping.`)
    return
  }

  const discoveredTools: { name: string; description: string; riskLevel: string; method: string }[] = []

  const files = fs.readdirSync(servicesDir).filter((f) => f.endsWith('.ts'))
  for (const file of files) {
    const filePath = path.join(servicesDir, file)
    const content = fs.readFileSync(filePath, 'utf-8')
    const methodMatches = content.matchAll(/async\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g)
    for (const m of methodMatches) {
      const methodName = m[1]
      if (methodName.startsWith('_')) continue

      const snakeMethod = methodName.replace(/([A-Z])/g, '_$1').toLowerCase()
      const toolName = `${pluginId}_${snakeMethod}`
      const isWrite = methodName.startsWith('create') || methodName.startsWith('update') || methodName.startsWith('delete')
      const isDelete = methodName.startsWith('delete') || methodName.startsWith('remove')

      discoveredTools.push({
        name: toolName,
        description: `${pluginId.toUpperCase()} service operation: ${methodName}`,
        riskLevel: isDelete ? 'high' : isWrite ? 'medium' : 'low',
        method: methodName
      })
    }
  }

  const toolDefinitionsCode = `import type { McpToolDefinition } from '@alneas/eaos-core'

export const ${pascalCase(pluginId)}McpTools: McpToolDefinition[] = [
${discoveredTools
  .map(
    (t) => `  {
    name: '${t.name}',
    description: '${t.description}',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Target entity ID' }
      }
    },
    handler: async (args: any) => {
      // Delegated to plugin domain service
      throw new Error('Connect this generated draft to the domain service before registering it')
    }
  }`
  )
  .join(',\n')}
]
`

  const mcpDir = path.dirname(mcpToolsPath)
  if (!fs.existsSync(mcpDir)) {
    fs.mkdirSync(mcpDir, { recursive: true })
  }

  writeDraft(mcpToolsPath, toolDefinitionsCode, options)
  console.log(`✨ [generate-mcp-tools] Generated ${discoveredTools.length} MCP tool definition(s) at ${mcpToolsPath}`)
}
