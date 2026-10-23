/**
 * Platform tenant identity and admission metadata independent of company/person business schemas.
 * 
 * 
 * Platform contracts are independent of a consumer's employee/company schema.
 * @see PluginLifecycle for canonical integration usage.
 */
export interface PlatformTenant {
  /**
   * Concrete platform tenant identifier.
   */
  id: string;
  /**
   * Whether tenant admission is enabled.
   */
  active: boolean;
  /**
   * Host-configured tenant lookup domains; domain mapping alone never proves membership.
   */
  domains: readonly string[] }
/**
 * Host tenant lookup and current authenticated membership checks.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface TenantDirectory {
  /**
   * Find a tenant by exact ID; resolve null when unavailable.
   * @param id - Concrete tenant ID whose platform record is requested.
   * @returns The matching platform tenant, or null when unavailable.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { TenantDirectory } from '@alneas/eaos-server/platform';
   * export async function findTenant(directory: TenantDirectory, verifiedTenantId: string) {
   *   const tenant = await directory.find(verifiedTenantId);
   *   return tenant?.active === true ? tenant : null;
   * }
   * ```
   */
  find(id: string): Promise<PlatformTenant | null>
  /**
   * Find a tenant by verified host/domain mapping; null when unmapped; never infer user membership.
   * 
   * A domain mapping does not prove user membership.
   * @param domain - Verified lookup domain; mapping alone never proves membership.
   * @returns The mapped tenant, or null; membership must be checked separately.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { TenantDirectory } from '@alneas/eaos-server/platform';
   * export async function routeTenant(directory: TenantDirectory, trustedHostname: string) {
   *   // Routing hints still require independent authenticated membership checks.
   *   return directory.findByDomain(trustedHostname);
   * }
   * ```
   */
  findByDomain(domain: string): Promise<PlatformTenant | null>
  /**
   * Check the current authenticated user's membership in the specified tenant.
   * @param tenantId - Verified concrete tenant ID whose current state or permission is requested.
   * @param userId - Authenticated user ID checked against live host membership.
   * @returns True only when current host membership permits this tenant.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { TenantDirectory } from '@alneas/eaos-server/platform';
   * export async function admitted(directory: TenantDirectory, tenantId: string, userId: string) {
   *   return directory.isMember(tenantId, userId);
   * }
   * ```
   */
  isMember(tenantId: string, userId: string): Promise<boolean>
}
export type { LifecycleStore, LifecycleState, BackendTarget, Installation, MigrationRecord } from '../index'
export type { GatekeeperAuditEntry } from '@alneas/eaos-core/security/gatekeeper'
/**
 * Durable acknowledgement contract for verified-context audit events.
 * 
 * Implementations must acknowledge durable storage; tenant/actor come from verified runtime context.
 * @typeParam T - Immutable verified-context event payload appended by the host.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface AuditSink<T> {
  /**
   * Persist the immutable event and resolve only when durable; reject when evidence cannot be recorded.
   * @param event - Immutable event with tenant/actor derived from verified runtime context; exclude secrets.
   * @returns Resolves without a value only after durable audit acknowledgement.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { AuditSink } from '@alneas/eaos-server/platform';
   * export async function audit(sink: AuditSink<{ action: string; tenantId: string; actorId: string }>, tenantId: string, actorId: string) {
   *   await sink.append({ action: "example.reviewed", tenantId, actorId });
   * }
   * ```
   */
  append(event: Readonly<T>): Promise<void> }
export * from './control-plane'
export * from './artifacts'
export * from './deployment'
export * from './deployment-placements'
export * from './runtime'
export * from './database-router'

export * from './user-directory'
export * from './site-publication'

export * from './directory-routes'
