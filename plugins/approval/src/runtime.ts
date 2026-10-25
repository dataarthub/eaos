import type { Context } from 'hono'
import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data'
import { createPlugin, type ApprovalPluginOptions } from './index'
import { lifecycle } from './lifecycle'
/**
 * Live host service configuration and current authenticated principal resolver.
 *
 * @see ApprovalService for a complete host integration example.
 */
export interface PublicPluginBindings {
  /**
 * Live approval storage/authorization configuration, optionally including reviewed-draft Host proposal/save ports.
 */
  options: ApprovalPluginOptions
  /**
 * Resolve current verified Hono request identity, or null to deny access; rejection propagates.
 * @param context - Current Hono request context.
 * @returns A verified current principal, or null to deny admission.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @example
 * ```typescript
 * import type { PublicPluginBindings } from '@alneas/eaos-plugins/approval/runtime';
 * export function resolveRequest(bindings: PublicPluginBindings, context: Parameters<PublicPluginBindings['resolvePrincipal']>[0]) {
 *  return bindings.resolvePrincipal(context); // Null denies unauthenticated or unavailable identity.
 * }
 * ```
 */
resolvePrincipal(context: Context): Promise<PluginPrincipal | null>
}
/**
 * Builds a host extension restricted to a verified, concrete tenant catalog.
 * @param input - Nonempty distinct concrete tenantIds plus required live bindings; wildcard IDs are rejected.
 * @returns An API-version-1 extension containing tenant IDs, configured manifest, lifecycle and route factories.
 * @throws Error for empty/duplicate/wildcard tenant IDs or missing host adapter functions.
 *
 * @remarks
 * This validates adapter presence and tenant admission, not the truth of host authorization. No activation or migration is executed. Principals outside the configured catalog resolve to null.
 *
 * @example
 * ```typescript
 * import { createExtension, type PublicPluginBindings } from '@alneas/eaos-plugins/approval/runtime';
 * export function configureExtension(tenantIds: string[], bindings: PublicPluginBindings) { return createExtension({ tenantIds, bindings }); }
 * ```
 */
export function createExtension(input: {
/**
 * Verified nonempty catalog of distinct concrete tenant IDs; wildcards are rejected.
 */
  tenantIds: string[];
/**
 * Required live host options and identity resolver; omitted bindings throw.
 */
  bindings?: PublicPluginBindings }) {
  if (!Array.isArray(input.tenantIds) || !input.tenantIds.length || new Set(input.tenantIds).size !== input.tenantIds.length || input.tenantIds.some(id => typeof id !== 'string' || !id.trim() || id === '*')) throw new Error('Verified concrete tenant catalog required')
  const tenantIds = [...input.tenantIds]
  const bindings = input.bindings
  if (!bindings || typeof bindings.resolvePrincipal !== 'function' || typeof bindings.options?.authorize !== 'function' || !bindings.options.store || typeof bindings.options.resolveTemplate !== 'function') throw new Error('Live approval host bindings required')
  const plugin = createPlugin(bindings.options, async context => {
    const principal = await bindings.resolvePrincipal(context)
    return principal && tenantIds.includes(principal.tenantId) ? principal : null
  })
  return { apiVersion: 1 as const, id: '@alneas/eaos-plugins/approval', tenantIds: [...tenantIds], manifests: [plugin], lifecycle: [lifecycle], routeFactories: { [plugin.id]: plugin.createRoutes! } }
}
