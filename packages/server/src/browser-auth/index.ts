import { Hono, type Context } from 'hono'
export * from './kratos-session'
export * from './platform-session'
export * from './public-memberships'
/**
 * Verified browser identity and membership serialized by {@link createBrowserSessionRouter}.
 */
export interface BrowserSession {
 /** Nonblank authenticated identity ID. */
 userId: string
 /** Nonblank selected authorized tenant ID. */
 tenantId: string
 /** Verified nonblank role names; empty arrays are accepted. */
 roles: string[]
 /** Verified nonblank module entitlement names; empty arrays are accepted. */
 enabledModules: string[]
}
/**
 * Exposes browser-safe provider configuration and verified session data with no-store response headers.
 * @typeParam T - Host session shape extending required identity/membership fields; additional fields are serialized in full.
 * @param options - configuration synchronously supplies publicUrl/provider/redirectOrigins and optional returnTo for GET /config; resolveSession receives Hono context for GET /session and resolves a verified session or null; optional tenantId restricts returned sessions to one tenant.
 * @returns A router with GET /config and /session. Configuration failure returns 503; absent session returns 401, tenant mismatch returns 403, and resolver failures map status 401/403 or otherwise 503.
 * @remarks The host owns IdP settings and membership lookup. No identity creation, default roles, or token minting occurs. Configuration output whitelists fields, but session output serializes all T fields: do not place secrets in a session. Responses set Cache-Control: no-store and Vary: Cookie, Authorization, X-Tenant-Id.
 * @example
 * ```typescript
 * import type { Context } from "hono";
 * import { createBrowserSessionRouter, type BrowserSession } from "@alneas/eaos-server/browser-auth";
 * export function authRouter(resolveSession: (context: Context) => Promise<BrowserSession | null>) {
 *   return createBrowserSessionRouter({
 *     configuration: () => ({ publicUrl: "https://identity.example.com", provider: "kratos", redirectOrigins: ["https://app.example.com"] }),
 *     resolveSession,
 *   });
 * }
 * ```
 */
export function createBrowserSessionRouter<T extends BrowserSession>(options: {
  /**
   * Synchronous public IdP configuration callback evaluated on each /config request; failures become 503 and only explicitly selected fields are serialized.
   */
  configuration: () => {
  /**
   * Nonempty public identity-provider URL returned to the browser; the router does not validate its URL syntax.
   */
  publicUrl: string;
  /**
   * Nonempty provider label returned to the browser.
   */
  provider: string;
  /**
   * Optional post-authentication return URL included only when truthy; host configuration must validate redirect policy.
   */
  returnTo?: string;
  /**
   * Host redirect-origin list serialized to the browser; the router checks only that it is an array.
   */
  redirectOrigins: string[] }
  /**
   * Per-request host verifier resolving a trusted session or null for 401; thrown statuses 401/403 are preserved and other failures become 503.
   */
  resolveSession: (context: Context) => Promise<T | null>
  /**
   * Optional dedicated-backend tenant restriction; a session selecting another tenant returns 403.
   */
  tenantId?: string
}) {
  const router = new Hono()
  router.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); c.header('Vary', 'Cookie, Authorization, X-Tenant-Id'); await next() })
  router.get('/config', c => {
    try {
      const v = options.configuration()
      // Explicit fields only: secrets in host configuration cannot be serialized accidentally.
      if (!v.publicUrl || !v.provider || !Array.isArray(v.redirectOrigins)) throw new Error('Unconfigured')
      return c.json({ publicUrl: v.publicUrl, provider: v.provider, ...(v.returnTo ? { returnTo: v.returnTo } : {}), redirectOrigins: v.redirectOrigins })
    } catch { return c.json({ error: 'Authentication is not configured' }, 503) }
  })
  router.get('/session', async c => {
    try {
      const value = await options.resolveSession(c)
      if (!value) return c.json({ error: 'Authentication required' }, 401)
      if (options.tenantId && value.tenantId !== options.tenantId) return c.json({ error: 'Tenant unavailable' }, 403)
      if (typeof value.userId !== 'string' || !value.userId.trim() || typeof value.tenantId !== 'string' || !value.tenantId.trim() || !Array.isArray(value.roles) || !Array.isArray(value.enabledModules) || [...value.roles, ...value.enabledModules].some(v => typeof v !== 'string' || !v.trim())) throw new Error('Invalid session')
      return c.json(value)
    } catch (error) {
      const status = (error as { status?: number })?.status
      return c.json({ error: 'Authenticated membership unavailable' }, status === 401 ? 401 : status === 403 ? 403 : 503)
    }
  })
  return router
}

export { applyAccountMembershipChange, metadataHash, planAccountMembershipPublication, publishAccountMemberships, type ManagedIdentity, type AccountMetadataField, type MembershipMigrationPlan, type MembershipPublicationPlan, type AccountMutationStore, type AccountAdminPort } from './account-memberships'
