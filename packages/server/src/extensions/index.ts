import { Hono, type Context, type MiddlewareHandler } from 'hono'
import type { PluginManifest } from '@alneas/eaos-core'
import type { PlatformContribution } from '@alneas/eaos-server/platform'
/**
 * Plugin-manifest route factory supplied by trusted deployment composition.
 * @see PlatformExtension.
 */
export type HostRouteFactory = NonNullable<PluginManifest['createRoutes']>

/**
 * Adds host route composition to a trusted platform contribution with explicit tenant scope.
 * @remarks Never populate this object from request input.
 * @see validateExtensions for a complete composition example.
 */
export interface PlatformExtension extends PlatformContribution {
  /** Plugin-ID factories for every contributed manifest; may not override plugins absent from this contribution. */
  routeFactories?: Record<string, HostRouteFactory>
  /** Optional host API routes with an absolute, wildcard-free prefix, nonblank moduleId, and Hono router. */
  routes?: Array<{
    /** Absolute wildcard-free mount prefix; overlapping tenant contributions may not claim the same prefix. */
    prefix: string
    /** Nonblank module identity passed to the host requireModule factory after the extension tenant-scope check. */
    moduleId: string
    /** Trusted Hono child router wrapped with tenant-scope and live host module middleware during extension composition. */
    router: Hono
  }>
  /** Optional request context resolver; contributions using it may not overlap tenant scope. Its result/authorization semantics belong to the host. */
  userContext?: (context: Context) => Promise<unknown>
}

/**
 * Checks trusted extension shapes, IDs, route factories, and conflicting tenant/user-context contributions.
 * @param values - Deployment module values to validate; request input must not supply implementations.
 * @returns A new array containing the original validated objects; no deep clone or sandboxing occurs.
 * @throws For invalid version/ID/explicit tenant scopes, duplicate extension/plugin IDs, overlapping userContext tenant scopes, invalid routes, or missing/unauthorized route factories.
 * @remarks Independent plugins can share tenants. This validates composition constraints, not manifest internals or implementation safety.
 * @example
 * ```typescript
 * import { validateExtensions } from "@alneas/eaos-server/extensions";
 * const extensions = validateExtensions([{ apiVersion: 1, id: "example", tenantIds: ["example"] }]);
 * console.log(extensions.length); // 1
 * ```
 */
export function validateExtensions(values: unknown[]): PlatformExtension[] {
  const ids = new Set<string>()
  const plugins = new Set<string>()
  const tenants = new Set<string>()
  return values.map(value => {
    const item = value as PlatformExtension
    if (!item || item.apiVersion !== 1 || typeof item.id !== 'string' || !item.id.trim()
      || !Array.isArray(item.tenantIds) || !item.tenantIds.length
      || item.tenantIds.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim() || id === '*')
      || (item.manifests !== undefined && !Array.isArray(item.manifests))
      || (item.lifecycle !== undefined && !Array.isArray(item.lifecycle))
      || (item.routes !== undefined && !Array.isArray(item.routes))) {
      throw new Error('Invalid platform extension: version, id and explicit tenantIds are required')
    }
    if (ids.has(item.id)) throw new Error(`Duplicate extension: ${item.id}`)
    ids.add(item.id)
    // Product identity overrides must remain unambiguous; independent plugins may share tenants.
    for (const tenant of item.userContext ? item.tenantIds : []) {
      if (tenants.has(tenant)) throw new Error(`Conflicting extension tenant: ${tenant}`)
      tenants.add(tenant)
    }
    for (const route of item.routes ?? []) {
      if (typeof route.prefix !== 'string' || !route.prefix.startsWith('/') || route.prefix.includes('*') || typeof route.moduleId !== 'string' || !route.moduleId.trim() || typeof route.router?.fetch !== 'function') throw new Error('Invalid extension route')
    }
    for (const manifest of item.manifests ?? []) {
      if (plugins.has(manifest.id)) throw new Error(`Duplicate extension plugin: ${manifest.id}`)
      plugins.add(manifest.id)
      if (typeof item.routeFactories?.[manifest.id] !== 'function') throw new Error(`Extension route factory required: ${manifest.id}`)
    }
    for (const id of Object.keys(item.routeFactories ?? {})) {
      if (!(item.manifests ?? []).some(manifest => manifest.id === id)) throw new Error(`Extension cannot override an official route factory: ${id}`)
    }
    return item
  })
}

/**
 * Wraps each contributed plugin route factory with an explicit tenant-scope middleware.
 * @param item - Trusted validated extension; tenantIds is consulted at request time.
 * @returns A shallow copy with fresh route factory wrappers; each wrapper invokes the original factory with unchanged arguments.
 * @throws Calling a wrapped factory propagates the original route-factory errors.
 * @remarks Set trusted tenantId context before handling requests. Out-of-scope or missing tenantId returns 403. This wrapper performs no membership or module authorization.
 * @example
 * ```typescript
 * import { scopeExtensionFactories, validateExtensions } from "@alneas/eaos-server/extensions";
 * const [extension] = validateExtensions([{ apiVersion: 1, id: "example", tenantIds: ["example"] }]);
 * const scoped = scopeExtensionFactories(extension);
 * console.log(scoped.id);
 * ```
 */
export function scopeExtensionFactories(item: PlatformExtension): PlatformExtension {
  return { ...item, routeFactories: Object.fromEntries(Object.entries(item.routeFactories ?? {}).map(([id, factory]) => [id, (...args: Parameters<HostRouteFactory>) => {
    const router = new Hono()
    router.use('*', async (context: Context, next) => {
      if (!item.tenantIds.includes(String(context.get('tenantId') ?? ''))) return context.json({ error: 'Tenant unavailable' }, 403)
      return next()
    })
    return router.route('/', factory(...args))
  }])) }
}

/**
 * Wraps contributed host routers with tenant-scope checks followed by host module authorization.
 * @param extension - Trusted validated contribution; omitted routes produce an empty array.
 * @param requireModule - Called once per route with moduleId during composition; returns middleware enforcing current module permissions.
 * @returns New prefix/router pairs preserving original route order and mounting original routers beneath their guards.
 * @throws Propagates module middleware factory or route composition errors; request execution propagates downstream failures.
 * @remarks Requires a verified tenantId in Hono context. No authentication is installed here.
 * @example
 * ```typescript
 * import { scopeExtensionRoutes, validateExtensions } from "@alneas/eaos-server/extensions";
 * import { createModuleGuard } from "@alneas/eaos-server/middleware/module-guard";
 * const [extension] = validateExtensions([{ apiVersion: 1, id: "example", tenantIds: ["example"] }]);
 * console.log(scopeExtensionRoutes(extension, id => createModuleGuard(id, { isDev: false }))); // []
 * ```
 */
export function scopeExtensionRoutes(
  extension: PlatformExtension,
  requireModule: (moduleId: string) => MiddlewareHandler,
): Array<{
  /**
 * Original host route prefix preserved for subsequent mounting.
 */
prefix: string;
  /**
 * Fresh Hono wrapper enforcing tenant scope and host module authorization before forwarding to the original router.
 */
router: Hono }> {
  return (extension.routes ?? []).map(route => {
    const router = new Hono()
    router.use('*', async (context: Context, next) => {
      if (!extension.tenantIds.includes(String(context.get('tenantId') ?? ''))) return context.json({ error: 'Tenant unavailable' }, 403)
      return next()
    })
    router.use('*', requireModule(route.moduleId))
    router.route('/', route.router)
    return { prefix: route.prefix, router }
  })
}


/**
 * Mounts tenant-dispatched extension routes, allowing a shared prefix across disjoint tenant scopes.
 * @param app - Host Hono app mutated with exact-prefix and descendant dispatch routes.
 * @param extensions - Trusted validated extensions with explicit tenant IDs.
 * @param requireModule - Host factory producing current module authorization middleware for each route moduleId.
 * @returns No value; completes after mounting all route groups.
 * @throws For an overlapping tenant at the same prefix, or propagated route/middleware composition errors.
 * @remarks Install verified identity/tenant middleware before these routes. Dispatch copies parent context variables into the selected child and forwards server environment; missing tenant scope returns 403. There is no automatic route unmount or per-request persistence.
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import { mountExtensionRoutes, type PlatformExtension } from "@alneas/eaos-server/extensions";
 * import { createModuleGuard } from "@alneas/eaos-server/middleware/module-guard";
 * export function mount(app: Hono, extensions: PlatformExtension[]) {
 *   mountExtensionRoutes(app, extensions, id => createModuleGuard(id, { isDev: false }));
 * }
 * ```
 */
export function mountExtensionRoutes(app: Hono, extensions: PlatformExtension[], requireModule: (id: string) => MiddlewareHandler): void {
  const groups = new Map<string, Array<{ tenantIds: string[]; router: Hono }>>()
  for (const extension of extensions) for (const route of scopeExtensionRoutes(extension, requireModule)) {
    const group = groups.get(route.prefix) ?? []
    if (group.some(item => item.tenantIds.some(tenant => extension.tenantIds.includes(tenant)))) throw new Error('Conflicting extension API prefix for tenant')
    group.push({ tenantIds: extension.tenantIds, router: route.router })
    groups.set(route.prefix, group)
  }
  for (const [prefix, candidates] of groups) {
    const dispatch: MiddlewareHandler = async context => {
      const tenantId = String(context.get('tenantId') ?? '')
      const selected = candidates.find(item => item.tenantIds.includes(tenantId))
      if (!selected) return context.json({ error: 'Tenant unavailable' }, 403)
      const child = new Hono<{ Variables: Record<string, unknown> }>()
      child.use('*', async (nested, next) => {
        // Preserve verified parent state without putting it in client-controlled headers/body.
        for (const [key, value] of Object.entries(context.var)) nested.set(key, value)
        return next()
      })
      child.route(prefix, selected.router)
      return child.fetch(context.req.raw, context.env)
    }
    app.all(prefix, dispatch)
    app.all(prefix.replace(/\/$/, '') + '/*', dispatch)
  }
}

/** Request-scoped host authorization supplied after verified membership middleware.
 * @see getPlatformPluginAuthorization for binding lookup and a usage example.
 */
export interface PlatformPluginAuthorization {
  /**
   * Resolves the current verified principal after host authentication/membership checks.
   * @returns Tenant/user identity, verified roles, and current enabled plugin IDs, or null to deny.
   * @throws Host authentication or persistence failures propagate to callers.
   
   * @example
   * ```typescript
   * import type { PlatformPluginAuthorization } from "@alneas/eaos-server/extensions";
   * export async function readHostPrincipal(authorization: PlatformPluginAuthorization) {
   *   const principal = await authorization.resolvePrincipal();
   *   return principal; // Null denies access; never replace it with request-supplied claims.
   * }
   * ```
   */
  resolvePrincipal(): Promise<{ 
  /** Tenant identity established by trusted host authentication/membership resolution; request-supplied headers/body must not define this claim. */
  tenantId: string; 
  /** Authenticated user identity within the resolved tenant scope. */
  userId: string; 
  /** Verified host role claims used for downstream authorization; tenant roles must not fabricate platform authority. */
  roles: string[]; 
  /** Current plugin activation identities visible to this verified principal; the host supplies live lifecycle data. */
  enabledPluginIds: string[] } | null>
  /**
   * Checks live plugin activation for a verified tenant.
   * @param tenantId - Verified tenant ID.
   * @param pluginId - Exact installed plugin ID.
   * @returns True only when the plugin is currently enabled for this tenant.
   * @throws Host lifecycle/persistence failures propagate to callers.
   
   * @example
   * ```typescript
   * import type { PlatformPluginAuthorization } from "@alneas/eaos-server/extensions";
   * export async function checkCurrentPlugin(
   *   authorization: PlatformPluginAuthorization, verifiedTenantId: string, installedPluginId: string,
   * ) {
   *   return await authorization.isPluginEnabled(verifiedTenantId, installedPluginId);
   * }
   * ```
   */
  isPluginEnabled(tenantId: string, pluginId: string): Promise<boolean>
}
/**
 * Hono variable/environment key for the host-only {@link PlatformPluginAuthorization} binding.
 * @see getPlatformPluginAuthorization for access behavior.
 */
export const PLATFORM_PLUGIN_AUTHORIZATION = 'eaosPlatformPluginAuthorization'

/**
 * Reads a structurally valid host authorization port from Hono context or server environment.
 * @param context - Hono-like context; get(bindingKey) takes precedence over env[bindingKey] when nonnull. Missing contexts return undefined.
 * @returns The original port when both required members are functions, or undefined otherwise.
 * @throws Propagates errors thrown by the context get accessor.
 * @remarks Hono environment forwarding is internal-only; HTTP headers never supply this binding. Structural validation does not establish trust: only host middleware may install it.
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import { getPlatformPluginAuthorization } from "@alneas/eaos-server/extensions";
 * const app = new Hono();
 * app.get("/authorization-state", c => c.json({ configured: !!getPlatformPluginAuthorization(c) }));
 * ```
 */
export function getPlatformPluginAuthorization(context: unknown): PlatformPluginAuthorization | undefined {
  const c = context as { get?: (key: string) => unknown; env?: Record<string, unknown> } | undefined
  const binding = c?.get?.(PLATFORM_PLUGIN_AUTHORIZATION) ?? c?.env?.[PLATFORM_PLUGIN_AUTHORIZATION]
  if (!binding || typeof binding !== 'object') return undefined
  const port = binding as PlatformPluginAuthorization
  return typeof port.resolvePrincipal === 'function' && typeof port.isPluginEnabled === 'function' ? port : undefined
}
