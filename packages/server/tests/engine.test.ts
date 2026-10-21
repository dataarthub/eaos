import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { PluginManifest } from '@alneas/eaos-core'
import { createErpEngine } from '../src/index'
const plugin = (id: string): PluginManifest => ({
 id, name: id, version: '1.0.0', description: '', icon: '', category: 'general',
 targets: ['web'], dependencies: [], tier: 'free', industries: [], contracts: [],
 subscribes: [], publishes: [], navigation: {},
 schema: { storagePolicy: { maxPayloadBytes: 4 * 1024 * 1024, objectStorage: 'optional', historyRetentionDays: null, archive: { mode: 'none' } }, ownedTables: [], externalReferences: {}, migrationOrder: 0 },
 api: { prefix: '/api/' + id },
 createRoutes: (options) => new Hono().get('/value', c => c.json({ value: options?.value })),
})
describe('independent application runtimes', () => {
 test('isolates shared and dedicated deployments and injects plugin dependencies', async () => {
  const shared = createErpEngine({ appName: 'shared', plugins: [plugin('notes')] })
  const dedicated = createErpEngine({ appName: 'dedicated', plugins: [plugin('notes'), plugin('extra')] })
  await shared.initialize(); await dedicated.initialize(); await shared.initialize()
  expect(shared.getRegisteredPlugins().map(p => p.id)).toEqual(['notes'])
  expect(dedicated.getRegisteredPlugins()).toHaveLength(2)
  const app = shared.createApp({ enableModuleGuard: false, pluginOptions: { notes: { value: 'injected' } } })
  expect(await (await app.request('/api/notes/value')).json()).toEqual({ value: 'injected' })
  expect((await app.request('/api/extra/value')).status).toBe(404)
  expect((await app.request('/health')).status).toBe(200)
 })
 test('empty apps do not need a DB or tenant', async () => {
  const engine = createErpEngine({ appName: 'empty', plugins: [] })
  await engine.initialize()
  expect((await engine.createApp().request('/health')).status).toBe(200)
 })
})
