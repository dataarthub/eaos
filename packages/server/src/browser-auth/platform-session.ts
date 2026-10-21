import type { Context } from 'hono'
import { createKratosSessionVerifier, type BrowserSession } from './index'
import type { LifecycleStore, BackendTarget } from '@alneas/eaos-server/lifecycle-engine'

/**
 * Verified tenant membership candidate supplied to {@link createPlatformSessionResolver}.
 */
export interface Membership {
 /** Tenant ID matching the selected header, if provided; validated as a 1–128-character scope identifier. */
 tenantId: string
 /** Verified role names, each a nonempty string. */
 roles: string[]
 /** Verified entitlement names, each a nonempty string. */
 enabledModules: string[]
}
/**
 * Combines a verified Kratos identity, unambiguous membership, active tenant, and expected backend placement.
 * @param options - verify checks credentials; memberships receives verified userId, optional selected tenant ID, and provider identity and resolves candidate memberships; store supplies lifecycle state; targetFor synchronously resolves the expected backend for a selected tenant.
 * @returns A resolver accepting Hono context and optional refresh flag. It resolves a BrowserSession or null for invalid credentials/selection, ambiguous membership, or inactive tenant. Each context caches the in-flight/result Promise unless refresh is true.
 * @throws The resolver rejects verifier, membership, store, and targetFor errors, malformed membership fields, or backend placement mismatch. Rejected Promises are cached until refresh.
 * @remarks Authorization accepts only the exact Bearer syntax with one space and a nonwhitespace token. Bearer token takes precedence over X-Session-Token; the verifier gives session tokens precedence over cookies. X-Tenant-Id selects a candidate but never grants membership. No default tenant or role is invented. The WeakMap cache is per resolver/context; refresh starts another lookup without cancelling previous work.
 * @example
 * ```typescript
 * import { createPlatformSessionResolver } from "@alneas/eaos-server/browser-auth/platform-session";
 * export function hostSessionResolver(options: Parameters<typeof createPlatformSessionResolver>[0]) {
 *   // Supply verified membership reads, lifecycle store, and backend routing.
 *   return createPlatformSessionResolver(options);
 * }
 * ```
 */
export function createPlatformSessionResolver(options: {
  /**
   * Server whoami verifier receiving cookie/session-token credentials; token transport takes precedence over cookies.
   */
  verify: ReturnType<typeof createKratosSessionVerifier>
  /**
   * Host callback receiving verified user ID, optional requested tenant, and provider identity; must resolve exactly one authorized membership or resolution returns null.
   */
  memberships: (userId: string, tenantId: string | undefined, identity: Record<string, unknown>) => Promise<Membership[]>
  /**
   * Authoritative lifecycle store used to require an active tenant and its expected backend placement.
   */
  store: LifecycleStore
  /**
   * Synchronous host backend selector for the verified membership tenant; an ID differing from lifecycle placement rejects resolution.
   */
  targetFor: (tenantId: string) => BackendTarget
}) {
  const requests = new WeakMap<Context, Promise<BrowserSession | null>>()
  return (context: Context, resolution?: { refresh?: boolean }): Promise<BrowserSession | null> => {
    const cached = requests.get(context)
    if (cached && !resolution?.refresh) return cached
    const result = (async () => {
      const bearer = context.req.header('Authorization')
      if (bearer && !/^Bearer [^\s]+$/.test(bearer)) return null
      const identity = await options.verify({ cookie: context.req.header('Cookie'), sessionToken: bearer?.slice(7) ?? context.req.header('X-Session-Token') })
      if (!identity) return null
      const tenantId = context.req.header('X-Tenant-Id')
      if (tenantId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(tenantId)) return null
      const matches = await options.memberships(identity.userId, tenantId, identity.identity)
      if (matches.length !== 1) return null // No default tenant or role for ambiguous/unregistered users.
      const member = matches[0]
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(member.tenantId) || (tenantId && member.tenantId !== tenantId)) return null
      if (!Array.isArray(member.roles) || !Array.isArray(member.enabledModules)) throw new Error('Invalid membership')
      if (![...member.roles, ...member.enabledModules].every(x => typeof x === 'string' && x.length > 0)) throw new Error('Invalid membership')
      const state = await options.store.read()
      if (!state.platform.tenants[member.tenantId]?.active) return null
      const expected = options.targetFor(member.tenantId)
      if (state.platform.placements[member.tenantId]?.backendId !== expected.id) throw new Error('Tenant backend placement mismatch')
      return { userId: identity.userId, tenantId: member.tenantId, roles: [...member.roles], enabledModules: [...member.enabledModules] }
    })()
    requests.set(context, result)
    return result
  }
}
