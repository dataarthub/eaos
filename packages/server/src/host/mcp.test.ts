import {test,expect} from 'bun:test'
import {AsyncLocalStorage} from 'node:async_hooks'
import {Hono,type Context} from 'hono'
import {PLATFORM_PLUGIN_AUTHORIZATION} from '../extensions'
import {createHostMcpToolContext} from './mcp'
test('selected MCP binding checks live tenant user feature and roles before each tool call',async()=>{
 const scope=new AsyncLocalStorage<Context>(),app=new Hono();let active=true,roles=['member'],calls=0
 const principal={tenantId:'a',userId:'u',roles:['member'],enabledPluginIds:['a']}
 const adapter=createHostMcpToolContext({pluginIds:['a'],requestContext:{current:()=>{const c=scope.getStore();if(!c)throw Error('scope');return c},bind:()=>{}},bindPlugin:async()=>{calls++;return{mcp:{tools:[{name:'get',handler:async(_input:unknown,p:any)=>p.roles} as any]}}}})
 app.get('/',c=>scope.run(c,async()=>{
  c.set(PLATFORM_PLUGIN_AUTHORIZATION,{resolvePrincipal:async()=>active?{...principal,roles}:null,isPluginEnabled:async()=>active})
  await expect(adapter({...principal,tenantId:'foreign'},'a')).rejects.toThrow()
  await expect(adapter(principal,'omitted')).rejects.toThrow();expect(calls).toBe(0)
  const bound=await adapter(principal,'a') as {callPluginTool:(name:string,args:unknown)=>Promise<unknown>}
  roles=['admin'];expect(await bound.callPluginTool('get',{})).toEqual(['admin'])
  await expect(bound.callPluginTool('unknown',{})).rejects.toThrow()
  active=false;await expect(bound.callPluginTool('get',{})).rejects.toThrow()
  return c.text('ok')
 }))
 expect((await app.request('/')).status).toBe(200)
 await expect(adapter(principal,'a')).rejects.toThrow()
})
test('interleaved request scopes and denied binders cannot share authority',async()=>{
 const scope=new AsyncLocalStorage<Context>(),app=new Hono()
 const adapter=createHostMcpToolContext({pluginIds:['a'],requestContext:{current:()=>scope.getStore()!,bind:()=>{}},bindPlugin:async c=>c.req.query('deny')?new Response('denied',{status:403}):{mcp:{tools:[{name:'get',handler:async()=>c.req.query('tenant')} as any]}}})
 app.get('/',c=>scope.run(c,async()=>{
  const p={tenantId:c.req.query('tenant')!,userId:'u',roles:[],enabledPluginIds:['a']}
  c.set(PLATFORM_PLUGIN_AUTHORIZATION,{resolvePrincipal:async()=>p,isPluginEnabled:async()=>true})
  await new Promise(resolve=>setTimeout(resolve,5))
  if(c.req.query('deny')){await expect(adapter(p,'a')).rejects.toThrow();return c.text('denied')}
  const bound=await adapter(p,'a') as any;return c.text(await bound.callPluginTool('get',{}))
 }))
 const responses=await Promise.all(['one','two'].map(tenant=>app.request('/?tenant='+tenant)))
 expect(await Promise.all(responses.map(r=>r.text()))).toEqual(['one','two'])
 expect(await (await app.request('/?tenant=one&deny=1')).text()).toBe('denied')
})
test('a bound tool pins original principal identities even when caller objects change',async()=>{
 const p={tenantId:'a',userId:'u',roles:[],enabledPluginIds:['a']}
 const app=new Hono();let invoke:undefined|((name:string,args:Record<string,unknown>)=>Promise<unknown>)
 app.get('/',async context=>{
  context.set(PLATFORM_PLUGIN_AUTHORIZATION,{resolvePrincipal:async()=>p,isPluginEnabled:async()=>true})
  const adapter=createHostMcpToolContext({pluginIds:['a'],requestContext:{current:()=>context,bind:()=>{}},bindPlugin:async()=>({mcp:{tools:[{name:'get',handler:async()=>true} as any]}})})
  const bound=await adapter(p,'a') as {callPluginTool:NonNullable<typeof invoke>};invoke=bound.callPluginTool
  p.tenantId='foreign';await expect(invoke('get',{})).rejects.toThrow();return context.text('ok')
 })
 expect((await app.request('/')).status).toBe(200)
})
