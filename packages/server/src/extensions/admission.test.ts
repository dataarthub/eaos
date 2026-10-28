import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { PluginManifest } from '@alneas/eaos-core'
import { createHostManifestCatalog, createHostModulePolicy, createPluginAuthorizationMiddleware, resolveClientPlugins } from './admission'
import { getPlatformPluginAuthorization } from './index'

const manifest = (id: string) => ({ id, name: id, version: '1.0.0', navigation: { web: { label: id } } }) as PluginManifest

test('catalog rejects conflicting identities and exposes executable bindings only when supplied', async () => {
  const item = { ...manifest('example'), mcp: { tools: [{ name: 'example_read', handler: async () => 'unbound' }] } } as unknown as PluginManifest
  expect(() => createHostManifestCatalog({ manifests: [item, item] })).toThrow('Duplicate')
  expect(() => createHostManifestCatalog({ manifests: [item], routeFactories: { other: () => new Hono() } })).toThrow('Unknown')
  expect(createHostManifestCatalog({ manifests: [item] })[0].mcp).toBeUndefined()
  const bound = createHostManifestCatalog({ manifests: [item], mcpPluginIds: ['example'], routeFactories: { example: () => new Hono() } })[0]
  await expect(bound.mcp!.tools[0].handler({}, {} as never)).rejects.toThrow('Bound MCP host unavailable')
})

test('module policy denies absent tenant and activation unless the host explicitly enables a bypass', async () => {
  const policy = createHostModulePolicy({ manifests: [manifest('example')], loadEnabledModules: async () => [] })
  const app = new Hono()
  app.use('*', policy.entitlementMiddleware)
  app.use('*', policy.requireModule('example'))
  app.get('/', c => c.text('allowed'))
  expect((await app.request('/')).status).toBe(403)
  const bypass = createHostModulePolicy({ manifests: [], loadEnabledModules: async () => [], bypass: () => true })
  const local = new Hono().use('*', bypass.requireModule('example')).get('/', c => c.text('allowed'))
  expect((await local.request('/')).status).toBe(200)
})

test('module aliases map current licensing and prefix restrictions match complete path segments', async () => {
  const policy = createHostModulePolicy({ manifests: [manifest('example')], moduleAliases: { example: ['legacy'] }, routePrefixes: { example: ['/private/example'] }, loadEnabledModules: async () => ['legacy'] })
  expect(policy.enabledPluginIds(['legacy'])).toEqual(['example'])
  const app = new Hono<{ Variables: { tenantId: string } }>()
  app.use('*', async (c, next) => { c.set('tenantId', 'tenant'); await next() })
  app.use('*', policy.entitlementMiddleware)
  app.use('*', policy.requireModule('example'))
  app.get('*', c => c.text('allowed'))
  expect((await app.request('/private/example')).status).toBe(200)
  const denied = createHostModulePolicy({ manifests: [], routePrefixes: { example: ['/private/example'] }, loadEnabledModules: async () => [] })
  const other = new Hono().use('*', denied.requireModule('example')).get('*', c => c.text('unrelated'))
  expect((await other.request('/private/example-other')).status).toBe(200)
  expect((await other.request('/private/example/nested')).status).toBe(403)
})

test('request authorization rechecks membership and lifecycle after a principal was previously resolved', async () => {
  let member = true, active = true
  const app = new Hono<{ Variables: Record<string, unknown> }>()
  app.use('*', async (c, next) => { c.set('tenantId', 'tenant'); c.set('userId', 'user'); c.set('workspaceContext', { email: null }); await next() })
  app.use('*', createPluginAuthorizationMiddleware({ store: () => ({ readTenant: async () => ({ tenantName: 'Tenant' }), readMembership: async () => member ? { role: 'member' } : undefined }), enabledPluginIds: async () => ['example'], isEnabled: async () => active }))
  app.get('/', async c => {
    const port = getPlatformPluginAuthorization(c)!
    expect(await port.resolvePrincipal()).toMatchObject({ tenantId: 'tenant', userId: 'user', enabledPluginIds: ['example'] })
    expect(await port.isPluginEnabled('foreign', 'example')).toBe(false)
    active = false
    expect(await port.isPluginEnabled('tenant', 'example')).toBe(false)
    member = false
    expect(await port.resolvePrincipal()).toBeNull()
    return c.text('checked')
  })
  expect((await app.request('/')).status).toBe(200)
})

test('client availability excludes wrong extension tenant and disabled features without leaking executable handlers', async () => {
  const visible = { ...manifest('visible'), createRoutes: () => new Hono() }
  const options = { tenantId: 'tenant', enabledPluginIds: ['visible', 'private', 'disabled'], manifests: [visible, manifest('private'), manifest('disabled')], extensions: [{ apiVersion: 1 as const, id: 'extension', tenantIds: ['foreign'], manifests: [manifest('private')] }], isEnabled: async (_tenant: string, id: string) => id !== 'disabled' }
  const result = await resolveClientPlugins(options)
  expect(result.map(item => item.id)).toEqual(['visible'])
  expect(result[0]).not.toHaveProperty('createRoutes')
  expect(result[0].navigation).toEqual(visible.navigation)
})
