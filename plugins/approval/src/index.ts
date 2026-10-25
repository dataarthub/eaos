import { manifest } from '../manifest'
import type { Context } from 'hono'
import type { PluginManifest } from '@alneas/eaos-core/plugin-sdk'
import type { AiDraftSubmission } from '@alneas/eaos-core/ai/proposal-ui'
import { createPluginRouter, jsonBody, exactKeys, type PluginPrincipal } from '@alneas/eaos-server/plugin-data'
import { ApprovalService, type ApprovalOptions } from './service'
import { createReviewedDraftHandler, type ReviewedDraftHandlerOptions } from './reviewed-draft'
export * from './service'
export * from './reviewed-draft'
export * from './lifecycle'
export * from './rules'
/**
 * Approval service configuration with optional Host ports for reviewed draft submission and domain saves.
 * @see {@link createRoutes}
 */
export interface ApprovalPluginOptions extends ApprovalOptions {
 /**
  * Connects POST /drafts/review to durable Host proposal retention, live execution contracts and the owning save command.
  * Omit this option to leave the endpoint unavailable. The existing ApprovalService instance owns requests and decisions.
  * @remarks The execute adapter retains responsibility for final authorization, domain validation, durable idempotency, CAS and transactions.
  */
 reviewedDrafts?: Omit<ReviewedDraftHandlerOptions<unknown>, 'approval'>
}
/**
 * Creates tenant-scoped approval routes and the optional Host-connected reviewed-draft endpoint.
 * @param options - Live host persistence and authorization configuration; see ApprovalPluginOptions.
 * @param resolvePrincipal - Resolves current authenticated principal per Hono request, or null to deny access.
 * @returns A Hono router ready to mount under the plugin API prefix.
 *
 * @remarks
 * The host owns authentication, current tenant membership and plugin activation. Service errors become HTTP failures through the plugin router; adapter failures may propagate. Mutations can commit before a response failure; reload current state before retrying.
 *
 * @example
 * ```typescript
 * import { createRoutes, type ApprovalPluginOptions } from '@alneas/eaos-plugins/approval';
 * export function connectRoutes(options: ApprovalPluginOptions, resolvePrincipal: Parameters<typeof createRoutes>[1]) {
 *  return createRoutes(options, resolvePrincipal);
 * }
 * ```
 */
export function createRoutes(options: ApprovalPluginOptions, resolvePrincipal: (c: Context) => Promise<PluginPrincipal | null>) {
 const service = new ApprovalService(options), app = createPluginRouter(resolvePrincipal)
 if (options.reviewedDrafts) {
  const review = createReviewedDraftHandler({ ...options.reviewedDrafts, approval: service })
  app.post('/drafts/review', async c => {
   const body = await jsonBody(c)
   exactKeys(body, ['scope', 'operation', 'input', 'proposal', 'target', 'approvalRequestId'])
   return c.json(await review(c.get('principal'), body as unknown as AiDraftSubmission))
  })
 }
 app.get('/requests', async c => c.json(await service.list(c.get('principal'), c.req.query('limit') === undefined ? 50 : Number(c.req.query('limit')))))
 app.post('/requests', async c => c.json(await service.submit(c.get('principal'), await jsonBody(c)), 201))
 app.get('/requests/:id', async c => c.json(await service.read(c.get('principal'), c.req.param('id'))))
 app.post('/requests/:id/decisions', async c => c.json(await service.decide(c.get('principal'), c.req.param('id'), await jsonBody(c))))
 app.post('/requests/:id/withdraw', async c => { const body = await jsonBody(c); exactKeys(body, ['revision']); return c.json(await service.withdraw(c.get('principal'), c.req.param('id'), body.revision)) })
 return app
}
/**
 * Binds static plugin metadata to the host-configured route factory.
 * @param options - Live host configuration; see ApprovalPluginOptions.
 * @param resolvePrincipal - Current authenticated Hono principal resolver; null denies admission.
 * @returns A cloned PluginManifest with a createRoutes closure; no routes are instantiated until called.
 *
 * @remarks
 * Supplying a manifest does not activate a tenant or perform migrations. Host admission and live authorization remain mandatory.
 *
 * @example
 * ```typescript
 * import { createPlugin, type ApprovalPluginOptions } from '@alneas/eaos-plugins/approval';
 * export function configure(options: ApprovalPluginOptions, resolvePrincipal: Parameters<typeof createPlugin>[1]) { return createPlugin(options, resolvePrincipal); }
 * ```
 */
export function createPlugin(options: ApprovalPluginOptions, resolvePrincipal: (c: Context) => Promise<PluginPrincipal | null>): PluginManifest {
 return { ...structuredClone(manifest), createRoutes: () => createRoutes(options, resolvePrincipal) }
}
