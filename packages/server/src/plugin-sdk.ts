import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { DefinedPlugin, PluginContext, PlatformPrincipal } from '@alneas/eaos-core'
import { assertPlatformPrincipal } from '@alneas/eaos-core'
import { createPluginEntitlementGuard, type EntitlementPrincipalResolver, type PluginEntitlementRuntime } from './entitlements/index'

/**
 * Host authentication, live admission, and scoped capabilities injected into {@link createSdkPluginRouter}.
 */
export interface PluginSdkHost {
  /** Resolves a verified current principal for each invocation, or null to deny; may be invoked multiple times in one request. */
  resolvePrincipal: EntitlementPrincipalResolver
  /** Mandatory live lifecycle/resource gate, independent of commercial licensing. */
  authorize: (principal: PlatformPrincipal, pluginId: string, operation: string) => Promise<boolean>
  /** Optional subscription/quota runtime; required when the plugin declares a rule needing external entitlement admission. */
  entitlements?: PluginEntitlementRuntime
  /** Must return tenant/plugin-scoped app-core/EAOS capabilities with per-operation authorization. */
  createContext: (principal: PlatformPrincipal, pluginId: string) => Promise<Omit<PluginContext<any>, 'principal' | 'pluginId'>>
}
/**
 * Mounts defined plugin routes behind host authentication, live authorization, and optional entitlement admission.
 * @param plugin - Trusted defined plugin containing route methods, paths, handlers, and optional entitlement policy.
 * @param host - Verified principal resolution, lifecycle/resource authorization, and tenant/plugin-scoped capability factory.
 * @returns A Hono router with a 1 MiB body limit; GET/DELETE inputs are query parameter objects, other methods require JSON input.
 * @throws Request handling propagates host, entitlement, context, and handler failures except malformed JSON/auth/admission responses explicitly returned by the router.
 * @remarks Authorization runs before route handling and again after asynchronous context creation. The verified principal/plugin scope overwrites factory dependencies, but the host must enforce scope inside supplied capabilities. Metered entitlement admission can count requests whose later body parsing or handler fails. No transactions, retries, rollback, or idempotency are supplied around handlers.
 * @example
 * ```typescript
 * import { createSdkPluginRouter, type PluginSdkHost } from "@alneas/eaos-server/plugin-sdk";
 * import type { DefinedPlugin } from "@alneas/eaos-core";
 * export function pluginRouter(plugin: DefinedPlugin, host: PluginSdkHost) {
 *   return createSdkPluginRouter(plugin, host);
 * }
 * ```
 */
export function createSdkPluginRouter(plugin: DefinedPlugin, host: PluginSdkHost): Hono {
  const app = new Hono()
  app.use('*', bodyLimit({ maxSize: 1024 * 1024 }))
  app.use('*', async (c, next) => {
    const p = await host.resolvePrincipal(c)
    if (!p) return c.json({ error: 'Unauthorized' }, 401)
    assertPlatformPrincipal(p)
    if (!await host.authorize(p, plugin.id, `${c.req.method} ${c.req.path}`)) return c.json({ error: 'Plugin unavailable' }, 404)
    await next()
  })
  if (plugin.entitlement) app.use('*', createPluginEntitlementGuard(plugin.id, plugin.entitlement, host.entitlements, host.resolvePrincipal))
  for (const route of plugin.routeDefinitions) app.on(route.method, route.path, async c => {
    const p = await host.resolvePrincipal(c)
    if (!p) return c.json({ error: 'Unauthorized' }, 401)
    assertPlatformPrincipal(p)
    const dependencies = await host.createContext(p, plugin.id)
    if (!await host.authorize(p, plugin.id, `${c.req.method} ${c.req.path}`)) return c.json({ error: 'Plugin unavailable' }, 404)
    // Factories cannot overwrite the verified scope. They may not return request-selected tenants.
    const entitlements = await host.entitlements?.snapshot(p) ?? null
    const ctx: PluginContext = Object.freeze({ ...dependencies, pluginId: plugin.id, principal: Object.freeze({ ...p, roles: Object.freeze([...p.roles]), entitlements }) })
    let input: unknown = Object.fromEntries(new URL(c.req.url).searchParams)
    if (route.method !== 'GET' && route.method !== 'DELETE') {
      if (!/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')) return c.json({ error: 'JSON body required' }, 415)
      try { input = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
    }
    return c.json(await route.handler(ctx, input))
  })
  return app
}
