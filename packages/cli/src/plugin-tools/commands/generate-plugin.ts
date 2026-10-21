import { assertPluginEntitlement, type PluginEntitlement } from '@alneas/eaos-core'
import { syncAgentsMd } from './sync-agents-md'
import { frameworkVersion } from '../../version'
import fs from 'node:fs'
import path from 'node:path'
import { type CommandOptions, assertPluginId, pascalCase } from '../utils'

/**
 * Write a new plugin scaffold with explicit tier and host-owned implementation placeholders.
 * @param root - Trusted workspace root for the generated plugin directory.
 * @param options - Plugin name/description/tier and optional output/addon/quota/tenant selections.
 * @returns Resolves without a value after writing scaffold files.
 * @throws Rejects invalid identifiers/tier/quota/allowlists, unsafe or existing destinations and filesystem failures.
 * @remarks Writes source drafts, metadata, guides and inventory declarations. Generated handlers require real host bindings; generation never proves persistence, enables tenants or applies infrastructure.
 * @example
 * import { generatePlugin } from '@alneas/eaos-cli/plugin-tools'
 * export function scaffoldNotes(root: string) { return generatePlugin(root, { name: 'notes', tier: 'public' }) }
 */
export async function generatePlugin(root: string, options: CommandOptions): Promise<void> {
  if (options.check) throw new Error('generate does not support --check')
  const output = options.output ?? (options.name ? `plugins/${options.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '')
  if (!output) throw new Error('--name or --output is required')
  const dir = path.resolve(root, output)
  const id = path.basename(dir)
  assertPluginId(id)
  if (dir !== path.resolve(root, 'plugins', id)) throw new Error('Output must be plugins/<plugin-id> inside the project')
  const pluginsDir = path.resolve(root, 'plugins')
  if (fs.existsSync(pluginsDir) && fs.lstatSync(pluginsDir).isSymbolicLink()) throw new Error('Plugin symlinks are not supported')
  if (fs.existsSync(dir)) throw new Error(`Target already exists: ${dir}`)
  const name = options.name ?? id
  const description = options.description ?? name
  const title = pascalCase(id)
  const requestedTier = options.tier ?? 'public'
  const tier = requestedTier === 'free' ? 'public' : requestedTier === 'premium' ? 'pro' : requestedTier
  if (!['public', 'standard', 'pro', 'corporate'].includes(tier)) throw new Error('Invalid tier')
  const quota = options.monthlyQuota === undefined ? 0 : Number(options.monthlyQuota)
  if (!Number.isSafeInteger(quota) || quota < 0) throw new Error('Monthly quota must be a nonnegative integer')
  const entitlement: PluginEntitlement = tier === 'pro'
    ? { tier: 'pro', addonId: options.addonId ?? 'addon-' + id, metering: { unit: 'request', defaultMonthlyQuota: quota } }
    : tier === 'corporate' ? { tier: 'corporate', allowedTenants: options.allowedTenants?.split(',').map(id => id.trim()) ?? [] }
    : { tier: tier as 'public' | 'standard' }
  if (tier !== 'pro' && (options.addonId !== undefined || options.monthlyQuota !== undefined)) throw new Error('Add-on and quota options require Pro')
  if (tier !== 'corporate' && options.allowedTenants !== undefined) throw new Error('Tenant locks require Corporate')
  assertPluginEntitlement(entitlement)
  const packageName = tier === 'public' ? `@alneas/eaos-plugin-${id}` : tier === 'pro' ? `@dataarthub/pro-${id}` : tier === 'corporate' ? id : `@dataarthub/plugin-${id}`
  const q = JSON.stringify
  function write(file: string, content: string) {
    const target = path.join(dir, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  write('manifest.ts', `import type { PluginManifest } from '@alneas/eaos-core/plugin-sdk'
import { tools } from './src/mcp/tools'
import { createRoutes } from './src/api/routes'
export const manifest: PluginManifest = {
 id: ${q(id)}, name: ${q(name)}, version: '0.1.0', description: ${q(description)}, icon: 'box', category: 'general',
 targets: ['web'], dependencies: [], tier: ${q(tier)}, entitlement: ${q(entitlement)}, industries: ${q(options.industry ? [options.industry] : [])},
 contracts: [${q(`I${title}Service`)}], subscribes: [], publishes: [], navigation: {},
 schema: { storagePolicy: { maxPayloadBytes: 4 * 1024 * 1024, objectStorage: 'optional', historyRetentionDays: null, archive: { mode: 'none' } }, ownedTables: [], externalReferences: {}, migrationOrder: 900 },
 api: { prefix: ${q(`/api/v1/${id}`)} }, createRoutes,
 mcp: { tools },
 agentCapabilities: { gatekeeperPolicies: { ${q(id+'_get_data')}: { requiredRole: 'USER', riskLevel: 'low' } } },
 docs: { category: 'general', userGuidePath: 'docs/user-guide.md', maintainerGuidePath: 'docs/maintainer-guide.md', helpContexts: {} },
}
`)
  write('package.json', JSON.stringify({ name: packageName, license: tier === 'public' ? 'MIT' : 'UNLICENSED', ...(tier === 'corporate' ? { private: true } : { publishConfig: { registry: tier === 'public' ? 'https://registry.npmjs.org' : 'https://npm.pkg.github.com', access: tier === 'public' ? 'public' : 'restricted' } }), version: '0.1.0', type: 'module',
    exports: { '.': './index.ts', './manifest': './manifest.ts' }, files: ['index.ts', 'manifest.ts', 'src', 'docs', 'README.md', 'AGENTS.md', 'deployment.json'],
    peerDependencies: { '@alneas/eaos-core': frameworkVersion, hono: '^4.0.0', react: '^19.0.0' },
  }, null, 2)+'\n')
  const components = [
    { id: 'api', kind: 'api', placement: 'host', runtime: 'bun/hono', assetPatterns: ['src/api/routes.ts'] },
    { id: 'mcp', kind: 'mcp', placement: 'host', runtime: 'eaos/mcp', assetPatterns: ['src/mcp/tools.ts'] },
    { id: 'frontend', kind: 'frontend', placement: 'host', runtime: 'react', assetPatterns: ['src/routes/index.tsx'] },
  ]
  const componentIds = components.map(component => component.id)
  write('deployment.json', JSON.stringify({ apiVersion: 1, owner: packageName, version: '0.1.0', lifecycleBundle: [id], functions: [], assets: [], plugins: [{ id, components, tasks: [
    { id: 'verify-package', componentIds, action: 'verify', scope: 'artifact', required: true, dependsOn: [], executor: 'host:package-validation', instructions: 'Choose the public build/exports and package source selectors with checksums before recording completion.' },
    { id: 'deploy', componentIds, action: 'deploy', scope: 'environment', required: true, dependsOn: ['verify-package'], executor: 'platform:deploy' },
    { id: 'acceptance', componentIds, action: 'verify', scope: 'tenant', required: true, dependsOn: ['deploy'], executor: 'host:plugin-acceptance' },
  ] }] }, null, 2) + '\n')
  write('index.ts', "export * from './manifest'\nexport * from './src/contracts'\n")
  write('src/contracts/index.ts', `export interface I${title}Service { getData(id: string, tenantId: string): Promise<{ id: string; tenantId: string }> }\n`)
  write('src/services/service.ts', `import type { I${title}Service } from '../contracts'
export class ${title}Service implements I${title}Service {
 async getData(id: string, tenantId: string): Promise<{ id: string; tenantId: string }> { return { id, tenantId } }
}
`)
  write('src/mcp/tools.ts', `import type { McpToolDefinition } from '@alneas/eaos-core/plugin-sdk'
import { ${title}Service } from '../services/service'
export const tools: McpToolDefinition[] = [{
 name: ${q(id+'_get_data')}, description: ${q('Read the stateless '+name+' sample')},
 contract: { version: '1.0.0', permission: ${q(id+'_get_data')}, sideEffect: 'read', outputSchema: { type: 'object', properties: { id: { type: 'string' }, tenantId: { type: 'string' } }, required: ['id', 'tenantId'], additionalProperties: false } },
 parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
 handler: async (args, context) => {
  if (!context?.tenantId) throw new Error('Authenticated tenant context required')
  return new ${title}Service().getData(args.id, context.tenantId)
 },
}]
`)
  write('src/api/routes.ts', `import { Hono } from 'hono'
export function createRoutes() { return new Hono().get('/ping', c => c.json({ plugin: ${q(id)} })) }
`)
  write('src/routes/index.tsx', `import React from 'react'\nexport default function PluginPage() { return <section><h1>{${q(name)}}</h1></section> }\n`)
  write('src/db/schema.json', JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `urn:eaos:${id}`, $defs: {} }, null, 2)+'\n')
  write('README.md', `# ${name}\n\n${description}\n\nStateless sample. Register its manifest in the consuming application.\n`)
  write('AGENTS.md', `# ${name}\n\nKeep domain code in this plugin. Declare schema ownership and versioned migrations before adding persistence.\n`)
  write('docs/user-guide.md', `# ${name}\n\nThe sample echoes an item ID in the authenticated tenant context. It does not save records.\n`)
  write('docs/maintainer-guide.md', '# Development\n\nUse the framework MCP router with an authenticated principal resolver. The sample requires role USER. There are no owned tables or migrations yet.\n')
  await syncAgentsMd(path.dirname(path.dirname(dir)), { plugin: id })
  console.log(`Generated ${id}: ${dir}`)
}
