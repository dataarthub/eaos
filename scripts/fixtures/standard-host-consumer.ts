import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {AsyncLocalStorage} from 'node:async_hooks'
import {Hono,type Context} from 'hono'
import type {EaosEnv,PluginManifest} from '@alneas/eaos-core'
import {createStandardHost,createStandardHostPolicy,createHostMcpToolContext,type StandardHostOptions,type HostMcpBindingOptions} from '@alneas/eaos-server/host'
import {createSqlRecordStore,createAtomicRepository,type AtomicSqlDriver,type RecordSqlDriver} from '@alneas/eaos-server/plugin-data'
import {PluginEntitlementRuntime} from '@alneas/eaos-server/entitlements'
import type {LifecycleRuntime} from '@alneas/eaos-server/lifecycle'
let db=new DatabaseSync('host.sqlite'),active=true,member=true,tenantId='tenant'
db.exec('CREATE TABLE records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id));CREATE TABLE usage(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))')
const execute=async(sql:string,binds:unknown[]=[])=>/^SELECT/i.test(sql)?{rows:db.prepare(sql).all(...binds as never[]) as Record<string,unknown>[],affectedRows:0}:{affectedRows:Number(db.prepare(sql).run(...binds as never[]).changes)}
const atomic:AtomicSqlDriver={dialect:'sqlite',transaction:async(_p,work)=>{db.exec('BEGIN');try{const result=await work({execute});db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}}}
const records:RecordSqlDriver={dialect:'sqlite',execute:async(_tenant,sql,binds)=>execute(sql,binds)}
const store=createSqlRecordStore<{name:string}>('records',records),scope=new AsyncLocalStorage<Context>()
const manifest:PluginManifest={id:'notes',name:'Notes',version:'0.1.0',description:'',icon:'',category:'general',targets:['web'],dependencies:[],tier:'free',industries:[],contracts:[],subscribes:[],publishes:[],navigation:{},schema:{storagePolicy:{maxPayloadBytes:4194304,objectStorage:'optional',historyRetentionDays:null,archive:{mode:'none'}},ownedTables:[],externalReferences:{},migrationOrder:0},api:{prefix:'/notes'},entitlement:{tier:'public'},mcp:{tools:[{name:'read_note',description:'Read',parameters:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},handler:async()=>{throw Error('Static handler must not execute')}}]}}
const bridge={bind:(c:Context)=>{scope.enterWith(c)},current:()=>{const c=scope.getStore();assert(c);return c}}
const bind:HostMcpBindingOptions['bindPlugin']=async()=>({mcp:{tools:[{...manifest.mcp!.tools[0],handler:async(args,p)=>store.read(p.tenantId,String(args.id))}]}})
const lifecycle={backendId:'fixture',resolveTenant:async(c:Context)=>c.get('tenantId')??null,lifecycle:{isEnabled:async()=>active}} as unknown as LifecycleRuntime
const options:StandardHostOptions={app:{name:'archive-host'},adoption:{manifests:[manifest],routeFactories:{notes:()=>new Hono<EaosEnv>().get('/:id',async c=>{const row=await store.read(c.get('tenantId')!,c.req.param('id'));return row?c.json(row):c.json({error:'missing'},404)})},mcpPluginIds:['notes']},auth:{verifier:{verifySession:async()=>({valid:true,tenantId,userId:'operator'})},membership:async(c,next)=>{c.set('workspaceContext',{tenantId,userId:'operator',roles:['admin']});await next()}},admission:{store:()=>({readTenant:async()=>({tenantName:'Fixture'}),readMembership:async()=>member?{role:'admin'}:undefined}),loadEnabledModules:async()=>['all']},runtime:{loadLifecycle:async()=>lifecycle,createEntitlements:input=>new PluginEntitlementRuntime({repository:createAtomicRepository('usage',atomic),load:async tenantId=>({tenantId,plan:'standard',status:'active',addons:[]}),isActive:(p,id)=>input.isPluginEnabled(p.tenantId,id)})},mcp:{requestContext:bridge,bindPlugin:bind}}
assert.equal(typeof createHostMcpToolContext,'function')
assert.deepEqual(createStandardHostPolicy({manifests:[manifest],pluginIds:[],loadEnabledModules:async()=>[]}).manifests,[])
await store.create('tenant',{id:'note',revision:1,value:{name:'Durable'}})
db.close();db=new DatabaseSync('host.sqlite')
const {app}=await createStandardHost(options)
const request=(path:string,body?:unknown)=>scope.run(undefined as unknown as Context,()=>app.request(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}))
assert.equal((await request('/notes/note')).status,200)
const mcp=await request('/api/mcp/execute',{name:'read_note',args:{id:'note'}})
assert.equal(mcp.status,200);assert.equal((await mcp.json()).result.value.name,'Durable')
assert.equal(await store.replace('tenant',{id:'note',revision:100,value:{name:'stale'}},99),false)
tenantId='foreign';assert.equal((await request('/notes/note')).status,404)
tenantId='tenant';active=false;assert.equal((await request('/notes/note')).status,403)
member=false;assert.equal((await request('/api/mcp/execute',{name:'read_note',args:{id:'note'}})).status,401)
await assert.rejects(createStandardHost({...options,adoption:{...options.adoption,pluginIds:['unknown']}}))
await assert.rejects(createStandardHost({...options,runtime:{...options.runtime,loadLifecycle:async()=>{throw Error('offline')}}}))
db.close()
console.log('Archive Host passed: startup, strict API types, durable reload, CAS, HTTP/MCP parity and current admission.')
