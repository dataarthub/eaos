/**
 * Host-verified tenant membership used for authorization, separate from business person records.
 * 
 * 
 * Account membership is authorization data; business people do not grant access.
 * @see parseAccountMemberships for canonical integration usage.
 */
export interface AccountMembership {
  /**
   * Concrete tenant ID, at most 50 supported identifier characters.
   */
  tenantId: string;
  /**
   * Tenant-scoped role, at most 50 characters; platform-global role names are forbidden.
   */
  role: string;
  /**
   * Whether the membership currently grants tenant admission.
   */
  active: boolean }
/**
 * Validated tenant memberships with optional explicit active default selection.
 * 
 * @see parseAccountMemberships for canonical integration usage.
 */
export interface AccountMemberships {
  /**
   * At most 1000 distinct tenant grants; empty means no tenant access.
   */
  memberships: readonly AccountMembership[];
  /**
   * Optional tenant among active memberships; omitted requires selection when multiple are active.
   */
  defaultTenantId?: string }
/**
 * Supported business directory person categories; categories never grant account membership.
 * 
 * @see parseAccountMemberships for canonical integration usage.
 */
export const personKinds = ['employee', 'contractor', 'partner_contact', 'customer_contact', 'other'] as const
/**
 * One supported business relationship category from personKinds.
 * 
 * @see parseAccountMemberships for canonical integration usage.
 */
export type PersonKind = typeof personKinds[number]
/**
 * Tenant-scoped business contact/person metadata that never grants authenticated membership.
 * 
 * @see parseAccountMemberships for canonical integration usage.
 */
export interface DirectoryPerson {
  /**
   * Business person record ID.
   */
  id: string
  /**
   * Tenant owning this directory record.
   */
  tenantId: string
  /**
   * Optional link to a host identity; linkage alone grants no access.
   */
  identityId?: string
  /**
   * Stored display/legal name from explicit or verified creation inputs.
   */
  name: string
  /**
   * Optional contact address; never used to manufacture a name.
   */
  email?: string
  /**
   * Optional organization display text.
   */
  organizationName?: string
  /**
   * Business relationship categories, independent of account roles.
   */
  kinds: readonly PersonKind[]
  /**
   * Business directory status, independent of login authorization.
   */
  active: boolean
}

/**
 * Normalizes bounded tenant memberships while rejecting duplicate tenant grants and platform-wide roles.
 * 
 * Fail closed on malformed/duplicate membership data; provider metadata is host-owned.
 * @param value - Host-owned verified provider metadata with at most 1000 membership entries and optional active defaultTenantId.
 * @returns New membership records and an optional default tenant; unknown metadata fields are omitted.
 * @throws Error for malformed IDs/roles, duplicate tenants, nonboolean active flags, forbidden global roles or a default outside active memberships.
 * 
 * @remarks
 * Tenant roles do not grant platform administration. Parsing validates shape, not metadata authenticity; business directory people never establish access.
 * 
 * @example
 * ```typescript
 * import { parseAccountMemberships } from '@alneas/eaos-server/platform/user-directory';
 * const account = parseAccountMemberships({ memberships: [{ tenantId: 'sample', role: 'member', active: true }], defaultTenantId: 'sample' });
 * ```
 */
export function parseAccountMemberships(value: unknown): AccountMemberships {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid account memberships')
  const input = value as Record<string, unknown>
  if (!Array.isArray(input.memberships) || input.memberships.length > 1000) throw new Error('Invalid account memberships')
  const seen = new Set<string>()
  const memberships = input.memberships.map((item): AccountMembership => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid membership')
    const { tenantId, role, active } = item as Record<string, unknown>
    if (typeof tenantId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,49}$/.test(tenantId)
      || typeof role !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,49}$/.test(role)
      || ['superadmin', 'super_admin', 'platform_admin'].includes(role.toLowerCase())
      || typeof active !== 'boolean' || seen.has(tenantId)) throw new Error('Invalid membership')
    seen.add(tenantId)
    return { tenantId, role, active }
  })
  const defaultTenantId = input.defaultTenantId
  if (defaultTenantId !== undefined && (typeof defaultTenantId !== 'string' || !memberships.some(m => m.tenantId === defaultTenantId && m.active))) throw new Error('Invalid default tenant')
  return { memberships, ...(typeof defaultTenantId === 'string' ? { defaultTenantId } : {}) }
}
/**
 * Selects an account's declared default or its only active membership without choosing among multiple active tenants.
 * @param account - Previously parsed AccountMemberships; this helper does not revalidate the default.
 * @returns The default tenant, the sole active tenant, or undefined when explicit selection is needed/no active membership exists.
 * 
 * @example
 * ```typescript
 * import { parseAccountMemberships, selectAccountTenant } from '@alneas/eaos-server/platform/user-directory';
 * const tenantId = selectAccountTenant(parseAccountMemberships({ memberships: [{ tenantId: 'sample', role: 'member', active: true }] }));
 * ```
 */
export function selectAccountTenant(account: AccountMemberships): string | undefined {
  const active = account.memberships.filter(m => m.active)
  return account.defaultTenantId ?? (active.length === 1 ? active[0]?.tenantId : undefined)
}
/**
 * Chooses a trimmed explicit name or verified display name for initial person creation.
 * 
 * Only at initial creation: require a real name, never manufacture one from email.
 * @param explicitName - User-supplied name; nonstring/blank values fall back to verified display name.
 * @param verifiedDisplayName - Trusted provider display name; email addresses are not synthesized into names.
 * @returns The chosen trimmed nonblank name, at most 200 characters.
 * @throws Error when both names are blank/nonstring or the chosen name exceeds 200 characters.
 * 
 * @remarks
 * Use only at initial registration; this helper does not update existing profiles or validate legal identity.
 * 
 * @example
 * ```typescript
 * import { initialPersonName } from '@alneas/eaos-server/platform/user-directory';
 * const name = initialPersonName('Sample Person', undefined);
 * ```
 */
export function initialPersonName(explicitName: unknown, verifiedDisplayName: unknown): string {
  const explicit = typeof explicitName === 'string' ? explicitName.trim() : ''
  const display = typeof verifiedDisplayName === 'string' ? verifiedDisplayName.trim() : ''
  const name = explicit || display
  if (!name || name.length > 200) throw new Error('Person name required (maximum 200 characters)')
  return name
}
