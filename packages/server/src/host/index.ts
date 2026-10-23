import {createErpEngine} from '../engine'
import {resolveLifecycleBackend} from '../lifecycle'
import {createPluginAuthorizationMiddleware,getPlatformPluginAuthorization,resolveClientPlugins} from '../extensions'
import {prepareHostCatalog} from './catalog'
import {policyForCatalog} from './policy'
import {createHostMcpToolContext} from './mcp'
import {createHostExtensionRoutes} from './extensions'
import type {StandardHostOptions,StandardHostContext,StandardHostResult} from './types'
export type * from './types'
export {createStandardHostPolicy} from './policy'
export {createHostMcpToolContext} from './mcp'

/**
 * Start one authenticated Host from selected bindings and explicit infrastructure capabilities.
 * @param input - App settings, verified identity, current admission and runtime factories.
 * @returns The completed Hono app and runtime context, without opening a listener.
 * @throws Invalid metadata/ports or startup failures reject without returning a partial app.
 * @remarks Applies no migrations, activates no tenants and imports no private implementations.
 * @example
 * import { createStandardHost, type StandardHostOptions } from '@alneas/eaos-server/host'
 * export const start = (options: StandardHostOptions) => createStandardHost(options)
 */
export async function createStandardHost(input:StandardHostOptions):Promise<StandardHostResult>{
 const options={...input,app:{...input.app,corsOrigins:input.app?.corsOrigins?[...input.app.corsOrigins]:undefined,authSkipPaths:input.app?.authSkipPaths?[...input.app.authSkipPaths]:undefined},auth:{...input.auth},admission:{...input.admission},runtime:{...input.runtime},mcp:input.mcp?{...input.mcp,requestContext:{...input.mcp.requestContext}}:undefined}
 if(!options.app?.name?.trim()||typeof options.auth?.verifier?.verifySession!=='function'||typeof options.auth?.membership!=='function'||typeof options.admission?.store!=='function'||typeof options.admission?.loadEnabledModules!=='function'||typeof options.runtime?.loadLifecycle!=='function'||typeof options.runtime?.createEntitlements!=='function')throw Error('Standard Host requires explicit auth, admission and runtime capabilities')
 const inputs={...options.adoption,...options.admission},catalog=prepareHostCatalog(inputs)
 if(catalog.mcpPluginIds.length&&(!options.mcp||typeof options.mcp.bindPlugin!=='function'||typeof options.mcp.requestContext?.current!=='function'||typeof options.mcp.requestContext?.bind!=='function'))throw Error('Selected MCP bindings require a request context and binder')
 const policy=policyForCatalog(inputs,catalog.manifests),lifecycle=await options.runtime.loadLifecycle()
 const isPluginEnabled=async(tenantId:string,id:string)=>!!lifecycle&&await lifecycle.lifecycle.isEnabled(await resolveLifecycleBackend(lifecycle,tenantId),tenantId,id)
 const runtimeInput=Object.freeze({policy,manifests:policy.manifests,lifecycle,isPluginEnabled})
 const entitlements=await options.runtime.createEntitlements(runtimeInput)
 if(!entitlements||typeof entitlements.check!=='function')throw Error('Entitlement runtime required')
 const resolvePrincipal=async(context:Parameters<StandardHostContext['resolvePrincipal']>[0])=>await getPlatformPluginAuthorization(context)?.resolvePrincipal()??null
 const context:StandardHostContext=Object.freeze({...runtimeInput,entitlements,resolvePrincipal,resolveClientPlugins})
 const mcp=options.mcp
 const engine=createErpEngine({appName:options.app.name,plugins:[...policy.manifests],cors:{allowOrigins:[...(options.app.corsOrigins??[])]},auth:{verifier:options.auth.verifier,skipPaths:options.app.authSkipPaths?[...options.app.authSkipPaths]:undefined},validateSecrets:options.app.validateSecrets,middleware:[app=>{
  if(options.app.releaseVersion)app.use('*',async(c,next)=>{c.header('X-EAOS-Release',options.app.releaseVersion!);await next()})
  app.use('*',options.auth.membership)
  app.use('*',policy.entitlementMiddleware)
  app.use('*',createPluginAuthorizationMiddleware({store:options.admission.store,enabledPluginIds:async tenantId=>policy.enabledPluginIds(await policy.loadEnabledModules(tenantId)),isEnabled:isPluginEnabled}))
 }]})
 await engine.initialize()
 const customRoutes=await options.createRoutes?.(context)??[]
 const app=engine.createApp({lifecycle,entitlements,resolveEntitlementPrincipal:resolvePrincipal,requireModule:id=>lifecycle?policy.requireModule(id):async c=>c.json({error:'Plugin is inactive'},403),customRoutes:[{prefix:'/',router:createHostExtensionRoutes(catalog.extensions,context)},...customRoutes],health:options.app.health,
  ...(mcp?{mcp:{resolvePrincipal:async c=>{mcp.requestContext.bind(c);return await getPlatformPluginAuthorization(c)?.resolvePrincipal()??null},createToolContext:createHostMcpToolContext({...mcp,pluginIds:catalog.mcpPluginIds})}}:{})})
 return{app,context}
}
