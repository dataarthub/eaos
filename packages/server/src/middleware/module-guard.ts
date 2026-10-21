import { createMiddleware } from 'hono/factory'
import type { EaosEnv } from '@alneas/eaos-core'

/**
 * Controls the explicit development bypass for {@link createModuleGuard}.
 */
export interface ModuleGuardOptions {
  /** Skip entitlement checks when true; defaults to NODE_ENV === "development". */
  isDev?: boolean
}

/**
 * Rejects requests unless verified enabledModules contains the requested module or "all".
 * @param moduleKey - Exact, case-sensitive entitlement key required by this route.
 * @param options - Development bypass; see {@link ModuleGuardOptions}.
 * @returns Hono middleware that responds with 403 for missing, malformed, or insufficient entitlements, or completes downstream handling without returning a value.
 * @throws Request execution propagates downstream middleware rejections.
 * @remarks Install authentication and trusted entitlement resolution first. This guard reads context only and does not query a contract store. The development bypass defaults from NODE_ENV.
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import type { EaosEnv } from "@alneas/eaos-core";
 * import { createModuleGuard } from "@alneas/eaos-server/middleware/module-guard";
 * const app = new Hono<EaosEnv>();
 * app.use("/reports/*", createModuleGuard("reports", { isDev: false }));
 * // Populate verified enabledModules in earlier host middleware to allow access.
 * app.get("/reports/summary", c => c.json({ available: true }));
 * console.log((await app.request("/reports/summary")).status); // 403
 * ```
 */
export function createModuleGuard(moduleKey: string, options?: ModuleGuardOptions) {
  return createMiddleware<EaosEnv>(async (c, next) => {
    const isDev = options?.isDev ?? process.env.NODE_ENV === 'development'
    if (isDev) {
      return await next()
    }

    const enabledModules = c.get('enabledModules')

    if (!Array.isArray(enabledModules) || enabledModules.some(module => typeof module !== 'string')) {
      console.warn(`[ModuleGuard] Entitlements unavailable for module '${moduleKey}' tenant=${c.get('tenantId')}`)
      return c.json({
        error: 'Module Entitlements Unavailable',
        message: 'Module entitlements must be verified before accessing this module.'
      }, 403)
    }

    if (!enabledModules.includes(moduleKey) && !enabledModules.includes('all')) {
      console.warn(`[ModuleGuard] Blocked request to module '${moduleKey}' for tenant=${c.get('tenantId')}`)
      return c.json({
        error: 'Module Not Licensed',
        message: `The module '${moduleKey}' is not enabled for your tenant.`
      }, 403)
    }

    await next()
  })
}
