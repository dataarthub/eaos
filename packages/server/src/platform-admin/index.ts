import { Hono } from 'hono'
import { assertBackendMigrationCutover, planBackendMigration } from '@alneas/eaos-server/lifecycle-engine'
import type { PlatformAdminAction, PlatformAdminAuditEvent, PlatformAdminAuthorization, PlatformAdminPrincipal, PlatformControlStore, PlatformPlacementExecutor } from '@alneas/eaos-server/platform'
export type { PlatformPlacementExecutor } from '@alneas/eaos-server/platform'
export { LifecyclePlatformControlStore } from './store'

/**
 * Trusted control-plane authorization, persistence, audit, and optional migration execution dependencies.
 * @see createPlatformAdminRouter.
 */
export interface PlatformAdminRouterOptions extends PlatformAdminAuthorization {
  /** Shared authoritative tenant/backend/placement store. */
  store: PlatformControlStore
  /** Awaited on denied and successful mutations; receives operator/action/outcome/time, without request credentials. Audit failure may occur after persistence. */
  audit: (event: Readonly<PlatformAdminAuditEvent>) => Promise<void>
  /** Optional host migration executor; absent returns 501 for execute requests. Provisioning, credentials, and SQL remain host-owned. */
  placementExecutor?: PlatformPlacementExecutor
  /** Clock for audit/plan timestamps; defaults to fresh Date. */
  now?: () => Date
}

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Request body must be an object')
  return value as JsonObject
}

function string(value: unknown, name: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`)
  return value
}

function stringArray(value: unknown, name: string, max = 128): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max || value.some(item => typeof item !== 'string' || !item.trim())) throw new Error(`Invalid ${name}`)
  return [...value]
}

async function body(c: { req: { json: <T>() => Promise<T> } }): Promise<JsonObject> {
  return object(await c.req.json().catch(() => null))
}

function publicBackend(backend: Awaited<ReturnType<PlatformControlStore['listBackends']>>[number]) {
  return {
    id: backend.id,
    databaseId: backend.databaseId,
    dialect: backend.dialect,
    mode: backend.mode,
    ...(backend.tenantId === undefined ? {} : { tenantId: backend.tenantId }),
    ...(backend.label === undefined ? {} : { label: backend.label }),
    ...(backend.provider === undefined ? {} : { provider: backend.provider }),
    ...(backend.capabilities === undefined ? {} : { capabilities: backend.capabilities }),
  }
}

/**
 * Platform-wide control routes. They operate on host-registered opaque
 * backends; provisioning, credentials, SQL and tenant membership remain host-owned.
 * @param options - Shared store, live platform-admin authorization, audit sink, optional placement executor, and clock.
 * @returns A Hono router for tenants, backend discovery, placement planning/execution/status/rollback/reconciliation. Unauthenticated/unauthorized requests return 401/403.
 * @throws Synchronously for missing store/auth/audit dependencies. Request-time reads/auth/audit can fail through Hono error handling; mutation failures are generally 400 or migration conflict 409 data.
 * @remarks Every operation requires principal.isPlatformAdmin === true plus host authorize approval. Plan/rollback endpoints persist reviewed plans rather than directly changing routing. Execution verifies reports before cutover and records reconciling state on uncertain failures; host executor effects are not rolled back automatically. Reads expose opaque public backend metadata without credentials/SQL. A failed audit can follow a completed mutation, so errors do not prove no change occurred. No listener, deployment, or scheduler is started.
 * @example
 * ```typescript
 * import { createPlatformAdminRouter, type PlatformAdminRouterOptions } from "@alneas/eaos-server/platform-admin";
 * export function controlRoutes(options: PlatformAdminRouterOptions) { return createPlatformAdminRouter(options); }
 * ```
 */
export function createPlatformAdminRouter(options: PlatformAdminRouterOptions): Hono {
  if (!options?.store || !options.resolvePrincipal || !options.authorize || !options.audit) throw new Error('Platform admin router dependencies are required')
  const app = new Hono()
  const now = options.now ?? (() => new Date())

  const access = async (request: Request, action: PlatformAdminAction, tenantId?: string): Promise<{ principal: PlatformAdminPrincipal } | Response> => {
    const principal = await options.resolvePrincipal(request)
    if (!principal) return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: { 'content-type': 'application/json' } })
    const allowed = principal.isPlatformAdmin === true && await options.authorize(principal, action, tenantId)
    if (!allowed) {
      await options.audit({ action, actorId: principal.userId, ...(tenantId ? { tenantId } : {}), outcome: 'denied', occurredAt: now().toISOString() })
      return new Response(JSON.stringify({ error: 'Platform administrator access required' }), { status: 403, headers: { 'content-type': 'application/json' } })
    }
    return { principal }
  }

  const failure = (error: unknown, status = 400) => new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Request failed' }), { status, headers: { 'content-type': 'application/json' } })

  app.get('/tenants', async c => {
    const authorized = await access(c.req.raw, 'tenant:list')
    if (authorized instanceof Response) return authorized
    return c.json({ tenants: await options.store.listTenants() })
  })

  app.post('/tenants', async c => {
    const authorized = await access(c.req.raw, 'tenant:create')
    if (authorized instanceof Response) return authorized
    try {
      const input = await body(c)
      const tenant = await options.store.createTenant({ id: string(input.id, 'tenant id'), name: string(input.name, 'tenant name'), domains: stringArray(input.domains, 'domains'), backendId: string(input.backendId, 'initial backend id') })
      await options.audit({ action: 'tenant:create', actorId: authorized.principal.userId, tenantId: tenant.id, outcome: 'allowed', occurredAt: now().toISOString() })
      return c.json({ tenant }, 201)
    } catch (error) {
      return failure(error)
    }
  })

  app.patch('/tenants/:tenantId', async c => {
    const tenantId = string(c.req.param('tenantId'), 'tenant id')
    const authorized = await access(c.req.raw, 'tenant:update', tenantId)
    if (authorized instanceof Response) return authorized
    try {
      const input = await body(c)
      const patch = {
        ...(input.name === undefined ? {} : { name: string(input.name, 'tenant name') }),
        ...(input.active === undefined ? {} : { active: input.active === true }),
        ...(input.domains === undefined ? {} : { domains: stringArray(input.domains, 'domains') }),
      }
      if (!Object.keys(patch).length) throw new Error('Tenant patch is empty')
      const tenant = await options.store.updateTenant(tenantId, patch)
      await options.audit({ action: 'tenant:update', actorId: authorized.principal.userId, tenantId, outcome: 'allowed', occurredAt: now().toISOString() })
      return c.json({ tenant })
    } catch (error) {
      return failure(error)
    }
  })

  app.get('/backends', async c => {
    const authorized = await access(c.req.raw, 'backend:list')
    if (authorized instanceof Response) return authorized
    return c.json({ backends: (await options.store.listBackends()).map(publicBackend) })
  })

  app.get('/tenants/:tenantId/placement', async c => {
    const tenantId = string(c.req.param('tenantId'), 'tenant id')
    const authorized = await access(c.req.raw, 'placement:read', tenantId)
    if (authorized instanceof Response) return authorized
    const placement = await options.store.getTenantPlacement(tenantId)
    if (!placement) return failure(new Error('Tenant placement not found'), 404)
    return c.json({ placement: { ...placement, backend: publicBackend(placement.backend) } })
  })

  app.post('/tenants/:tenantId/placement/plan', async c => {
    const tenantId = string(c.req.param('tenantId'), 'tenant id')
    const authorized = await access(c.req.raw, 'placement:plan', tenantId)
    if (authorized instanceof Response) return authorized
    try {
      const input = await body(c)
      const targetBackendId = string(input.targetBackendId, 'target backend id')
      const pluginIds = stringArray(input.pluginIds, 'pluginIds')
      const reason = string(input.reason, 'migration reason', 1024)
      const current = await options.store.getTenantPlacement(tenantId)
      if (!current) return failure(new Error('Tenant placement not found'), 404)
      const target = await options.store.getBackend(targetBackendId)
      if (!target) return failure(new Error('Target backend not found'), 404)
      const plan = planBackendMigration({
        migrationId: `platform-${crypto.randomUUID()}`,
        source: current.backend,
        target,
        scope: { kind: 'tenants', tenantIds: [tenantId] },
        pluginIds,
        requestedAt: now().toISOString(),
        reason,
      })
      await options.store.saveMigrationPlan(plan)
      await options.audit({ action: 'placement:plan', actorId: authorized.principal.userId, tenantId, sourceBackendId: plan.request.source.id, targetBackendId: plan.request.target.id, migrationId: plan.id, outcome: 'allowed', occurredAt: now().toISOString() })
      return c.json({ plan }, 201)
    } catch (error) {
      return failure(error)
    }
  })

  app.post('/tenants/:tenantId/placement/execute', async c => {
    const tenantId = string(c.req.param('tenantId'), 'tenant id')
    const authorized = await access(c.req.raw, 'placement:cutover', tenantId)
    if (authorized instanceof Response) return authorized
    if (!options.placementExecutor) return failure(new Error('Placement execution is not configured'), 501)
    let migrationId = ''
    let executionId = ''
    try {
      const input = await body(c)
      migrationId = string(input.migrationId, 'migration id')
      executionId = string(input.executionId, 'execution id')
      const plan = await options.store.getMigrationPlan(migrationId)
      if (!plan) return failure(new Error('Migration plan not found'), 404)
      if (plan.request.scope.kind !== 'tenants' || !plan.request.scope.tenantIds.includes(tenantId)) return failure(new Error('Migration plan tenant mismatch'), 409)
      const previous = await options.store.getMigrationStatus(migrationId)
      const current = await options.store.getTenantPlacement(tenantId)
      if (previous?.status === 'cutover') return c.json({ status: previous.status, cutover: previous.cutover, placement: current ? { ...current, backend: publicBackend(current.backend) } : null })
      if (!current || current.backend.id !== plan.request.source.id || current.backend.databaseId !== plan.request.source.databaseId) return failure(new Error('Migration plan is stale'), 409)
      const previousStatus = previous?.status
      const previousExecutionId = previous?.executionId
      const record = await options.store.beginMigrationExecution({ tenantId, migrationId, executionId })
      if (record.status === 'cutover') return c.json({ status: record.status, cutover: record.cutover, placement: { ...current, backend: publicBackend(current.backend) } })
      if (previousStatus === 'running' && previousExecutionId === executionId) return c.json({ status: 'running', migrationId }, 202)
      if (record.status === 'running') {
        const result = await options.placementExecutor.execute(plan)
        const cutover = assertBackendMigrationCutover(plan, result.verification, result.cutover)
        await options.store.recordMigrationVerification({ tenantId, plan, executionId, verification: result.verification, cutover })
      } else if (record.status !== 'verified' || !record.cutover) {
        return failure(new Error('Migration is not executable'), 409)
      }
      const verified = await options.store.getMigrationStatus(migrationId)
      if (!verified?.cutover) return failure(new Error('Migration verification is missing'), 409)
      const cutover = verified.cutover
      const placement = await options.store.recordTenantPlacement({ tenantId, plan, cutover })
      await options.audit({ action: 'placement:cutover', actorId: authorized.principal.userId, tenantId, sourceBackendId: plan.request.source.id, targetBackendId: plan.request.target.id, migrationId: plan.id, outcome: 'allowed', occurredAt: now().toISOString() })
      return c.json({ cutover, placement: { ...placement, backend: publicBackend(placement.backend) } })
    } catch (error) {
      if (migrationId) await options.store.markMigrationFailure({ migrationId, executionId: executionId || undefined, status: 'reconciling', message: error instanceof Error ? error.message : 'Migration execution failed' }).catch(() => undefined)
      return failure(error, 409)
    }
  })

  app.get('/tenants/:tenantId/placement/migrations/:migrationId', async c => {
    const tenantId = string(c.req.param('tenantId'), 'tenant id')
    const migrationId = string(c.req.param('migrationId'), 'migration id')
    const authorized = await access(c.req.raw, 'placement:read', tenantId)
    if (authorized instanceof Response) return authorized
    const plan = await options.store.getMigrationPlan(migrationId)
    const migration = await options.store.getMigrationStatus(migrationId)
    if (!plan || !migration) return failure(new Error('Migration not found'), 404)
    if (plan.request.scope.kind !== 'tenants' || !plan.request.scope.tenantIds.includes(tenantId)) return failure(new Error('Migration plan tenant mismatch'), 409)
    return c.json({ migration: { ...migration, plan } })
  })

  app.post('/tenants/:tenantId/placement/rollback', async c => {
    const tenantId = string(c.req.param('tenantId'), 'tenant id')
    const authorized = await access(c.req.raw, 'placement:rollback', tenantId)
    if (authorized instanceof Response) return authorized
    try {
      const input = await body(c)
      const migrationId = string(input.migrationId, 'migration id')
      const reason = string(input.reason, 'rollback reason', 1024)
      const plan = await options.store.createRollbackPlan({ tenantId, migrationId, reason, requestedAt: now().toISOString() })
      await options.audit({ action: 'placement:rollback', actorId: authorized.principal.userId, tenantId, sourceBackendId: plan.request.source.id, targetBackendId: plan.request.target.id, migrationId: plan.id, outcome: 'allowed', occurredAt: now().toISOString() })
      return c.json({ plan }, 201)
    } catch (error) {
      return failure(error, 409)
    }
  })

  app.post('/tenants/:tenantId/placement/reconcile', async c => {
    const tenantId = string(c.req.param('tenantId'), 'tenant id')
    const authorized = await access(c.req.raw, 'placement:reconcile', tenantId)
    if (authorized instanceof Response) return authorized
    try {
      const input = await body(c)
      const migrationId = string(input.migrationId, 'migration id')
      const action = string(input.action, 'reconciliation action') as 'retry' | 'mark-failed' | 'mark-reconciling' | 'commit-verified'
      const note = string(input.note, 'reconciliation note', 2048)
      const plan = await options.store.getMigrationPlan(migrationId)
      if (!plan || plan.request.scope.kind !== 'tenants' || !plan.request.scope.tenantIds.includes(tenantId)) return failure(new Error('Migration plan not found'), 404)
      if (action === 'commit-verified') {
        const migration = await options.store.getMigrationStatus(migrationId)
        if (!migration?.verification || !migration.cutover) return failure(new Error('Verified migration data is missing'), 409)
        const placement = await options.store.recordTenantPlacement({ tenantId, plan, cutover: migration.cutover })
        await options.audit({ action: 'placement:reconcile', actorId: authorized.principal.userId, tenantId, sourceBackendId: plan.request.source.id, targetBackendId: plan.request.target.id, migrationId: plan.id, outcome: 'allowed', occurredAt: now().toISOString() })
        return c.json({ migration: await options.store.getMigrationStatus(migrationId), placement: { ...placement, backend: publicBackend(placement.backend) } })
      }
      const migration = await options.store.reconcileMigration({ migrationId, action, note })
      await options.audit({ action: 'placement:reconcile', actorId: authorized.principal.userId, tenantId, sourceBackendId: plan.request.source.id, targetBackendId: plan.request.target.id, migrationId: plan.id, outcome: 'allowed', occurredAt: now().toISOString() })
      return c.json({ migration })
    } catch (error) {
      return failure(error, 409)
    }
  })

  return app
}
