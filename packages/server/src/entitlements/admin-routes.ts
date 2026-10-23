import type { PlatformPrincipal } from '@alneas/eaos-core'
import { Hono } from 'hono'
import { PluginError, exactKeys, jsonBody } from '../plugin-data/index'
import type { PlatformAdminAuthorization } from '../lifecycle-engine/platform/index'
import type { PlatformEntitlementService } from './service'
/** Privileged Host connections for contract administration.
 * @see createEntitlementAdminRoutes
 */
export interface EntitlementAdminRouteOptions {
 /** Host authentication and current platform administrator policy. */
 authorization:PlatformAdminAuthorization
 /** Allowed mutation origins; omitted uses the current request origin. */
 origins?:readonly string[]
 /** Resolve the Host-owned shared control-plane service.
  * @returns A service bound to durable control storage.
  * @example
  * import type {EntitlementAdminRouteOptions} from '@alneas/eaos-server/entitlements'
  * export const service=(ports:EntitlementAdminRouteOptions)=>ports.service()
  */
 service():Promise<PlatformEntitlementService>
 /** Check a target tenant against trusted Host configuration.
  * @param id - Validated target tenant identifier.
  * @returns Whether the tenant exists in the Host control plane.
  * @example
  * import type {EntitlementAdminRouteOptions} from '@alneas/eaos-server/entitlements'
  * export const exists=(ports:EntitlementAdminRouteOptions)=>ports.tenantExists('tenant-one')
  */
 tenantExists(id:string):Promise<boolean>
}
/** Create privileged contract administration routes with current authorization and origin checks.
 * @param options - Trusted administrator policy, service resolver, tenant existence and mutation origins.
 * @returns GET/PUT /tenants/:tenantId/entitlements routes with no-store responses.
 * @throws Construction performs no IO; requests map validation/CAS failures to their HTTP status and other failures to503.
 * @remarks Request bodies never grant platform administration. PUT requires X-EAOS-Request: tenant-contract and an allowed Origin before reaching contract storage.
 * @example
 * import {createEntitlementAdminRoutes,type EntitlementAdminRouteOptions} from '@alneas/eaos-server/entitlements'
 * export const routes=(ports:EntitlementAdminRouteOptions)=>createEntitlementAdminRoutes(ports)
 */
export function createEntitlementAdminRoutes(options:EntitlementAdminRouteOptions) {
 const app = new Hono<{Variables:{contractPrincipal:PlatformPrincipal}}>()
 app.onError((error,c)=>error instanceof PluginError ? c.json({error:error.message},error.status) : c.json({error:'Contract service unavailable'},503))
 app.use('/tenants/:tenantId/entitlements', async (c,next)=>{
  c.header('Cache-Control','private, no-store')
  const p=await options.authorization.resolvePrincipal(c.req.raw)
  if(!p)return c.json({error:'Authentication required'},401)
  const tenantId=c.req.param('tenantId')!
  if(!p.isPlatformAdmin || !await options.authorization.authorize(p,'tenant:update',tenantId))return c.json({error:'Platform administrator required'},403)
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(tenantId)||!await options.tenantExists(tenantId))return c.json({error:'Tenant unavailable'},404)
  if(c.req.method!=='GET'){
   const origin=c.req.header('Origin')
   const accepted=options.origins??[new URL(c.req.url).origin]
   if(!origin||!accepted.includes(origin)||c.req.header('X-EAOS-Request')!=='tenant-contract')return c.json({error:'Same-origin contract request required'},403)
  }
  c.set('contractPrincipal',{tenantId,userId:p.userId,roles:[...(p.roles??[])]})
  await next()
 })
 app.get('/tenants/:tenantId/entitlements',async c=>c.json(await (await options.service()).read(c.get('contractPrincipal'))))
 app.put('/tenants/:tenantId/entitlements',async c=>{const body=await jsonBody(c);exactKeys(body,['commandId','revision','contract']);return c.json(await (await options.service()).save(c.get('contractPrincipal'),body as any))})
 return app
}
