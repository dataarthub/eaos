import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { SQLiteDataAccessAdapter, createSqliteDriver } from '@alneas/appkit-core/data/sqlite'
import { LocalStorageAdapter } from '@alneas/appkit-core/storage/server'
import { createTenantStorage } from '@alneas/eaos-server/storage'
import { createMcpRouter } from '@alneas/eaos-server/mcp'
import { buildDevClient, devClientHtml, type DevClientEntry } from './dev-client'
import { createSdkPluginRouter, type PluginSdkHost } from '@alneas/eaos-server/plugin-sdk'
import { PluginEntitlementRuntime } from '@alneas/eaos-server/entitlements'
import { createAtomicRepository, createSqliteAtomicDriver, appendAtomicAudit } from '@alneas/eaos-server/plugin-data'
import { resolveDataContracts, type DataContract } from '@alneas/eaos-server/lifecycle-engine'
import type { DefinedPlugin, PlatformPrincipal, PluginContext, TenantEntitlements, PluginRegistry, McpGatekeeper } from '@alneas/eaos-core'
/**
 * Trusted development-only plugin and optional test-host capabilities.
 * @see {@link createPluginDevApp} for the canonical usage example and runtime requirements.
 */
export interface PluginDevConfig {
 
    /**
   * Trusted Core plugin definition mounted by the disposable local runtime.
   */
  plugin: DefinedPlugin
 
    /**
   * Explicit Data Contracts required by schemaDependencies; missing migrations reject startup.
   */
  contracts?: DataContract[]
 
    /**
   * Optional async per-tenant seed callback receiving the scoped database and verified local persona; called on that tenant's first access.
   */
  seed?: (db: SQLiteDataAccessAdapter, principal: PlatformPrincipal) => Promise<void>
 
    /**
   * Explicit host capabilities exposed to trusted plugin code.
   */
  services?: Record<string, unknown>
 
    /**
   * Local test budgets keyed by addon or plugin; omitted or zero budgets do not fabricate metered allowance.
   */
  monthlyQuotas?: Readonly<Record<string,number>>
 
    /**
   * Trusted web/LINE component entry declarations; never import server configuration into the browser bundle.
   */
  clients?: {
    /** Trusted web component entry compiled into the local browser preview; omission leaves that preview unconfigured. */
  web?:DevClientEntry;
    /** Trusted LINE preview entry; when omitted, the web entry is reused if present. */
  line?:DevClientEntry}
 
    /**
   * Optional registry and gatekeeper for exactly the same plugin and entitlement.
   */
  mcp?: {
    /** Registry containing exactly this development plugin with a matching entitlement declaration; startup rejects other compositions. */
  registry:PluginRegistry;
    /** Host-selected tool policy and audit service shared by local MCP discovery/execution. */
  gatekeeper:McpGatekeeper}
 
    /**
   * Async host callback resolving one secret key for the supplied verified local principal; missing binding rejects secret access.
   */
  resolveSecret?: (principal:PlatformPrincipal,key:string)=>Promise<string>
 
    /**
   * Explicit async job handlers keyed by operation; receive scoped plugin context and caller input.
   */
  jobs?: Record<string,(context:PluginContext,input:unknown)=>Promise<void>>
 
    /**
   * Named async test validators receiving the local principal and Request; return whether admission is allowed.
   */
  webhooks?: Record<string,(principal:PlatformPrincipal,request:Request)=>Promise<boolean>>
}
/**
 * Retain a typed development configuration without creating a server or persistence.
 * @param config - Explicit plugin definition and optional local test host capabilities.
 * @returns The same configuration object, without cloning or validation.
 * @remarks The later development runtime validates contracts and allocates disposable state; defining configuration alone does not do so.
 * @example
 * import { defineDevConfig } from '@alneas/eaos-cli/dev'
 * import { definePlugin } from '@alneas/eaos-core'
 * const config = defineDevConfig({ plugin: definePlugin({ id: 'notes', entitlement: { tier: 'public' }, routes(router) { router.post('/ping', async () => ({ ready: true })) } }) })
 */
export const defineDevConfig = (config: PluginDevConfig) => config
/**
 * Create a disposable local development app around a trusted plugin and scoped SQLite stores.
 * @param config - Plugin definition and explicit contracts, local capabilities, clients and optional MCP bindings.
 * @param options - Optional root for local source and client resolution.
 * @returns An object with the Hono app and async close(); close waits for owned jobs/contexts, closes databases and removes temporary storage.
 * @throws Rejects invalid contracts/migrations, mismatched MCP policy or failed local resource initialization.
 * @remarks Allocates in-memory databases and temporary storage; trusted plugin code is not OS-sandboxed. This is not production identity or permission infrastructure. Use returned cleanup hooks when ending a session.
 * @example
 * import { createPluginDevApp } from '@alneas/eaos-cli/dev'
 * export function createSandbox(config: Parameters<typeof createPluginDevApp>[0]) { return createPluginDevApp(config) }
 */
export async function createPluginDevApp(config: PluginDevConfig, options:{
/**
 * Trusted source/client resolution root; defaults to process.cwd() when omitted.
 */
root?:string}={}) {
  if(config.mcp){
    const plugins=config.mcp.registry.getAll()
    if(plugins.length!==1 || plugins[0].id!==config.plugin.id || JSON.stringify(plugins[0].entitlement??null)!==JSON.stringify(config.plugin.entitlement??null))throw Error('Development MCP must use the same plugin and entitlement')
  }
  const catalog = resolveDataContracts(config.contracts ?? [], { ...config.plugin.schemaDependencies })
  const directory = await mkdtemp(resolve(tmpdir(), 'eaos-dev-'))
  const databases = new Map<string, DatabaseSync>(), contexts = new Map<string, Promise<PluginContext['db']>>()
  const control = new DatabaseSync(':memory:')
  control.exec('CREATE TABLE dev_control_records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))')
  const repository = createAtomicRepository('dev_control_records', createSqliteAtomicDriver({ exec: sql => control.exec(sql), query: sql => ({ all: (...values) => control.prepare(sql).all(...values), run: (...values) => ({ changes: Number(control.prepare(sql).run(...values).changes) }) }) }))
  const { AsyncLocalStorage } = await import('node:async_hooks')
  const personas = new AsyncLocalStorage<TenantEntitlements['plan']>()
  const runtime = new PluginEntitlementRuntime({ repository, isActive: async () => true, load: async tenantId => {
    const selected = personas.getStore() ?? 'free'
    return { tenantId, status: 'active', plan: selected, monthlyQuotas:config.monthlyQuotas??{}, addons: selected === 'pro' && config.plugin.entitlement?.addonId ? [config.plugin.entitlement.addonId] : [] }
  } })
  const app = new Hono()
  app.use('*', async (c, next) => {
    const tenantId = c.req.header('X-Eaos-Dev-Tenant') ?? 'tenant-a', role = c.req.header('X-Eaos-Dev-Role') ?? 'member', selectedPlan = c.req.header('X-Eaos-Dev-Plan') ?? 'free'
    if (!['tenant-a', 'tenant-b'].includes(tenantId) || !['admin', 'member', 'guest'].includes(role) || !['free', 'standard', 'pro'].includes(selectedPlan)) return c.json({ error: 'Invalid dev persona' }, 400)
    c.set('principal', { tenantId, userId: `dev-${role}`, roles: [role] })
    // Resolve per-request, with no asynchronous global persona state.
    c.set('devPlan', selectedPlan)
    await personas.run(selectedPlan as TenantEntitlements['plan'],next)
  })
  const jobs=new Map<string,{id:string;tenantId:string;status:string}>(),pendingJobs=new Set<Promise<void>>()
  const createContext: PluginSdkHost['createContext'] = async (principal, pluginId) => {
      let pending = contexts.get(principal.tenantId)
      if (!pending) {
        pending = (async () => {
          const database = new DatabaseSync(':memory:'); databases.set(principal.tenantId, database)
          for (const contract of catalog.contracts) for (const migration of contract.migrations) {
            if (!migration.sql.sqlite?.length) throw Error(`Development schema requires SQLite SQL: ${contract.id}:${migration.id}`)
            for (const sql of migration.sql.sqlite) database.exec(sql)
          }
          const adapter = new SQLiteDataAccessAdapter({ driver: createSqliteDriver(database as any), cacheScope: `dev:${principal.tenantId}` })
          await config.seed?.(adapter, principal)
          return adapter
        })()
        contexts.set(principal.tenantId, pending)
      }
      return {
        db: await pending,
        storage: createTenantStorage(new LocalStorageAdapter({ baseDir: directory, baseUrl: 'http://127.0.0.1/dev-files' }), { tenantId: principal.tenantId, pluginId, authorize: async () => true }),
        secrets: { get: async key => { if(!config.resolveSecret)throw Error('Development secret resolver unavailable'); return config.resolveSecret(principal,key) } },
        jobs: { enqueue: async (name,input) => {
          if(!config.jobs || !Object.hasOwn(config.jobs,name) || jobs.size>=1000)throw Error('Registered development job required')
          const id=crypto.randomUUID(),job={id,tenantId:principal.tenantId,status:'queued'}
          jobs.set(id,job)
          await repository.run(principal,tx=>appendAtomicAudit(tx,principal,'dev.job.queued',{id,name},null))
          const work=Promise.resolve().then(async()=>{job.status='running';try{const dependencies=await createContext(principal,pluginId);await config.jobs![name](Object.freeze({...dependencies,principal:Object.freeze({...principal,entitlements:await runtime.snapshot(principal)}),pluginId}),structuredClone(input));}catch{job.status='failed'}const completed=job.status!=='failed';try{await repository.run(principal,tx=>appendAtomicAudit(tx,principal,completed?'dev.job.completed':'dev.job.failed',{id,name},null));job.status=completed?'completed':'failed'}catch{job.status='failed'}})
          pendingJobs.add(work);void work.finally(()=>pendingJobs.delete(work)).catch(()=>undefined)
          return id
        } },
        webhooks: { verify: async (name,request) => config.webhooks && Object.hasOwn(config.webhooks,name) ? await config.webhooks[name](principal,request) === true : false },
        audit: { record: async (action, metadata) => { await repository.run(principal, tx => appendAtomicAudit(tx, principal, action, metadata, null)) } },
        services: config.services ?? {},
      }
  }
  const router = createSdkPluginRouter(config.plugin, {resolvePrincipal:async c=>c.get('principal'),authorize:async p=>!p.roles.includes('guest'),entitlements:runtime,createContext})
  app.route(`/api/plugins/${config.plugin.id}`,router)
  app.get('/__eaos/persona',async c=>{
    const principal=c.get('principal') as PlatformPrincipal
    const decision=config.plugin.entitlement ? await runtime.check(principal,config.plugin.id,config.plugin.entitlement) : {allowed:true as const}
    const allowed=decision.allowed && !principal.roles.includes('guest') && (!('quota' in decision)||decision.quota!==0)
    return c.json({...principal,enabledModules:allowed?[config.plugin.id]:[],pluginAccess:{[config.plugin.id]:{allowed,...(!decision.allowed?{reason:decision.reason}:decision.allowed&&'quota' in decision&&decision.quota===0?{reason:'quota-exceeded'}:{})}}})
  })
  app.get('/__eaos/jobs/:id',c=>{const job=jobs.get(c.req.param('id'));return job&&job.tenantId===c.get('principal').tenantId?c.json(job):c.json({error:'Job unavailable'},404)})
  if(config.mcp){
    app.route('/__eaos/mcp',createMcpRouter(config.mcp,{entitlements:runtime,resolvePrincipal:async c=>({...c.get('principal'),enabledPluginIds:[config.plugin.id]}),isPluginEnabled:async p=>!p.roles.includes('guest'),createToolContext:async p=>({...await createContext(p,config.plugin.id),principal:Object.freeze({...p,entitlements:await runtime.snapshot(p)})})}))
  }
  const clients=new Map<string,Map<string,string>>()
  try{
    for(const surface of ['web','line'] as const){const entry=config.clients?.[surface]??(surface==='line'?config.clients?.web:undefined);if(entry)clients.set(surface,await buildDevClient(options.root??process.cwd(),entry,config.plugin))}
  }catch(error){for(const db of databases.values())db.close();control.close();await rm(directory,{recursive:true,force:true});throw error}
  app.get('/__eaos/client/:surface',c=>clients.has(c.req.param('surface'))?c.html(devClientHtml(c.req.param('surface'))):c.text('Configure a trusted clients.web/line entry in eaos.dev.ts',404))
  app.get('/__eaos/assets/:surface/:file',c=>{const file=c.req.param('file'),assets=clients.get(c.req.param('surface'));if(!assets || !['client.js','client.css'].includes(file))return c.notFound();return c.body(assets.get(file)??'',200,{'Content-Type':file.endsWith('.css')?'text/css':'text/javascript'})})
  app.get('/',c=>c.html(devHtml(config.plugin.id,clients.size>0,!!config.mcp)))
  return {app,async close(){await Promise.allSettled(pendingJobs);await Promise.allSettled(contexts.values());for(const db of databases.values())db.close();control.close();await rm(directory,{recursive:true,force:true})}}
}
function devHtml(id: string,clients:boolean,mcp:boolean) {
  if (!/^[a-z][a-z0-9-]{0,127}$/.test(id)) throw Error('Invalid plugin ID')
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>EAOS Plugin Dev</title><style>body{font:16px system-ui;max-width:960px;margin:32px auto;background:#f6f7fa;color:#16243a}select,input,button,textarea{font:inherit;padding:8px;margin:4px}textarea,pre{box-sizing:border-box;width:100%;padding:16px}pre{white-space:pre-wrap;background:white}header{display:flex;align-items:center;flex-wrap:wrap}</style><h1>${id}</h1><header><label>Tenant <select id="tenant"><option>tenant-a</option><option>tenant-b</option></select></label><label>Role <select id="role"><option>member</option><option>admin</option><option>guest</option></select></label><label>Plan <select id="plan"><option>free</option><option>standard</option><option>pro</option></select></label></header><label>表示 <select id="surface"><option value="web">Web</option><option value="line">LINE / LIFF</option></select></label>${clients?'<iframe title="Plugin UI" id="client" style="width:100%;height:640px;border:1px solid #ccc"></iframe>':''}<p>ローカル開発用のAPIコンソールです。認証・外部API・ジョブ実行を本番として扱いません。</p><select id="method"><option>POST</option><option>GET</option></select><input id="path" value="/" aria-label="Route path"><button id="run">実行</button><textarea id="input" rows="8" aria-label="JSON input">{}</textarea><pre id="output" role="status"></pre>${mcp?'<h2>MCP</h2><button id="discover">利用可能ツール</button><input id="tool" aria-label="MCP tool name"><button id="invoke">ツール実行</button>':''}<script>const persona=()=>({'Content-Type':'application/json','X-Eaos-Dev-Tenant':document.getElementById('tenant').value,'X-Eaos-Dev-Role':document.getElementById('role').value,'X-Eaos-Dev-Plan':document.getElementById('plan').value});const frame=document.getElementById('client');function preview(){if(!frame)return;const surface=document.getElementById('surface').value;frame.style.width=surface==='line'?'390px':'100%';frame.src='/__eaos/client/'+surface+'?'+new URLSearchParams({surface,tenant:document.getElementById('tenant').value,role:document.getElementById('role').value,plan:document.getElementById('plan').value})}for(const id of ['tenant','role','plan','surface'])document.getElementById(id).onchange=preview;preview();async function mcpCall(path,body){try{const r=await fetch('/__eaos/mcp/'+path,{method:body?'POST':'GET',headers:persona(),...(body?{body:JSON.stringify(body)}:{})});document.getElementById('output').textContent=r.status+'\\n'+await r.text()}catch(error){document.getElementById('output').textContent=String(error)}}if(document.getElementById('discover')){document.getElementById('discover').onclick=()=>mcpCall('tools');document.getElementById('invoke').onclick=()=>{try{void mcpCall('execute',{name:document.getElementById('tool').value,args:JSON.parse(document.getElementById('input').value)})}catch(error){document.getElementById('output').textContent=String(error)}}}document.getElementById('run').onclick=async()=>{const value=id=>document.getElementById(id).value;try{const path=value('path');if(!/^\\/(?:[a-zA-Z0-9_:-]+\\/?)*$/.test(path))throw Error('Invalid route');const method=value('method');const response=await fetch('/api/plugins/${id}'+path,{method,headers:{'Content-Type':'application/json','X-Eaos-Dev-Tenant':value('tenant'),'X-Eaos-Dev-Role':value('role'),'X-Eaos-Dev-Plan':value('plan')},...(method==='GET'?{}:{body:JSON.stringify(JSON.parse(value('input')))})});document.getElementById('output').textContent=response.status+'\\n'+await response.text()}catch(error){document.getElementById('output').textContent=String(error)}};</script></html>`
}
/**
 * Load a trusted local plugin entry and start its loopback development server.
 * @param cwd - Trusted plugin project root.
 * @param options - Required config path resolved against cwd and required port text converted with Number; the port must be an integer from 1024 to 65535.
 * @returns Resolves to the loopback server and close() handler; close stops the server, cleans disposable state and exits the current process with code 0.
 * @throws Rejects invalid ports/configuration, module import failures or local server/resource initialization failures.
 * @remarks Requires Bun. Executes trusted local source, binds 127.0.0.1, and rejects mismatched Host or Origin values; local callers can select the development persona headers. It is not an OS sandbox or production authentication. SIGINT/SIGTERM handlers call the same close function, which exits the whole process after cleanup; embedding hosts must account for this ownership.
 * @example
 * import { startPluginDev } from '@alneas/eaos-cli/dev'
 * export function startLocal(root: string) { return startPluginDev(root, { config: 'eaos.dev.ts', port: '4310' }) }
 */
export async function startPluginDev(cwd: string, options: { 
/**
 * Trusted plugin configuration module path resolved against cwd and dynamically imported; typically eaos.dev.ts.
 */
config: string; 
/**
 * Required decimal port text converted with Number; must become an integer from 1024 to 65535.
 */
port: string }) {
  const port = Number(options.port)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid dev port')
  const loaded = await import(pathToFileURL(resolve(cwd, options.config)).href)
  const config: PluginDevConfig = loaded.default?.plugin ? loaded.default : { plugin: loaded.default }
  const development = await createPluginDevApp(config,{root:cwd})
  const bun = (globalThis as any).Bun
  if (!bun?.serve) { await development.close(); throw Error('eaos dev requires Bun') }
  const origin = `http://127.0.0.1:${port}`
  const server = bun.serve({ hostname: '127.0.0.1', port, fetch(request: Request) {
    if (new URL(request.url).host !== `127.0.0.1:${port}` || request.headers.get('origin') && request.headers.get('origin') !== origin) return new Response('Local development origin required', { status: 403 })
    return development.app.fetch(request)
  } })
  console.log(`EAOS plugin development: ${origin}`)
  const close = async () => { await server.stop(true); await development.close(); process.exit(0) }
  process.once('SIGINT', close); process.once('SIGTERM', close)
  return { server, close }
}
