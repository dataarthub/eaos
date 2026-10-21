/** Identity is supplied exclusively by the host's verified authentication middleware.
 * @see createWorkspaceContextResolver for host setup and usage.
 */
export interface WorkspaceIdentity {
  /** User ID established by verified host authentication. */
  userId: string
  /** Verified optional email; resolved contexts normalize absence to null. */
  email?: string | null
  /** Trusted platform authority; tenant roles cannot grant this privilege. Defaults to false. */
  isSuperAdmin?: boolean
}
/**
 * Host reads used by {@link createWorkspaceContextResolver}; filter inactive rows and apply schema policy in the adapter.
 */
export interface WorkspaceContextStore {
  /**
   * Loads the selected active tenant.
   * @param tenantId - Selected tenant ID from trusted routing.
   * @returns Active tenant display data, or undefined if unavailable.
   * @throws Persistence failures are wrapped as WorkspaceContextError with status 503.
   
   * @example
   * ```typescript
   * import type { WorkspaceContextStore } from "@alneas/eaos-server";
   * export async function readSelectedTenant(store: WorkspaceContextStore, trustedTenantId: string) {
   *   // Host storage filters inactive tenants and enforces its schema/access policy.
   *   const tenant = await store.readTenant(trustedTenantId);
   *   return tenant?.tenantName;
   * }
   * ```
   */
  readTenant(tenantId: string): Promise<{ 
  /** Display name of the selected active tenant; the context resolver falls back to tenantId when this value is empty. */
  tenantName: string; 
  /** Optional tenant industry classification; the context resolver substitutes generic when absent or empty. */
  industryType?: string } | undefined>
  /**
   * Loads the active membership for this tenant/user pair.
   * @param tenantId - Selected active tenant ID.
   * @param userId - Authenticated user ID.
   * @returns Membership role, or undefined if absent; tenant roles never establish platform authority.
   * @throws Persistence failures are wrapped as WorkspaceContextError with status 503.
   
   * @example
   * ```typescript
   * import type { WorkspaceContextStore } from "@alneas/eaos-server";
   * export async function readVerifiedMembership(
   *   store: WorkspaceContextStore, trustedTenantId: string, authenticatedUserId: string,
   * ) {
   *   const membership = await store.readMembership(trustedTenantId, authenticatedUserId);
   *   return membership?.role; // Absence must not grant tenant access.
   * }
   * ```
   */
  readMembership(tenantId: string, userId: string): Promise<{ 
  /** Role from the active tenant/user membership; the resolver trims it and normalizes blank or super_admin/superadmin values to member rather than granting platform authority. */
  role: string } | undefined>
}
/**
 * Resolved user identity and authorized tenant context returned by {@link createWorkspaceContextResolver}.
 */
export interface WorkspaceContext {
  /** Authenticated user ID. */
  userId: string
  /** Authorized selected tenant ID. */
  tenantId: string
  /** Verified email, or null when absent. */
  email: string | null
  /** Tenant display name, falling back to tenantId for an empty stored name. */
  tenantName: string
  /** Tenant industry, falling back to "generic" for an empty stored value. */
  industryType: string
  /** Trimmed membership role, member for unsafe/blank roles, or admin for a platform administrator without membership. */
  role: string
  /** Platform administrators receive SUPER_ADMIN, super_admin, admin; other users receive USER and their normalized role. */
  roles: string[]
  /** True only when the verified identity explicitly has platform authority. */
  isSuperAdmin: boolean
}
/**
 * Reports an authentication, membership, or host-store failure using an HTTP-compatible status.
 * @see createWorkspaceContextResolver for the resolver that rejects with this error.
 * @example
 * ```typescript
 * import { WorkspaceContextError } from "@alneas/eaos-server/workspace-context";
 * const error = new WorkspaceContextError(403, "Tenant membership required");
 * console.log(error.status); // 403
 * ```
 */
export class WorkspaceContextError extends Error {
  /**
   * Creates an error with a stable status and caller-supplied message.
   * @param status - 401 for missing identity, 403 for denied tenant access, or 503 for unavailable context data. This public readonly property is available for HTTP error mapping.
   * @param message - Human-readable failure description.
   */
  constructor(public readonly status: 401 | 403 | 503, message: string) { super(message) }
}
/**
 * Builds a resolver that requires an existing tenant and membership or verified platform authority.
 * @param store - Host-owned active tenant and membership reads; see {@link WorkspaceContextStore}.
 * @returns An async resolver accepting verified identity and a selected tenant ID, resolving a fresh context. Missing email becomes null, tenantName falls back to tenant ID, and industryType falls back to "generic".
 * @throws The returned resolver rejects with WorkspaceContextError: 401 for empty userId, 403 for missing/unavailable tenant or denied membership, and 503 for other store failures.
 * @remarks The host supplies verified identity, schema, active-row filtering, and credentials. Reads are sequential and not wrapped in a transaction here. Platform administrators may select existing tenants without membership; membership role strings cannot grant platform authority. Blank or super_admin/superadmin membership roles normalize to member. This function writes no persistent data.
 * @example
 * ```typescript
 * import { createWorkspaceContextResolver, type WorkspaceContextStore, type WorkspaceIdentity } from "@alneas/eaos-server/workspace-context";
 * export async function selectedWorkspace(store: WorkspaceContextStore, identity: WorkspaceIdentity, tenantId: string) {
 *   // The host implements active-row reads and authenticates identity before this call.
 *   return createWorkspaceContextResolver(store)(identity, tenantId);
 * }
 * ```
 */
export function createWorkspaceContextResolver(store: WorkspaceContextStore) {
  return async (identity: WorkspaceIdentity, tenantId: string | undefined): Promise<WorkspaceContext> => {
    if (!identity.userId) throw new WorkspaceContextError(401, 'Authentication required')
    if (!tenantId) throw new WorkspaceContextError(403, 'Tenant membership required')
    try {
      const tenant = await store.readTenant(tenantId)
      if (!tenant) throw new WorkspaceContextError(403, 'Tenant unavailable')
      const member = await store.readMembership(tenantId, identity.userId)
      const isSuperAdmin = identity.isSuperAdmin === true
      if (!member && !isSuperAdmin) throw new WorkspaceContextError(403, 'Tenant membership required')
      // A tenant role never grants platform authority. Platform administrators may operate a selected tenant.
      const selected = String(member?.role ?? (isSuperAdmin ? 'admin' : 'member')).trim()
      const role = !selected || ['super_admin', 'superadmin'].includes(selected.toLowerCase()) ? 'member' : selected
      return { userId: identity.userId, tenantId, email: identity.email ?? null,
        tenantName: tenant.tenantName || tenantId, industryType: tenant.industryType || 'generic',
        role, roles: isSuperAdmin ? ['SUPER_ADMIN', 'super_admin', 'admin'] : ['USER', role], isSuperAdmin }
    } catch (error) {
      if (error instanceof WorkspaceContextError) throw error
      throw new WorkspaceContextError(503, 'Tenant context unavailable')
    }
  }
}
