import { describe, test, expect } from 'bun:test'
import { createErpEngine, type McpPrincipal } from '../src/index'
import type { PluginManifest } from '@alneas/eaos-core'
const base = (id: string): PluginManifest => ({ id, name: id, version: '1.0.0', description: '', icon: '', category: '', targets: [], dependencies: [], tier: 'free', industries: [], contracts: [], subscribes: [], publishes: [], navigation: {}, schema: { storagePolicy: { maxPayloadBytes: 4 * 1024 * 1024, objectStorage: 'optional', historyRetentionDays: null, archive: { mode: 'none' } }, ownedTables: [], externalReferences: {}, migrationOrder: 0 }, api: { prefix: '/'+id } })
async function setup(withAIHostAdapters = false) {
 let calls = 0
 let resolvedAIContext: unknown
 let principal: McpPrincipal | null = { userId: 'u1', tenantId: 'tenant-a', roles: ['USER'], enabledPluginIds: ['notes'] }
 const notes = base('notes')
 notes.mcp = { tools: ['read', 'privileged', 'approval'].map(name => ({ name, description: name,
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  handler: async (args, context) => { calls++; return { id: args.id, tenantId: context.tenantId, userId: context.userId, hasAIHostAdapters: Boolean(context.aiHostAdapters) } },
 })) }
 notes.agentCapabilities = { gatekeeperPolicies: { privileged: { requiredRole: 'EDITOR' }, approval: { riskLevel: 'high' } } }
 const engine = createErpEngine({ appName: 'mcp-test', plugins: [notes] })
 await engine.initialize()
 const app = engine.createApp({ mcp: { tenantId: 'tenant-a', resolvePrincipal: async () => principal,
  createToolContext: async () => ({ tenantId: 'forged-dependency', userId: 'forged' }),
  ...(withAIHostAdapters ? { resolveAIHostAdapters: async (input) => { resolvedAIContext = input; return { calendar: { id: 'calendar-host', capabilities: ['calendar.read'] } as any } } } : {}) } })
 const execute = (body: unknown) => app.request('/api/mcp/execute', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': 'tenant-b' }, body: JSON.stringify(body) })
 return { app, engine, execute, calls: () => calls, resolvedAIContext: () => resolvedAIContext, setPrincipal: (p: McpPrincipal | null) => { principal=p } }
}
describe('authenticated plugin tool HTTP API', () => {
 test('denies anonymous discovery and execution', async () => {
  const s=await setup();s.setPrincipal(null)
  expect((await s.app.request('/api/mcp/tools')).status).toBe(401)
  expect((await s.execute({ name:'read',args:{id:'1'} })).status).toBe(401)
  expect(s.calls()).toBe(0)
 })
 test('filters tools by role; blocks handlers awaiting approval', async () => {
  const s=await setup()
  const listing=await (await s.app.request('/api/mcp/tools')).json()
  expect(listing.tools.map((t:any)=>t.name)).toEqual(['read','approval'])
  expect((await s.execute({name:'privileged',args:{id:'1'}})).status).toBe(403)
  expect((await s.execute({name:'approval',args:{id:'1'}})).status).toBe(202)
  expect(s.calls()).toBe(0)
  expect(s.engine.gatekeeper.getAuditLogs('tenant-a')[0].hash).toMatch(/^[a-f0-9]{64}$/)
  expect(s.engine.gatekeeper.getAuditLogs('tenant-a').map(x=>[x.userId,x.status])).toEqual([['u1','BLOCKED'],['u1','PENDING_APPROVAL']])
 })
 test('uses authenticated identity and validates arguments without coercion',async()=>{
  const s=await setup()
  expect((await s.execute({name:'read',args:{id:123}})).status).toBe(400)
  expect((await s.execute({name:'read',args:{id:'1'},tenantId:'tenant-b'})).status).toBe(400)
  expect((await s.execute({name:'approval',args:{id:'1'},approved:true})).status).toBe(400)
  const result=await (await s.execute({name:'read',args:{id:'1'}})).json()
  expect(result.result).toEqual({id:'1',tenantId:'tenant-a',userId:'u1',hasAIHostAdapters:false})
  expect(s.calls()).toBe(1)
 })
 test('resolves host adapters from verified MCP context and never from request body', async () => {
  const s = await setup(true)
  expect((await s.execute({ name: 'read', args: { id: '1' }, aiHostAdapters: { calendar: 'forged' } })).status).toBe(400)
  const result = await (await s.execute({ name: 'read', args: { id: '1' } })).json()
  expect(result.result).toEqual({ id: '1', tenantId: 'tenant-a', userId: 'u1', hasAIHostAdapters: true })
  expect(s.resolvedAIContext()).toMatchObject({ pluginId: 'notes', toolName: 'read', principal: { tenantId: 'tenant-a', userId: 'u1' }, context: { operation: 'mcp:read', tenantId: 'tenant-a', userId: 'u1' } })
 })
 test('refreshes activation on each request and binds dedicated tenants',async()=>{
  const s=await setup()
  await s.execute({name:'read',args:{id:'1'}})
  s.setPrincipal({userId:'u1',tenantId:'tenant-a',roles:['USER'],enabledPluginIds:[]})
  expect((await s.execute({name:'read',args:{id:'1'}})).status).toBe(404)
  expect((await (await s.app.request('/api/mcp/tools')).json()).tools).toEqual([])
  s.setPrincipal({userId:'u2',tenantId:'tenant-b',roles:['admin'],enabledPluginIds:['notes']})
  expect((await s.execute({name:'read',args:{id:'1'}})).status).toBe(401)
  expect(s.calls()).toBe(1)
 })
  test('rejects ambiguous tool ownership',async()=>{
   const s=await setup();const other=base('other');other.mcp={tools:[{name:'read',description:'duplicate',parameters:{},handler:async()=>{throw new Error('never')}}]}
   s.engine.registry.register(other)
   expect((await s.app.request('/api/mcp/tools')).status).toBe(500)
   expect((await s.execute({name:'read',args:{id:'1'}})).status).toBe(500)
   expect(s.calls()).toBe(0)
  })
  test('supports MCP SSE transport and JSON-RPC 2.0 messages', async () => {
   const s = await setup()

   // 1. GET /api/mcp/sse handshake
   const sseRes = await s.app.request('/api/mcp/sse')
   expect(sseRes.status).toBe(200)
   expect(sseRes.headers.get('Content-Type')).toContain('text/event-stream')
   const reader = sseRes.body!.getReader()
   const handshake = await reader.read()
   const sessionId = new TextDecoder().decode(handshake.value).match(/sessionId=([a-f0-9-]+)/)?.[1]
   expect(sessionId).toBeString()

   // The SSE endpoint is bound to the principal that opened it.
   s.setPrincipal({ userId: 'u2', tenantId: 'tenant-a', roles: ['USER'], enabledPluginIds: ['notes'] })
   const foreignMessage = await s.app.request(`/api/mcp/message?sessionId=${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'foreign', method: 'tools/list' }),
   })
   expect(foreignMessage.status).toBe(403)
   expect((await foreignMessage.json()).error.message).toBe('MCP session owner mismatch')

   s.setPrincipal({ userId: 'u1', tenantId: 'tenant-a', roles: ['USER'], enabledPluginIds: ['notes'] })

   // 2. POST /api/mcp/message (tools/list)
   const listRes = await s.app.request(`/api/mcp/message?sessionId=${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'req_1', method: 'tools/list' }),
   })
   expect(listRes.status).toBe(200)
   const listData = await listRes.json()
   expect(listData.jsonrpc).toBe('2.0')
   expect(listData.id).toBe('req_1')
   expect(listData.result.tools.map((t: any) => t.name)).toContain('read')

   // 3. POST /api/mcp/message (tools/call)
   const callRes = await s.app.request('/api/mcp/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
     jsonrpc: '2.0',
     id: 'req_2',
     method: 'tools/call',
     params: { name: 'read', arguments: { id: 'item_42' } },
    }),
   })
   expect(callRes.status).toBe(200)
   const callData = await callRes.json()
   expect(callData.jsonrpc).toBe('2.0')
   expect(callData.id).toBe('req_2')
   expect(callData.result.content[0].text).toContain('item_42')
   await reader.cancel()
  })
})
