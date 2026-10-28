import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { PluginManifest } from '@alneas/eaos-core'
import type { PluginPrincipal } from '../plugin-data'
import { createWorkspaceContextResolver, type WorkspaceContext, type WorkspaceContextStore } from '../workspace-context'
import { PLATFORM_PLUGIN_AUTHORIZATION, type HostRouteFactory, type PlatformExtension, type PlatformPluginAuthorization } from './index'

/** Current verified identity and live feature admission; never populate from request claims.
 * @see createPluginAuthorizationMiddleware
 */
export type HostPrincipal = PluginPrincipal & {
  /** Current feature identities supplied by trusted admission providers. */
  enabledPluginIds: readonly string[]
}

/** Trusted manifests and executable bindings selected by the application host.
 * @see createHostManifestCatalog
 */
export interface HostManifestCatalogOptions {
  /** Reviewed adopted feature metadata with unique identities. */
  manifests: PluginManifest[]
  /** Executable host bindings keyed by an adopted manifest identity. */
  routeFactories?: Record<string, HostRouteFactory>
  /** Feature IDs whose tools dispatch through the live host MCP port. */
  mcpPluginIds?: readonly string[]
}

/**
 * Compose metadata with explicitly supplied runtime and MCP bindings.
 * @param options - Host-selected manifests, route factories and MCP feature IDs.
 * @returns Fresh manifests without unbound static handlers.
 * @throws On duplicate identities or unknown route/MCP bindings.
 * @example
 * import { createHostManifestCatalog } from '@alneas/eaos-server/extensions'
 * const manifests = createHostManifestCatalog({ manifests: [] })
 */
export function createHostManifestCatalog(options: HostManifestCatalogOptions): PluginManifest[] {
  const ids = new Set(options.manifests.map(item => item.id))
  if (ids.size !== options.manifests.length) throw Error('Duplicate plugin id in host catalog')
  for (const id of [...Object.keys(options.routeFactories ?? {}), ...(options.mcpPluginIds ?? [])]) {
    if (!ids.has(id)) throw Error(`Unknown host binding plugin: ${id}`)
  }
  return options.manifests.map(manifest => {
    const { mcp: _mcp, createRoutes: _routes, ...metadata } = manifest
    const createRoutes = options.routeFactories?.[manifest.id]
    if (!createRoutes) return metadata
    const mcp = options.mcpPluginIds?.includes(manifest.id) && manifest.mcp ? {
      tools: manifest.mcp.tools.map(tool => {
        const handler: typeof tool.handler = async (args, context) => {
          const bridge = context as typeof context & { callPluginTool?: (name: string, input: unknown) => Promise<unknown> }
          if (typeof bridge.callPluginTool !== 'function') throw Error('Bound MCP host unavailable')
          return bridge.callPluginTool(tool.name, args)
        }
        return { ...tool, handler }
      }),
    } : undefined
    return { ...metadata, createRoutes, ...(mcp ? { mcp } : {}) }
  })
}

/** Application licensing policy. Membership and resource permission remain separate checks.
 * @see createHostModulePolicy
 */
export interface HostModulePolicyOptions {
  /** Reviewed adopted feature metadata with unique identities. */
  manifests: PluginManifest[]
  /** Host-owned legacy licensing keys accepted for each feature. */
  moduleAliases?: Record<string, string[]>
  /** Exact API prefixes and descendants to which a feature guard applies. */
  routePrefixes?: Record<string, string[]>
  /** Read current licensing keys for the verified tenant; failures propagate. */
  loadEnabledModules: (tenantId: string) => Promise<string[]>
  /** Explicit trusted host policy; omitted means no bypass in any environment. */
  bypass?: (context: Context) => boolean
}

/**
 * Bind host-provided module licensing to Hono without environment-based defaults.
 * @param options - Trusted manifest selection, live licensing lookup and optional host policy.
 * @returns Licensing middleware, a per-feature guard and feature-ID mapping.
 * @throws Licensing lookup failures propagate; missing tenant/module admission returns 403.
 * @remarks A module guard does not authenticate a principal or authorize a resource.
 * @example
 * import { createHostModulePolicy } from '@alneas/eaos-server/extensions'
 * const policy = createHostModulePolicy({ manifests: [], loadEnabledModules: async () => [] })
 */
export function createHostModulePolicy(options: HostModulePolicyOptions) {
  const aliases = options.moduleAliases ?? {}
  const entitlementMiddleware = createMiddleware(async (c, next) => {
    const tenantId = c.get('tenantId') as string | undefined
    c.set('enabledModules', tenantId ? [...new Set(await options.loadEnabledModules(tenantId))] : [])
    await next()
  })
  function requireModule(moduleId: string) {
    const accepted = aliases[moduleId] ?? [moduleId]
    return createMiddleware(async (c, next) => {
      const prefixes = options.routePrefixes?.[moduleId]
      if (prefixes && !prefixes.some(prefix => c.req.path === prefix || c.req.path.startsWith(prefix.replace(/\/$/, '') + '/'))) return next()
      if (options.bypass?.(c)) return next()
      const enabled = c.get('enabledModules') as string[] | undefined
      if (c.get('tenantId') && enabled?.some(key => key === 'all' || accepted.includes(key))) return next()
      return c.json({ error: 'Module Not Licensed', message: `The module '${moduleId}' is not enabled for your tenant.` }, 403)
    })
  }
  function enabledPluginIds(enabledModules: string[]) {
    return options.manifests.filter(manifest => enabledModules.some(key => key === 'all' || (aliases[manifest.id] ?? [manifest.id]).includes(key))).map(manifest => manifest.id)
  }
  return { entitlementMiddleware, requireModule, enabledPluginIds }
}

/** Live workspace, module and lifecycle providers supplied by trusted host composition.
 * @see createPluginAuthorizationMiddleware
 */
export interface PluginAuthorizationOptions {
  /** Supply the live tenant/membership store for principal revalidation. */
  store: () => WorkspaceContextStore
  /** Read current licensing IDs for the verified tenant. */
  enabledPluginIds: (tenantId: string) => Promise<string[]>
  /** Recheck current lifecycle activation for the verified tenant and feature. */
  isEnabled: (tenantId: string, pluginId: string) => Promise<boolean>
}

/**
 * Install a request-scoped authorization port that rechecks membership and activation.
 * @param options - Trusted live membership and feature providers.
 * @returns Hono middleware attaching the existing platform authorization binding.
 * @remarks Authentication must run first. Lookup failures deny access. API-key identity must be host-verified; resource policies still apply.
 * @example
 * import { createPluginAuthorizationMiddleware, type PluginAuthorizationOptions } from '@alneas/eaos-server/extensions'
 * export const bindAuthorization = (providers: PluginAuthorizationOptions) => createPluginAuthorizationMiddleware(providers)
 */
export function createPluginAuthorizationMiddleware(options: PluginAuthorizationOptions) {
  return createMiddleware(async (c, next) => {
    const workspace = c.get('workspaceContext') as WorkspaceContext | undefined
    const tenantId = c.get('tenantId') as string | undefined
    const userId = c.get('userId') as string | undefined
    const port: PlatformPluginAuthorization = {
      async resolvePrincipal() {
        if (!tenantId || !userId) return null
        try {
          const verified = userId.startsWith('api-key:') ? { roles: ['user'] } : workspace ?
            await createWorkspaceContextResolver(options.store())({ userId, email: workspace.email, isSuperAdmin: workspace.isSuperAdmin }, tenantId) : undefined
          if (!verified) return null
          const plugins = await options.enabledPluginIds(tenantId)
          const enabledPluginIds: string[] = []
          for (const id of plugins) if (await options.isEnabled(tenantId, id)) enabledPluginIds.push(id)
          return { tenantId, userId, roles: verified.roles, enabledPluginIds }
        } catch { return null }
      },
      async isPluginEnabled(selectedTenant, pluginId) {
        if (selectedTenant !== tenantId) return false
        return (await port.resolvePrincipal())?.enabledPluginIds.includes(pluginId) === true
      },
    }
    c.set(PLATFORM_PLUGIN_AUTHORIZATION, port)
    await next()
  })
}

/** Safe client metadata selection; visibility is not API permission.
 * @see resolveClientPlugins
 */
export interface ClientPluginOptions {
  /** Concrete tenant established by verified host membership. */
  tenantId: string
  /** Current host licensing selection, never client claims. */
  enabledPluginIds: string[]
  /** Reviewed adopted feature metadata with unique identities. */
  manifests: PluginManifest[]
  /** Verified private contribution ownership and explicit tenant scope. */
  extensions: PlatformExtension[]
  /** Optional live activation check; lookup failures propagate. */
  isEnabled?: (tenantId: string, pluginId: string) => Promise<boolean>
  /** Host-owned standalone clients that expose navigation without server routes. */
  navigationPluginIds?: readonly string[]
}

/**
 * Project current adopted and tenant-scoped features into safe client metadata.
 * @param options - Verified tenant, host selection and optional live activation check.
 * @returns Display metadata only, without executable routes or tools.
 * @throws Live activation failures propagate rather than produce misleading availability.
 * @example
 * import { resolveClientPlugins } from '@alneas/eaos-server/extensions'
 * const plugins = await resolveClientPlugins({ tenantId: 'tenant', enabledPluginIds: [], manifests: [], extensions: [] })
 */
export async function resolveClientPlugins(options: ClientPluginOptions) {
  const plugins: Array<Pick<PluginManifest, 'id' | 'name' | 'version' | 'targets' | 'entitlement' | 'navigation'>> = []
  for (const manifest of options.manifests) {
    if (!options.enabledPluginIds.includes(manifest.id)) continue
    const owner = options.extensions.find(item => item.manifests?.some(plugin => plugin.id === manifest.id))
    if (owner && !owner.tenantIds.includes(options.tenantId)) continue
    if (options.isEnabled && !await options.isEnabled(options.tenantId, manifest.id)) continue
    plugins.push({ id: manifest.id, name: manifest.name, version: manifest.version, targets: manifest.targets, entitlement: manifest.entitlement, navigation: manifest.createRoutes || options.navigationPluginIds?.includes(manifest.id) ? manifest.navigation : undefined })
  }
  return plugins
}
