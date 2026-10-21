import { manifest } from '../manifest'
import type { Context } from 'hono'
import type { PluginManifest } from '@alneas/eaos-core/plugin-sdk'
import { createPluginRouter, jsonBody, type PluginPrincipal } from '@alneas/eaos-server/plugin-data'
import { FieldCustomizationService, type FieldCustomizationOptions } from './service'
export * from './service'
export * from './lifecycle'
export * from './schema'
/**
 * Creates tenant-scoped field definition read/write routes.
 * @param options - Live host persistence and authorization configuration; see FieldCustomizationOptions.
 * @param resolvePrincipal - Resolves current authenticated principal per Hono request, or null to deny access.
 * @returns A Hono router ready to mount under the plugin API prefix.
 *
 * @remarks
 * The host owns authentication, current tenant membership and plugin activation. Service errors become HTTP failures through the plugin router; adapter failures may propagate. Mutations can commit before a response failure; reload current state before retrying.
 *
 * @example
 * ```typescript
 * import { createRoutes, type FieldCustomizationOptions } from '@alneas/eaos-plugins/field-customization';
 * export function connectRoutes(options: FieldCustomizationOptions, resolvePrincipal: Parameters<typeof createRoutes>[1]) {
 *  return createRoutes(options, resolvePrincipal);
 * }
 * ```
 */
export function createRoutes(options: FieldCustomizationOptions, resolvePrincipal: (c: Context) => Promise<PluginPrincipal | null>) {
 const service = new FieldCustomizationService(options), app = createPluginRouter(resolvePrincipal)
 app.get('/resources/:id', async c => c.json(await service.read(c.get('principal'), c.req.param('id'))))
 app.put('/resources/:id', async c => c.json(await service.write(c.get('principal'), c.req.param('id'), await jsonBody(c))))
 return app
}
/**
 * Binds static plugin metadata to the host-configured route factory.
 * @param options - Live host configuration; see FieldCustomizationOptions.
 * @param resolvePrincipal - Current authenticated Hono principal resolver; null denies admission.
 * @returns A cloned PluginManifest with a createRoutes closure; no routes are instantiated until called.
 *
 * @remarks
 * Supplying a manifest does not activate a tenant or perform migrations. Host admission and live authorization remain mandatory.
 *
 * @example
 * ```typescript
 * import { createPlugin, type FieldCustomizationOptions } from '@alneas/eaos-plugins/field-customization';
 * export function configure(options: FieldCustomizationOptions, resolvePrincipal: Parameters<typeof createPlugin>[1]) { return createPlugin(options, resolvePrincipal); }
 * ```
 */
export function createPlugin(options: FieldCustomizationOptions, resolvePrincipal: (c: Context) => Promise<PluginPrincipal | null>): PluginManifest {
 return { ...structuredClone(manifest), createRoutes: () => createRoutes(options, resolvePrincipal) }
}
