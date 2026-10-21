import type { DataAccessAdapter, StorageAdapter } from '../adapters/types'
import type { PlatformPrincipal } from '../security/platform-security'
import { assertPluginEntitlement, type PluginEntitlement, type TenantEntitlements } from './entitlements'

/**
 * Admitted plugin identity and host-scoped capabilities provided to route handlers.
 * @see {@link definePlugin}
 * @typeParam TServices - Host services available to admitted route handlers; defaults to a record of unknown values.
 */
export interface PluginContext<TServices = Record<string, unknown>> {
  
/** Owning plugin identity used for capability scope and discovery. */
  readonly pluginId: string
  
  /** Readonly host-verified user/tenant role claims plus live subscription snapshot for an admitted plugin request. */
  readonly principal: Readonly<PlatformPrincipal> & { 
  /** Trusted tenant subscription snapshot, or null when unavailable; callers must not derive authorization from browser state. */
  readonly entitlements: TenantEntitlements | null }
  /** Host-scoped app-core adapter; table/resource permissions are checked on each operation. */
  readonly db: DataAccessAdapter
  /** Scoped app-core storage adapter, supplied through createTenantStorage. */
  readonly storage: StorageAdapter
  
  /** Host secret capability or declarations; Core does not provision an external secret store. */
  readonly secrets: { 
  /**
   * Resolve a secret through the admitted plugin host scope.
   * @param key - Host-approved secret lookup key.
   * @returns Resolved secret text; callers must not log or expose it.
   * @throws Host capability errors reject; persistence/effect failures can have uncertain outcomes.
   * @remarks Requires an admitted, connected host PluginContext. Host owns tenant access, persistence, deadlines, retries and capability cleanup.
   * @example
   * ```typescript
   * import type { PluginContext } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * async function readHostSecret(ctx: PluginContext) { return ctx.secrets.get("service-key"); }
   * ```
   */
  get(key: string): Promise<string> }
  
  /** Host-scoped job enqueue capability returning the accepted job identity. */
  readonly jobs: { 
  /**
   * Enqueue a host job under admitted plugin scope.
   * @param name - Registered host job identity.
   * @param input - Domain job input validated by the host.
   * @returns Accepted host job identity; enqueue completion is not job execution completion.
   * @throws Host capability errors reject; persistence/effect failures can have uncertain outcomes.
   * @remarks Requires an admitted, connected host PluginContext. Host owns tenant access, persistence, deadlines, retries and capability cleanup.
   * @example
   * ```typescript
   * import type { PluginContext } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * async function queueHostJob(ctx: PluginContext) { return ctx.jobs.enqueue("review", { documentId: "document-1" }); }
   * ```
   */
  enqueue(name: string, input: unknown): Promise<string> }
  
  
  /** Host-scoped inbound verification capability; provider authentication/freshness policy remains host-owned. */
  readonly webhooks: { 
  /**
   * Verify an inbound webhook through the scoped host provider.
   * @param name - Registered host webhook verifier identity.
   * @param request - Original inbound Request; host owns body-reading and signature/freshness policy.
   * @returns Whether host webhook verification succeeds.
   * @throws Host capability errors reject; persistence/effect failures can have uncertain outcomes.
   * @remarks Requires an admitted, connected host PluginContext. Host owns tenant access, persistence, deadlines, retries and capability cleanup.
   * @example
   * ```typescript
   * import type { PluginContext } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * async function verifyHostWebhook(ctx: PluginContext, request: Request) { return ctx.webhooks.verify("provider", request); }
   * ```
   */
  verify(name: string, request: Request): Promise<boolean> }
  
  /** Host-scoped durable audit capability; handlers await record completion when audit durability is required. */
  readonly audit: { 
  /**
   * Append a plugin audit action through the scoped host capability.
   * @param action - Host-recognized action identity.
   * @param metadata - Readonly sanitized contextual metadata; exclude credentials and sensitive bodies.
   * @returns No value; the host audit append has completed.
   * @throws Host capability errors reject; persistence/effect failures can have uncertain outcomes.
   * @remarks Requires an admitted, connected host PluginContext. Host owns tenant access, persistence, deadlines, retries and capability cleanup.
   * @example
   * ```typescript
   * import type { PluginContext } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * async function recordHostAudit(ctx: PluginContext) { await ctx.audit.record("notes.preview", { count: 0 }); }
   * ```
   */
  record(action: string, metadata: Readonly<Record<string, unknown>>): Promise<void> }
  
  
  /** Host-scoped typed service container supplied only after plugin admission. */
  readonly services: TServices
}
/**
 * Route callback receiving scoped capabilities and decoded input; execution timing and input validation belong to the host.
 * @see {@link definePlugin}
 * @typeParam TInput - Decoded route input expected by the handler; default unknown and runtime validation remains host-owned.
 * @typeParam TServices - Host service container shape; defaults to a record of unknown values.
 * @param ctx - Admitted plugin context with host-scoped capabilities; host owns setup/disposal and live authorization.
 * @param input - Decoded request input after host parsing; validate its domain schema before side effects.
 * @returns Domain response directly or via Promise; the host decides HTTP serialization. Handler errors/rejections propagate to host execution.
 * @example
 * ```typescript
 * import type { PluginRouteHandler } from "@alneas/eaos-core/plugin-sdk/define-plugin";
 * const handler: PluginRouteHandler<{ title: string }> = (_ctx, input) => ({ title: input.title });
 * ```
 */
export type PluginRouteHandler<TInput = unknown, TServices = Record<string, unknown>> = (ctx: PluginContext<TServices>, input: TInput) => unknown | Promise<unknown>
/**
 * One captured HTTP method, plugin-relative path and handler.
 * @see {@link definePlugin}
 */
export interface PluginRoute {
  
  /** HTTP method captured during synchronous route registration. */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  
  /** Plugin-relative URL path; allows simple alphanumeric/underscore/colon/hyphen segments without query strings. */
  path: string
  
  /**
   * Captured route callback retained for later admitted host dispatch.
   * @param ctx - Host-scoped plugin capabilities installed after admission.
   * @param input - Decoded route input validated by the host/handler.
   * @returns Domain response directly or asynchronously; the host decides serialization.
   * @see {@link definePlugin}
   *
   * @example
   * ```typescript
   * import type { PluginRoute, PluginContext } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * async function invokeAdmittedRoute(route: PluginRoute, ctx: PluginContext, validatedInput: unknown) {
   *  return route.handler(ctx, validatedInput);
   * }
   * ```
   */
  handler: PluginRouteHandler<any, any>
}
/**
 * Synchronous registration surface for plugin HTTP routes.
 * @see {@link definePlugin}
 * @typeParam TServices - Host service container shared by registered handlers; default record of unknown values.
 */
export interface PluginRouteBuilder<TServices = Record<string, unknown>> {
  
  /**
   * Register a GET route during synchronous plugin definition.
   * @typeParam T - Decoded request input shape expected by the handler; defaults to unknown and requires host validation.
   * @param path - Plugin-relative path with simple alphanumeric/underscore/colon/hyphen segments; duplicate method/path pairs are rejected.
   * @param handler - Callback retained until host dispatch; receives admitted context and decoded input, returns a response or Promise. Not invoked during registration.
   * @returns No value; the route is collected and later frozen by definePlugin.
   * @throws Error for invalid path/nonfunction handler or duplicate method/path.
   * @remarks The builder is supplied only while definePlugin runs; host mounting, input validation and handler authorization are separate.
   * @example
   * ```typescript
   * import { definePlugin } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * const plugin = definePlugin({ id: "notes", routes(router) { router.get("/preview", (_ctx, input) => ({ input })); } });
   * console.log(plugin.routeDefinitions.length); // 1
   * ```
   */
  get<T = unknown>(path: string, handler: PluginRouteHandler<T, TServices>): void
  
  /**
   * Register a POST route during synchronous plugin definition.
   * @typeParam T - Decoded request input shape expected by the handler; defaults to unknown and requires host validation.
   * @param path - Plugin-relative path with simple alphanumeric/underscore/colon/hyphen segments; duplicate method/path pairs are rejected.
   * @param handler - Callback retained until host dispatch; receives admitted context and decoded input, returns a response or Promise. Not invoked during registration.
   * @returns No value; the route is collected and later frozen by definePlugin.
   * @throws Error for invalid path/nonfunction handler or duplicate method/path.
   * @remarks The builder is supplied only while definePlugin runs; host mounting, input validation and handler authorization are separate.
   * @example
   * ```typescript
   * import { definePlugin } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * const plugin = definePlugin({ id: "notes", routes(router) { router.post("/preview", (_ctx, input) => ({ input })); } });
   * console.log(plugin.routeDefinitions.length); // 1
   * ```
   */
  post<T = unknown>(path: string, handler: PluginRouteHandler<T, TServices>): void
  
  /**
   * Register a PUT route during synchronous plugin definition.
   * @typeParam T - Decoded request input shape expected by the handler; defaults to unknown and requires host validation.
   * @param path - Plugin-relative path with simple alphanumeric/underscore/colon/hyphen segments; duplicate method/path pairs are rejected.
   * @param handler - Callback retained until host dispatch; receives admitted context and decoded input, returns a response or Promise. Not invoked during registration.
   * @returns No value; the route is collected and later frozen by definePlugin.
   * @throws Error for invalid path/nonfunction handler or duplicate method/path.
   * @remarks The builder is supplied only while definePlugin runs; host mounting, input validation and handler authorization are separate.
   * @example
   * ```typescript
   * import { definePlugin } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * const plugin = definePlugin({ id: "notes", routes(router) { router.put("/preview", (_ctx, input) => ({ input })); } });
   * console.log(plugin.routeDefinitions.length); // 1
   * ```
   */
  put<T = unknown>(path: string, handler: PluginRouteHandler<T, TServices>): void
  
  /**
   * Register a PATCH route during synchronous plugin definition.
   * @typeParam T - Decoded request input shape expected by the handler; defaults to unknown and requires host validation.
   * @param path - Plugin-relative path with simple alphanumeric/underscore/colon/hyphen segments; duplicate method/path pairs are rejected.
   * @param handler - Callback retained until host dispatch; receives admitted context and decoded input, returns a response or Promise. Not invoked during registration.
   * @returns No value; the route is collected and later frozen by definePlugin.
   * @throws Error for invalid path/nonfunction handler or duplicate method/path.
   * @remarks The builder is supplied only while definePlugin runs; host mounting, input validation and handler authorization are separate.
   * @example
   * ```typescript
   * import { definePlugin } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * const plugin = definePlugin({ id: "notes", routes(router) { router.patch("/preview", (_ctx, input) => ({ input })); } });
   * console.log(plugin.routeDefinitions.length); // 1
   * ```
   */
  patch<T = unknown>(path: string, handler: PluginRouteHandler<T, TServices>): void
  
  /**
   * Register a DELETE route during synchronous plugin definition.
   * @typeParam T - Decoded request input shape expected by the handler; defaults to unknown and requires host validation.
   * @param path - Plugin-relative path with simple alphanumeric/underscore/colon/hyphen segments; duplicate method/path pairs are rejected.
   * @param handler - Callback retained until host dispatch; receives admitted context and decoded input, returns a response or Promise. Not invoked during registration.
   * @returns No value; the route is collected and later frozen by definePlugin.
   * @throws Error for invalid path/nonfunction handler or duplicate method/path.
   * @remarks The builder is supplied only while definePlugin runs; host mounting, input validation and handler authorization are separate.
   * @example
   * ```typescript
   * import { definePlugin } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * const plugin = definePlugin({ id: "notes", routes(router) { router.delete("/preview", (_ctx, input) => ({ input })); } });
   * console.log(plugin.routeDefinitions.length); // 1
   * ```
   */
  delete<T = unknown>(path: string, handler: PluginRouteHandler<T, TServices>): void
}
/**
 * Input metadata and synchronous route-registration callback for definePlugin.
 * @see {@link definePlugin}
 * @typeParam TServices - Host service container exposed to registered handlers; default record of unknown values.
 */
export interface PluginDefinition<TServices = Record<string, unknown>> {
  
  /** Lowercase plugin ID beginning with a letter, followed by letters/digits/hyphens, at most 128 characters. */
  id: string
  
  /** Optional plugin release version; definePlugin defaults it to 0.0.0. */
  version?: string
  
  /** Optional declared subscription/allowlist/metering policy; the server must enforce live admission. */
  entitlement?: PluginEntitlement
  
/** Required data-contract IDs mapped to accepted semver ranges. */
  schemaDependencies?: Readonly<Record<string, string>>
  
  /**
   * Register routes synchronously while definePlugin collects the definition.
   * @param router - Temporary builder; add method/path/handler entries during this call.
   * @returns No value; definePlugin freezes the collected route list after this callback returns.
   * @throws Registration errors propagate from definePlugin; asynchronous callbacks are not awaited.
   * @see {@link definePlugin}
   *
   * @example
   * ```typescript
   * import { definePlugin } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * const plugin = definePlugin({ id: "notes", routes(router) { router.get("/preview", () => ({ count: 0 })); } });
   * console.log(plugin.routeDefinitions.length); // 1
   * ```
   */
  routes: (router: PluginRouteBuilder<TServices>) => void
}
/**
 * Frozen plugin metadata with the collected route definitions replacing the registration callback.
 * @see {@link definePlugin}
 */
export interface DefinedPlugin extends Omit<PluginDefinition, 'routes'> { 
  /** Readonly collected method/path/handler records; definePlugin freezes the array and each route object. */
  readonly routeDefinitions: readonly PluginRoute[] }
/**
 * No server/database import: hosts supply connected capabilities after live admission.
 * @typeParam TServices - Host services exposed to handlers; defaults to a record of unknown values.
 * @param definition - Plugin metadata and a synchronous route-registration callback. Duplicate method/path pairs are rejected.
 * @returns Frozen metadata and route array; version defaults to 0.0.0, and entitlement/schema dependencies are copied.
 * @throws Error for invalid ID, entitlement, route or duplicate method/path; route-registration callback errors propagate.
 * @remarks Runs routes synchronously during definition. Does not mount handlers or connect database/storage; the host supplies scoped capabilities after admission.
 * @example
 * ```typescript
 * import { definePlugin } from "@alneas/eaos-core/plugin-sdk/define-plugin";
 * const plugin = definePlugin({ id: "notes", routes(router) { router.get("/status", () => ({ ready: true })); } });
 * console.log(plugin.routeDefinitions.length); // 1
 * ```
 */
export function definePlugin<TServices = Record<string, unknown>>(definition: PluginDefinition<TServices>): DefinedPlugin {
  if (!/^[a-z][a-z0-9-]{0,127}$/.test(definition.id)) throw Error('Invalid plugin ID')
  if (definition.entitlement) assertPluginEntitlement(definition.entitlement)
  const routes: PluginRoute[] = []
  const builder = Object.fromEntries(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => [method.toLowerCase(), (path: string, handler: PluginRouteHandler) => {
    if (!/^\/(?:[a-zA-Z0-9_:-]+\/?)*$/.test(path) || typeof handler !== 'function') throw Error('Invalid plugin route')
    if (routes.some(r => r.method === method && r.path === path)) throw Error('Duplicate plugin route')
    routes.push(Object.freeze({ method: method as PluginRoute['method'], path, handler }))
  }])) as unknown as PluginRouteBuilder<TServices>
  definition.routes(builder)
  return Object.freeze({ id: definition.id, version: definition.version ?? '0.0.0', entitlement: definition.entitlement && Object.freeze(structuredClone(definition.entitlement)), schemaDependencies: Object.freeze({ ...definition.schemaDependencies }), routeDefinitions: Object.freeze(routes) })
}
