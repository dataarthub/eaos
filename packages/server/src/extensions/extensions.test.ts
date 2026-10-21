import { describe, expect, test } from 'bun:test'
import { Hono, type Context } from 'hono'
import { scopeExtensionRoutes, validateExtensions, mountExtensionRoutes, type PlatformExtension } from './index'

const extension: PlatformExtension = {
  apiVersion: 1, id: 'product-a', tenantIds: ['tenant-a'], userContext: async () => ({}),
  routes: [{ prefix: '/private', moduleId: 'crm', router: new Hono().get('/record', (c: Context) => c.json({ tenant: c.get('tenantId') })) }],
}

describe('platform extension isolation', () => {
  test('rejects wildcard tenants, duplicate tenant overrides and official factory overrides', () => {
    expect(() => validateExtensions([{ ...extension, tenantIds: ['*'] }])).toThrow()
    expect(() => validateExtensions([extension, { ...extension, id: 'product-b' }])).toThrow('Conflicting extension tenant')
    expect(() => validateExtensions([{ ...extension, routeFactories: { crm: () => new Hono() } }])).toThrow('cannot override')
  })
  test('rejects another tenant even when it has the required module', async () => {
    const app = new Hono()
    app.use('*', async (c: Context, next) => { c.set('tenantId', c.req.header('X-Test-Tenant')); return next() })
    for (const route of scopeExtensionRoutes(extension, () => async (_, next) => next())) app.route(route.prefix, route.router)
    expect((await app.request('/private/record', { headers: { 'X-Test-Tenant': 'tenant-a' } })).status).toBe(200)
    expect((await app.request('/private/record', { headers: { 'X-Test-Tenant': 'tenant-b' } })).status).toBe(403)
    expect((await app.request('/private/record')).status).toBe(403)
  })
  test('enforces module admission for the owning tenant', async () => {
    const app = new Hono()
    app.use('*', async (c: Context, next) => { c.set('tenantId', 'tenant-a'); return next() })
    for (const route of scopeExtensionRoutes(extension, () => async c => c.json({ error: 'disabled' }, 403))) app.route(route.prefix, route.router)
    expect((await app.request('/private/record')).status).toBe(403)
  })
})


test('multiple corporate packages can share one API prefix across distinct tenants', async () => {
  const second = { ...extension, id: 'product-b', tenantIds: ['tenant-b'] }
  const app = new Hono()
  app.use('*', async (c: Context, next) => { c.set('tenantId', c.req.header('X-Test-Tenant')); return next() })
  mountExtensionRoutes(app, validateExtensions([extension, second]), () => async (_, next) => next())
  for (const tenant of ['tenant-a', 'tenant-b']) {
    const response = await app.request('/private/record', { headers: { 'X-Test-Tenant': tenant } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ tenant })
  }
  expect((await app.request('/private/record', { headers: { 'X-Test-Tenant': 'other' } })).status).toBe(403)
})
