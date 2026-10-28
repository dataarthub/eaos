import type {Context,Hono,MiddlewareHandler} from 'hono'
import type {EaosEnv,PluginManifest} from '@alneas/eaos-core'
import type {CreateAppOptions} from '../engine'
import type {AuthSessionVerifier} from '../middleware/auth'
import type {HostRouteFactory,PlatformExtension,resolveClientPlugins as resolveClientPluginContext} from '../extensions'
import type {WorkspaceContextStore} from '../workspace-context'
import type {LifecycleRuntime} from '../lifecycle'
import type {PluginEntitlementRuntime,EntitlementPrincipalResolver} from '../entitlements'

/** Executable tool surface supplied by the trusted owning feature binder.
 * @see createHostMcpToolContext
 */
export interface HostBoundPlugin {
 /** Owning tools; absence rejects binding rather than falling back to static metadata. */
 mcp?:PluginManifest['mcp']
}
/** Current-request bridge and executable capabilities for selected MCP features.
 * @see createHostMcpToolContext
 */
export interface HostMcpBindingOptions {
 /** Exact selected feature IDs, copied at composition. */
 pluginIds:readonly string[]
 /** Bind the verified request to its owning feature; a denial Response is never executed. */
 bindPlugin:(context:Context,pluginId:string)=>Promise<HostBoundPlugin|Response|undefined>
 /** Trusted request-local context storage; never use one shared mutable variable. */
 requestContext:{
  /** Obtain this asynchronous request's context; missing scope must reject. */
  current:()=>Context
  /** Associate a verified MCP request with the current Host request scope. */
  bind:(context:Context)=>void
 }
}
/** Explicit adopted metadata and live licensing capabilities; omission never reads environment.
 * @see createStandardHostPolicy
 */
export interface StandardHostPolicyOptions {
 /** Reviewed catalog; contributed extension manifests are appended and validated. */
 manifests:readonly PluginManifest[]
 /** Explicit subset in requested order; undefined uses the supplied set, while [] adopts nothing. */
 pluginIds?:readonly string[]
 /** Executable bindings for known catalog IDs, never overrides of an extension's factory. */
 routeFactories?:Readonly<Record<string,HostRouteFactory>>
 /** Known features whose static tool declarations dispatch through the current request binder. */
 mcpPluginIds?:readonly string[]
 /** Already acquired trusted contributions with explicit tenant restrictions. */
 extensions?:readonly PlatformExtension[]
 /** Read current licensing keys for the verified tenant; failures propagate. */
 loadEnabledModules:(tenantId:string)=>Promise<string[]>
 /** Legacy module keys explicitly accepted by each feature. */
 moduleAliases?:Record<string,string[]>
 /** Exact paths and descendants where an alias/module guard applies. */
 routePrefixes?:Record<string,string[]>
 /** Explicit Host policy only; absent means no bypass in any environment. */
 bypass?:(context:Context)=>boolean
}
/** Selected catalog and canonical live module policy for one Host instance.
 * @see createStandardHostPolicy
 */
export interface StandardHostPolicy {
 /** Fresh selected manifests; implementations remain trusted callable references. */
 readonly manifests:readonly PluginManifest[]
 /** Populate current tenant module context after verified membership. */
 readonly entitlementMiddleware:MiddlewareHandler<EaosEnv>
 /** Construct the existing module licensing guard for one feature. */
 readonly requireModule:(pluginId:string)=>MiddlewareHandler<EaosEnv>
 /** Map live licensing keys to selected feature IDs only. */
 readonly enabledPluginIds:(enabledModules:string[])=>string[]
 /** Host's live licensing lookup; no database or environment fallback is invented. */
 readonly loadEnabledModules:(tenantId:string)=>Promise<string[]>
}
/** Resolved startup services passed to the Host-owned entitlement runtime factory.
 * @see createStandardHost
 */
export interface StandardHostRuntimeInput {
 /** Selected module policy for this Host instance. */
 readonly policy:StandardHostPolicy
 /** The final selected catalog, including tenant-constrained contributions. */
 readonly manifests:readonly PluginManifest[]
 /** Resolved Lifecycle runtime; absence never means active. */
 readonly lifecycle:LifecycleRuntime|undefined
 /** Check the tenant's current resolved backend activation; false without a runtime. */
 readonly isPluginEnabled:(tenantId:string,pluginId:string)=>Promise<boolean>
}
/** Completed runtime capabilities for application routes and separately mounted public gateways.
 * @see createStandardHost
 */
export interface StandardHostContext extends StandardHostRuntimeInput {
 /** Real injected entitlement runtime; persistence remains owned by its Host adapter. */
 readonly entitlements:PluginEntitlementRuntime
 /** Read the canonical request authorization port again; null denies access. */
 readonly resolvePrincipal:EntitlementPrincipalResolver
 /** Existing safe client projection helper; visibility alone grants no API permission. */
 readonly resolveClientPlugins:typeof resolveClientPluginContext
}
/** Authenticated Host startup inputs; provider connections and persistence remain injected.
 * @see createStandardHost
 */
export interface StandardHostOptions {
 /** Application presentation and shared HTTP setup. */
 app:{
  /** Nonblank health/application label; opens no listener. */
  name:string
  /** Exact trusted browser origins, copied into existing Engine CORS settings. */
  corsOrigins?:readonly string[]
  /** Existing authentication-exempt path prefixes; omission preserves Engine defaults. */
  authSkipPaths?:readonly string[]
  /** Optional value of the fixed X-EAOS-Release response header. */
  releaseVersion?:string
  /** Readiness checks and clock; concrete dependency probes remain Host-owned. */
  health?:CreateAppOptions['health']
  /** Preserve Engine secret validation unless explicitly false. */
  validateSecrets?:boolean
 }
 /** Effective generated catalog, selected subset and executable capabilities. */
 adoption:Omit<StandardHostPolicyOptions,'loadEnabledModules'|'moduleAliases'|'routePrefixes'|'bypass'>
 /** Required real credential verifier and verified tenant membership adapter. */
 auth:{
  /** Trusted verifier of sessions and optional API keys. */
  verifier:AuthSessionVerifier
  /** Resolve tenant membership after authentication; never trust browser role claims. */
  membership:MiddlewareHandler<EaosEnv>
 }
 /** Current persistence/admission capabilities; startup does not connect to a database. */
 admission:{
  /** Return the current membership store for principal revalidation. */
  store:()=>WorkspaceContextStore
  /** Read current tenant module licensing keys. */
  loadEnabledModules:StandardHostPolicyOptions['loadEnabledModules']
  /** Explicit legacy license aliases. */
  moduleAliases?:Record<string,string[]>
  /** Paths to which specific module guards apply. */
  routePrefixes?:Record<string,string[]>
  /** Explicit development/custom policy; no ambient environment grants are supplied. */
  bypass?:StandardHostPolicyOptions['bypass']
 }
 /** Host-owned services constructed after metadata validation. */
 runtime:{
  /** Resolve the existing backend/tenant Lifecycle capabilities, without activating tenants. */
  loadLifecycle:()=>Promise<LifecycleRuntime|undefined>
  /** Construct entitlement persistence/runtime using the already resolved startup context. */
  createEntitlements:(context:StandardHostRuntimeInput)=>Promise<PluginEntitlementRuntime>|PluginEntitlementRuntime
 }
 /** Required when effective selected MCP IDs are nonempty; never supplies an implicit identity. */
 mcp?:Omit<HostMcpBindingOptions,'pluginIds'>
 /** Application routers built with completed services; each retains its own route-specific authorization. */
 createRoutes?:(context:StandardHostContext)=>Promise<NonNullable<CreateAppOptions['customRoutes']>>|NonNullable<CreateAppOptions['customRoutes']>
}
/** A fully composed app; creating it never opens a listener or activates tenants.
 * @see createStandardHost
 */
export interface StandardHostResult {
 /** Composed authenticated app; the Host owns process fetch/listener and any public gateway. */
 app:Hono<EaosEnv>
 /** Resolved capabilities for additional Host composition. */
 context:StandardHostContext
}
