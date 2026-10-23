import {useMemo,type ComponentType} from 'react'
import type {WorkspaceApi,WorkspaceApiCommand,WorkspaceApiRequest} from './client/workspace-api'
import {useRequestLifetime} from './request-lifetime'

/** Display identity from the canonical verified Host context; never server authority.
 * @see useWorkspaceConnection
 */
export interface WorkspaceBindingIdentity {
 /** Verified tenant identity. */
 tenantId:string
 /** Verified user identity. */
 userId:string
 /** Host session generation; changes invalidate pending operations. */
 sessionKey:string
 /** Current role display/grants supplied by the Host. */
 roles:readonly string[]
 /** Currently admitted features, intersected with explicit build selection. */
 enabledPluginIds:readonly string[]
}
/** Explicit adopted owner/list declaration for reference selectors.
 * @see composeWorkspacePages
 */
export interface WorkspaceReferenceDeclaration {
 /** Canonical selected owner. */
 pluginId:string
 /** Owner-declared reference list command. */
 listOperation:string
}
/** Browser capabilities supplied by the adopting Host, without a second identity cache.
 * @see useWorkspaceConnection
 */
export interface WorkspaceBindingEnvironment {
 /** Read the canonical verified identity hook; null while unavailable. */
 useIdentity:()=>WorkspaceBindingIdentity|null
 /** Configured credentialed transport. */
 api:WorkspaceApi
 /** Explicit build adoption; never the whole installed catalog by default. */
 selectedIds:readonly string[]
 /** Selected data-only reference list declarations. */
 referenceCatalog?:readonly WorkspaceReferenceDeclaration[]
 /** Router-owned query access; returns the search string and replaces it explicitly. */
 query:{
  /** Read current URL search text. */
  read:()=>string
  /** Replace URL search text through the Host router/history. */
  replace:(search:string)=>void
 }
}
/** A feature's connected, browser-only workspace route.
 * @see useWorkspaceConnection
 */
export interface ConnectedWorkspacePage {
 /** Canonical feature owner. */
 pluginId:string
 /** Declared application route. */
 path:string
 /** Owner-provided navigation fallback. */
 label:string
 /** Connected component, still wrapped in live WorkspaceFeatureBoundary admission. */
 component:ComponentType
}
/** Cancellable request capabilities tied to one committed workspace identity.
 * @see useWorkspaceConnection
 */
export interface WorkspaceConnection extends WorkspaceApi {
 /** Current verified identity, or null while unavailable. */
 identity:WorkspaceBindingIdentity|null
 /** Aborted on scope change/unmount; remote effects may already have completed. */
 readonly signal:AbortSignal
}
/** Bind API calls to the current verified Host identity and selected/live feature grants.
 * @param environment - Canonical Host context hook and explicit browser capabilities.
 * @returns Scoped requests, identity and cancellation signal, without storing snapshots.
 * @throws Request methods reject unavailable identities, unadopted/revoked owners and expired results.
 * @remarks Use inside connected page components. Owners still validate DTOs; backend authorization is mandatory.
 * @example
 * import {useWorkspaceConnection,type WorkspaceBindingEnvironment} from '@alneas/eaos-react/workspace-binding'
 * export function useReports(environment:WorkspaceBindingEnvironment){return useWorkspaceConnection(environment)}
 */
export function useWorkspaceConnection(environment:WorkspaceBindingEnvironment):WorkspaceConnection {
 const identity=environment.useIdentity()
 const key=JSON.stringify([identity?.tenantId,identity?.userId,identity?.sessionKey,identity?.roles,identity?.enabledPluginIds,environment.selectedIds])
 const session=useRequestLifetime(environment.api,key)
 return useMemo(()=>{
  const selected=new Set(environment.selectedIds),enabled=new Set(identity?.enabledPluginIds)
  const call=async<T,>(pluginId:string,signal:AbortSignal|undefined,execute:(signal:AbortSignal)=>Promise<T>):Promise<T>=>{
   if(!identity?.tenantId||!identity.userId||!identity.sessionKey||!session.active||!selected.has(pluginId)||!enabled.has(pluginId))throw Error('Workspace feature is unavailable')
   const controller=session.controller,combined=signal?AbortSignal.any([controller.signal,signal]):controller.signal
   combined.throwIfAborted()
   const result=await execute(combined)
   combined.throwIfAborted()
   if(!session.active)throw Error('Workspace response belongs to an expired session')
   return result
  }
  return {
   identity,
   get signal(){return session.controller.signal},
   request:<T=unknown>(input:WorkspaceApiRequest)=>call(input.pluginId,input.signal,signal=>environment.api.request<T>({...input,signal})),
   command:<T=unknown>(input:WorkspaceApiCommand)=>call(input.pluginId,input.signal,signal=>environment.api.command<T>({...input,signal})),
  }
 },[session,environment.api,key])
}

export {composeWorkspacePages,type WorkspaceFactoryOptions,type WorkspacePageDeclaration} from './workspace-binding/composition'
