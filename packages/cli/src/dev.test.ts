import { expect, test } from 'bun:test'
import { definePlugin } from '@alneas/eaos-core'
import { createPluginDevApp } from './dev'
test('dev uses real SQLite schemas and isolates concurrent tenant/persona requests', async () => {
  const plugin = definePlugin({ id: 'notes', entitlement: { tier: 'pro', addonId: 'addon-notes' }, schemaDependencies: { notes: '*' }, routes(r) {
    r.post<{ id: string; text: string }>('/notes', async (ctx, input) => ctx.db.create('notes', { id: input.id, tenant_id: ctx.principal.tenantId, text: input.text }))
    r.get('/notes', ctx => ctx.db.find('notes'))
  } })
  const dev = await createPluginDevApp({ plugin, contracts: [{ id: 'notes', version: '1.0.0', description: 'Notes', schema: { type: 'object', properties: { tenant_id: { type: 'string' }, id: { type: 'string' }, text: { type: 'string' } }, required: ['tenant_id', 'id'], 'x-db': { tableName: 'notes' } }, migrations: [{ id: '001', scope: 'database', sql: { sqlite: ['CREATE TABLE notes(tenant_id TEXT,id TEXT,text TEXT,PRIMARY KEY(tenant_id,id))'] } }] }] })
  const headers = (tenant: string, plan: string) => ({ 'Content-Type': 'application/json', 'X-Eaos-Dev-Tenant': tenant, 'X-Eaos-Dev-Plan': plan })
  try {
    const [allowed, denied] = await Promise.all([
      dev.app.request('/api/plugins/notes/notes', { method: 'POST', headers: headers('tenant-a', 'pro'), body: JSON.stringify({ id: 'n1', text: 'private note' }) }),
      dev.app.request('/api/plugins/notes/notes', { method: 'POST', headers: headers('tenant-b', 'free'), body: JSON.stringify({ id: 'n1', text: 'denied' }) }),
    ])
    expect(allowed.status).toBe(200); expect(denied.status).toBe(402)
    const other = await dev.app.request('/api/plugins/notes/notes', { headers: headers('tenant-b', 'pro') })
    expect(await other.json()).toEqual([])
    expect((await dev.app.request('/api/plugins/notes/notes', { headers: { ...headers('tenant-a', 'pro'), 'X-Eaos-Dev-Role': 'guest' } })).status).toBe(404)
    expect((await dev.app.request('/')).status).toBe(200)
  } finally { await dev.close() }
})

test('registered jobs, webhook fixtures and MCP share verified development principal and tenant resources',async()=>{
 const {PluginRegistry,McpGatekeeper}=await import('@alneas/eaos-core')
 const registry=new PluginRegistry(),gatekeeper=new McpGatekeeper()
 const entitlement={tier:'public' as const}
 registry.register({id:'fixture',name:'Fixture',version:'1.0.0',description:'',icon:'',category:'',targets:[],dependencies:[],tier:'public',entitlement,industries:[],contracts:[],subscribes:[],publishes:[],navigation:{},schema:{ownedTables:[],externalReferences:{},migrationOrder:0},mcp:{tools:[{name:'who',description:'',parameters:{type:'object',additionalProperties:false},handler:async(_input,context)=>({tenant:context.principal.tenantId,user:context.principal.userId})}]}})
 let executed=''
 const plugin=definePlugin({id:'fixture',entitlement,routes(r){r.post('/enqueue',async(ctx,input)=>({id:await ctx.jobs.enqueue('record',input)}));r.post('/verify',async ctx=>({verified:await ctx.webhooks.verify('fixture',new Request('http://localhost',{headers:{'x-fixture':'valid'}}))}));r.post('/secret',async ctx=>({secret:await ctx.secrets.get('fixture')}))}})
 const dev=await createPluginDevApp({plugin,mcp:{registry,gatekeeper},jobs:{record:async ctx=>{executed=ctx.principal.tenantId;await ctx.audit.record('job.executed',{})}},webhooks:{fixture:async(p,r)=>p.tenantId==='tenant-a'&&r.headers.get('x-fixture')==='valid'},resolveSecret:async(p,key)=>p.tenantId+':'+key})
 const headers={'Content-Type':'application/json','X-Eaos-Dev-Tenant':'tenant-a'}
 try{
  const response=await dev.app.request('/api/plugins/fixture/enqueue',{method:'POST',headers,body:'{}'}),{id}=await response.json()
  for(let n=0;n<20&&executed==='';n++)await new Promise(resolve=>setTimeout(resolve,1))
  expect(executed).toBe('tenant-a')
  expect((await dev.app.request('/__eaos/jobs/'+id,{headers:{'X-Eaos-Dev-Tenant':'tenant-b'}})).status).toBe(404)
  expect(await(await dev.app.request('/api/plugins/fixture/verify',{method:'POST',headers,body:'{}'})).json()).toEqual({verified:true})
  expect(await(await dev.app.request('/api/plugins/fixture/secret',{method:'POST',headers,body:'{}'})).json()).toEqual({secret:'tenant-a:fixture'})
  expect(await(await dev.app.request('/__eaos/mcp/execute',{method:'POST',headers,body:JSON.stringify({name:'who',args:{}})})).json()).toMatchObject({result:{tenant:'tenant-a',user:'dev-member'}})
  expect((await dev.app.request('/__eaos/mcp/execute',{method:'POST',headers:{...headers,'X-Eaos-Dev-Role':'guest'},body:JSON.stringify({name:'who',args:{}})})).status).toBe(404)
 }finally{await dev.close()}
})

test('configured UI compiles against public client SDK and rejects paths outside the project',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{join}=await import('node:path')
 const root=await mkdtemp(join(process.cwd(),'.dev-client-'))
 try{
  await writeFile(join(root,'ui.tsx'),"import * as React from 'react';export default function Page(){return <h1>Fixture UI</h1>}")
  const plugin=definePlugin({id:'ui-fixture',routes(){}})
  const dev=await createPluginDevApp({plugin,clients:{web:{entry:'ui.tsx'}}},{root})
  try{
   expect(await(await dev.app.request('/__eaos/client/web')).text()).toContain('Web 開発プレビュー')
   expect(await(await dev.app.request('/__eaos/client/line')).text()).toContain('LIFF 開発用モック')
   expect(await(await dev.app.request('/__eaos/assets/web/client.js')).text()).toContain('Fixture UI')
   expect((await dev.app.request('/__eaos/assets/web/unknown.js')).status).toBe(404)
  }finally{await dev.close()}
  await expect(createPluginDevApp({plugin,clients:{web:{entry:'../package.json'}}},{root})).rejects.toThrow('inside the plugin project')
 }finally{await rm(root,{recursive:true,force:true})}
})
