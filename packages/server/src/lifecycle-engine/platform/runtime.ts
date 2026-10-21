import type { BackendTarget } from '../index'
import type { PlatformPackage } from './artifacts'

/**
 * Nonsecret target catalog for routing databases within one shared execution host.
 * 
 * 
 * Database placement inside one shared execution host. Targets reuse lifecycle identities.
 * @see validatePlatformRuntime for canonical integration usage.
 */
export interface PlatformRuntimeConfig {
  /**
   * Default target used for tenants without an explicit placement.
   */
  backend: BackendTarget
  /**
   * Optional additional target definitions with distinct IDs.
   */
  databaseTargets?: BackendTarget[]
  /**
   * Optional verified tenant ID to configured target-ID map; dedicated additional targets require explicit entries.
   */
  tenantPlacements?: Record<string, string>
}
function validTarget(b: BackendTarget): boolean {
  return !!b && typeof b === 'object' && !Array.isArray(b) && !Object.keys(b).some(k => !['id', 'databaseId', 'dialect', 'mode', 'tenantId'].includes(k))
    && typeof b.id === 'string' && !!b.id.trim() && typeof b.databaseId === 'string' && !!b.databaseId.trim()
    && ['sqlite', 'oracle', 'postgres'].includes(b.dialect) && ['shared', 'dedicated'].includes(b.mode)
    && (b.mode === 'shared' ? b.tenantId === undefined : typeof b.tenantId === 'string' && !!b.tenantId.trim() && b.tenantId === b.tenantId.trim() && b.tenantId !== '*')
}
/**
 * Lists the default and additional configured database targets in declaration order.
 * @param runtime - Platform runtime configuration; validate it before use.
 * @returns A new array containing runtime.backend followed by databaseTargets; target objects are shared.
 * 
 * @remarks
 * Does not validate or deduplicate targets and performs no discovery or connection.
 * 
 * @example
 * ```typescript
 * import { platformDatabaseTargets } from '@alneas/eaos-server/platform/runtime';
 * const targets = platformDatabaseTargets({ backend: { id: 'main', databaseId: 'db-main', dialect: 'sqlite', mode: 'shared' } });
 * ```
 */
export function platformDatabaseTargets(runtime: PlatformRuntimeConfig): BackendTarget[] { return [runtime.backend, ...(runtime.databaseTargets ?? [])] }
/**
 * Validates explicit database placements and verifies that registered package tenants resolve to permitted targets.
 * @param value - Untrusted runtime declaration, or undefined when no runtime is configured.
 * @param packages - Validated package registrations whose tenant scopes must resolve; defaults to none.
 * @returns The original runtime object when accepted, or undefined for absent configuration.
 * @throws Error for malformed/duplicate targets, shared/dedicated scope mismatch, missing explicit placements or unresolved package tenants.
 * 
 * @remarks
 * Dedicated targets require unique physical database IDs and explicit placements unless they are the default backend. This checks nonsecret declarations only; host pools, provisioning and membership remain external.
 * 
 * @example
 * ```typescript
 * import { validatePlatformRuntime } from '@alneas/eaos-server/platform/runtime';
 * const runtime = validatePlatformRuntime({ backend: { id: 'main', databaseId: 'db-main', dialect: 'sqlite', mode: 'shared' } });
 * ```
 */
export function validatePlatformRuntime(value: unknown, packages: PlatformPackage[] = []): PlatformRuntimeConfig | undefined {
  if (value === undefined) return undefined
  const v = value as PlatformRuntimeConfig
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['backend', 'databaseTargets', 'tenantPlacements'].includes(k))
    || !validTarget(v.backend) || (v.databaseTargets !== undefined && !Array.isArray(v.databaseTargets))) throw new Error('Invalid platform runtime backend')
  const targets = platformDatabaseTargets(v), ids = new Set<string>(), dedicatedTenants = new Set<string>()
  for (const target of targets) {
    if (!validTarget(target) || ids.has(target.id)) throw new Error('Invalid or duplicate database target')
    ids.add(target.id)
    if (target.mode === 'dedicated') {
      if (dedicatedTenants.has(target.tenantId!)) throw new Error('Duplicate dedicated tenant target')
      dedicatedTenants.add(target.tenantId!)
      if (targets.some(other => other.id !== target.id && other.databaseId === target.databaseId)) throw new Error('Dedicated database must have its own databaseId')
    }
  }
  if (v.tenantPlacements !== undefined && (!v.tenantPlacements || typeof v.tenantPlacements !== 'object' || Array.isArray(v.tenantPlacements))) throw new Error('Invalid tenant placements')
  for (const [tenant, id] of Object.entries(v.tenantPlacements ?? {})) {
    const target = targets.find(t => t.id === id)
    if (!tenant.trim() || tenant !== tenant.trim() || tenant === '*' || !target || (target.mode === 'dedicated' && target.tenantId !== tenant)) throw new Error('Tenant placement does not match database target')
  }
  for (const target of targets) if (target.mode === 'dedicated' && target.id !== v.backend.id && v.tenantPlacements?.[target.tenantId!] !== target.id) throw new Error('Dedicated database requires an explicit tenant placement')
  for (const entry of packages) for (const tenant of entry.tenantIds) resolvePlatformDatabaseTarget(v, tenant)
  return v
}
/**
 * Resolves a verified tenant to its explicit placement or the configured default backend.
 * 
 * Tenant comes from verified host membership, never raw request input. No implicit migration/fallback.
 * @param runtime - Previously validated runtime configuration.
 * @param tenantId - Verified concrete tenant from host membership, never raw request input.
 * @returns The configured target object without cloning.
 * @throws Error for missing/wildcard tenant or unavailable/mismatched target.
 * 
 * @remarks
 * Unmapped tenants use the configured default; a missing or dedicated-mismatched selected target fails rather than trying another database. No migration or database operation occurs.
 * 
 * @example
 * ```typescript
 * import { resolvePlatformDatabaseTarget } from '@alneas/eaos-server/platform/runtime';
 * const target = resolvePlatformDatabaseTarget({ backend: { id: 'main', databaseId: 'db-main', dialect: 'sqlite', mode: 'shared' } }, 'sample');
 * ```
 */
export function resolvePlatformDatabaseTarget(runtime: PlatformRuntimeConfig, tenantId: string): BackendTarget {
  if (typeof tenantId !== 'string' || !tenantId.trim() || tenantId === '*') throw new Error('Verified tenant is required')
  const id = Object.hasOwn(runtime.tenantPlacements ?? {}, tenantId) ? runtime.tenantPlacements![tenantId] : runtime.backend.id
  const target = platformDatabaseTargets(runtime).find(t => t.id === id)
  if (!target || (target.mode === 'dedicated' && target.tenantId !== tenantId)) throw new Error('Tenant database target unavailable')
  return target
}
