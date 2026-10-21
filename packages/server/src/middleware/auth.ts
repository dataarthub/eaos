import { createMiddleware } from 'hono/factory'
import type { EaosEnv, EaosUser } from '@alneas/eaos-core'

/**
 * Host authentication adapters used by {@link createAuthMiddleware}.
 * @remarks Results must come from verified credentials and trusted membership data; this middleware does not independently validate claims.
 */
export interface AuthSessionVerifier {
  /**
   * Verifies a session before the optional API key fallback.
   * @param authHeader - Raw Authorization header, or undefined if absent.
   * @param cookieHeader - Raw Cookie header, or undefined if absent.
   * @returns Session validity and trusted optional identity claims. pendingApproval takes priority over valid and produces 403.
   * @throws Rejections propagate through request handling.
   
   * @example
   * ```typescript
   * import type { AuthSessionVerifier } from "@alneas/eaos-server";
   * export async function inspectSession(verifier: AuthSessionVerifier, request: Request) {
   *   // The host verifier checks real credentials; a header alone is not trusted.
   *   const result = await verifier.verifySession(
   *     request.headers.get("Authorization") ?? undefined,
   *     request.headers.get("Cookie") ?? undefined,
   *   );
   *   return { valid: result.valid, pendingApproval: result.pendingApproval === true };
   * }
   * ```
   */
  verifySession(authHeader?: string, cookieHeader?: string): Promise<{
    /** True only after successful trusted credential verification. */
    valid: boolean
    /** Optional authenticated user ID copied to Hono context. */
    userId?: string
    /** Optional verified email used when synthesizing a user object. */
    email?: string
    /** Optional verified tenant claim; session middleware can continue without it, so downstream tenant admission remains required. */
    tenantId?: string
    /** Trusted platform authority enabling X-Tenant-Id selection and synthesized super_admin role. */
    isSuperAdmin?: boolean
    /** When truthy, produces a 403 before session validity or API-key fallback is considered. */
    pendingApproval?: boolean
    /** Optional approval reference included in a pending response. */
    pendingId?: string
    /** Optional trusted user object copied unchanged; if omitted with userId, middleware synthesizes one. */
    user?: EaosUser
  }>
  /**
   * Verifies a nonempty credential after session verification fails.
   * @param token - Authorization value with a leading Bearer prefix removed case-insensitively.
   * @returns Validity and trusted identity claims; a valid result also needs tenantId to grant access.
   * @throws Adapter errors propagate through request handling.
   
   * @example
   * ```typescript
   * import type { AuthSessionVerifier } from "@alneas/eaos-server";
   * export async function inspectApiKey(verifier: AuthSessionVerifier, token: string) {
   *   if (!verifier.verifyApiKey) throw new Error("Host API-key verification is unavailable");
   *   // Supply the actual credential without logging or persisting it here.
   *   const result = await verifier.verifyApiKey(token);
   *   return result.valid && !!result.tenantId;
   * }
   * ```
   */
  verifyApiKey?(token: string): Promise<{
    /** True for a verified API key; tenantId is additionally required to continue. */
    valid: boolean
    /** Required tenant claim for a successful middleware API-key fallback. */
    tenantId?: string
    /** Optional authenticated key owner copied to userId; no user object is synthesized for this path. */
    userId?: string
  }> | {
    
    /**
     * True only when the host has verified the presented API key; middleware also requires a truthy tenantId before continuing.
     */
    valid: boolean
    
    /**
     * Trusted tenant claim required for successful API-key fallback; middleware does not verify tenant membership independently.
     */
    tenantId?: string
    
    /**
     * Optional verified key-owner identity copied to request context; this fallback does not synthesize an EaosUser object.
     */
    userId?: string
  }
}

/**
 * Authentication configuration for {@link createAuthMiddleware}.
 */
export interface AuthMiddlewareOptions {
  /** Host verifier; omission allows all requests through without establishing identity. */
  verifier?: AuthSessionVerifier
  /** Case-sensitive path prefixes exempt from verification; defaults to /health, /metrics, and /api/health. An empty array disables these exemptions. */
  skipPaths?: string[]
}

/**
 * Resolves trusted session or API key claims into Hono context and rejects invalid credentials.
 * @param options - Host verifier and excluded path prefixes; see {@link AuthMiddlewareOptions}.
 * @returns Middleware that continues exempt or authenticated requests, returns 403 for pending approval, and otherwise returns 401.
 * @throws Request execution propagates verifier and downstream middleware errors.
 * @remarks Requests with both userId and tenantId already in context bypass verification. Omitting a verifier also bypasses authentication. Only session results marked isSuperAdmin may select X-Tenant-Id; the host remains responsible for tenant existence and authorization. A synthesized user gets super_admin or user roles; API key fallback sets no user object.
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import type { EaosEnv } from "@alneas/eaos-core";
 * import { createAuthMiddleware, type AuthSessionVerifier } from "@alneas/eaos-server/middleware/auth";
 * export function authenticatedApp(verifier: AuthSessionVerifier) {
 *   // Supply a host adapter that actually validates sessions and tenant claims.
 *   const app = new Hono<EaosEnv>();
 *   app.use("*", createAuthMiddleware({ verifier, skipPaths: [] }));
 *   app.get("/identity", c => c.json({ userId: c.get("userId") }));
 *   return app;
 * }
 * ```
 */
export function createAuthMiddleware(options?: AuthMiddlewareOptions) {
  return createMiddleware<EaosEnv>(async (c, next) => {
    const path = c.req.path
    const skipPaths = options?.skipPaths || ['/health', '/metrics', '/api/health']

    if (skipPaths.some((p) => path.startsWith(p))) {
      return await next()
    }

    // 既に tenantId がセットされている場合（API Gateway 等で解決済み）
    if (c.get('tenantId') && c.get('userId')) {
      return await next()
    }

    if (!options?.verifier) {
      // 検証器が設定されていない場合はスルー（開発用または後続ミドルウェアに委譲）
      return await next()
    }

    const authHeader = c.req.header('Authorization')
    const cookieHeader = c.req.header('Cookie')

    const sessionResult = await options.verifier.verifySession(authHeader, cookieHeader)

    if (sessionResult.pendingApproval) {
      return c.json({
        error: 'アカウントは承認待ちです。管理者に連絡してください。',
        code: 'PENDING_APPROVAL',
        /** Optional approval reference included in a pending response. */
    pendingId: sessionResult.pendingId,
      }, 403)
    }

    if (sessionResult.valid) {
      let tenantId = sessionResult.tenantId

      // X-Tenant-Id によるテナント切替（スーパー管理者のみ）
      const xTenantId = c.req.header('X-Tenant-Id')
      if (xTenantId && sessionResult.isSuperAdmin) {
        tenantId = xTenantId
      }

      if (tenantId) c.set('tenantId', tenantId)
      if (sessionResult.userId) c.set('userId', sessionResult.userId)
      if (sessionResult.user) {
        c.set('user', sessionResult.user)
      } else if (sessionResult.userId) {
        c.set('user', {
          id: sessionResult.userId,
          /** Optional verified email used when synthesizing a user object. */
    email: sessionResult.email || '',
          /** Optional verified tenant claim; session middleware can continue without it, so downstream tenant admission remains required. */
    tenantId: tenantId || '',
          roles: sessionResult.isSuperAdmin ? ['super_admin'] : ['user'],
        })
      }
      return await next()
    }

    // API Key フォールバック検証
    if (authHeader && options.verifier.verifyApiKey) {
      const token = authHeader.replace(/^Bearer\s+/i, '')
      if (token) {
        const apiKeyResult = await options.verifier.verifyApiKey(token)
        if (apiKeyResult.valid && apiKeyResult.tenantId) {
          c.set('tenantId', apiKeyResult.tenantId)
          if (apiKeyResult.userId) c.set('userId', apiKeyResult.userId)
          return await next()
        }
      }
    }

    return c.json({ error: 'Unauthorized' }, 401)
  })
}
