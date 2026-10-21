import { Hono } from 'hono'
import { createLivenessReport, runReadinessChecks, type HealthCheck } from '@alneas/eaos-core'

/**
 * Host inputs for the unauthenticated liveness and readiness routes.
 * @see createHealthRouter for a complete usage example.
 */
export interface HealthRouterOptions {
  /** Nonblank application label included in every response. */
  appName: string
  /** Readiness checks run on each readiness request; defaults to no checks. */
  checks?: readonly HealthCheck[]
  /** Clock read separately for each request; defaults to the current Date. */
  now?: () => Date
}

/**
 * Creates public /health, /health/live, and /health/ready routes.
 * @param options - Application label, readiness checks, and optional clock.
 * @returns A new Hono router; liveness returns 200 and readiness returns 503 only for a not_ready report.
 * @throws If appName is missing, not a string, or blank. Request handling may reject if the supplied clock throws.
 * @remarks Check implementations and credentials remain host-owned. These routes install no authentication; mount them where public health status is appropriate. Checks run for every readiness request with no caching by this router.
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import { createHealthRouter } from "@alneas/eaos-server/health";
 * const app = new Hono();
 * app.route("/", createHealthRouter({ appName: "example-service" }));
 * const response = await app.request("/health/live");
 * console.log(response.status); // 200
 * ```
 */
export function createHealthRouter(options: HealthRouterOptions): Hono {
  if (!options || typeof options.appName !== 'string' || !options.appName.trim()) throw new Error('Health app name is required')
  const app = new Hono()
  const now = options.now ?? (() => new Date())
  app.get('/health', c => c.json({ status: 'healthy', appName: options.appName, ...createLivenessReport(now()) }))
  app.get('/health/live', c => c.json({ status: 'healthy', appName: options.appName, ...createLivenessReport(now()) }))
  app.get('/health/ready', async c => {
    const report = await runReadinessChecks(options.checks ?? [], now())
    return c.json({ appName: options.appName, ...report }, report.state === 'not_ready' ? 503 : 200)
  })
  return app
}
