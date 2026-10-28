import {Hono} from 'hono'
import {mountExtensionRoutes,type PlatformExtension} from '../extensions'
import {createLifecycleGuard} from '../lifecycle'
import {createPluginEntitlementGuard} from '../entitlements'
import type {StandardHostContext} from './types'
export function createHostExtensionRoutes(extensions:PlatformExtension[],context:StandardHostContext){
 const routes=new Hono()
 mountExtensionRoutes(routes,extensions,id=>async(c,next)=>{
  if(!context.lifecycle)return c.json({error:'Plugin is inactive'},403)
  let admitted=false
  const lifecycleResponse=await createLifecycleGuard(context.lifecycle,id)(c,async()=>{admitted=true})
  if(!admitted)return lifecycleResponse
  const rule=context.manifests.find(manifest=>manifest.id===id)?.entitlement
  if(!rule)return c.json({error:'Plugin unavailable'},404)
  admitted=false
  const moduleResponse=await context.policy.requireModule(id)(c,async()=>{admitted=true})
  if(!admitted)return moduleResponse
  return createPluginEntitlementGuard(id,rule,context.entitlements,context.resolvePrincipal)(c,next)
 })
 return routes
}
