import { createHash, randomUUID } from 'node:crypto'
import { parseAccountMemberships, type AccountMemberships } from '@alneas/eaos-server/platform'
/**
 * Provider metadata field updated by a membership migration; public metadata is visible to its account holder.
 * @see applyAccountMembershipChange.
 */
export type AccountMetadataField = 'metadata_public' | 'metadata_admin'
/**
 * Provider identity snapshot used for optimistic checks and metadata-preserving writes.
 * @see planAccountMembershipPublication.
 */
export interface ManagedIdentity {
 /** Provider identity ID. */
 id: string
 /** Provider lifecycle state; membership operations require active. */
 state: string
 /** Optional editable traits; never used as membership authority here. */
 traits?: Record<string, unknown>
 /** Public provider metadata; published membership fields are user-visible. */
 metadata_public?: Record<string, unknown>
 /** Private administrator metadata; legacy membership migration defaults to this field. */
 metadata_admin?: Record<string, unknown>
}
/**
 * Reviewed membership replacement bound to a hash of the selected metadata snapshot.
 * @see applyAccountMembershipChange.
 */
export interface MembershipMigrationPlan {
 /** Identity whose metadata is being changed. */
 identityId: string
 /** metadataHash of the selected metadata field before the change. */
 beforeMetadataHash: string
 /** Validated target membership claims; all membership fields are replaced. */
 memberships: AccountMemberships
 /** Metadata destination; omitted preserves the metadata_admin migration contract. */
 metadataField?: AccountMetadataField
}
/**
 * Hashes metadata after recursively sorting object keys while preserving array order.
 * @param metadata - JSON-serializable metadata; null/undefined at the root are normalized to an empty object.
 * @returns Lower-case SHA-256 hexadecimal digest of canonicalized JSON.
 * @throws For cyclic, BigInt, or other values that JSON serialization cannot encode.
 * @remarks This is an optimistic snapshot comparison, not a signature or authentication mechanism.
 * @example
 * ```typescript
 * import { metadataHash } from "@alneas/eaos-server/browser-auth/account-memberships";
 * console.log(metadataHash({ b: 2, a: 1 }) === metadataHash({ a: 1, b: 2 })); // true
 * ```
 */
export function metadataHash(metadata: unknown): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])) : value
  return createHash('sha256').update(JSON.stringify(canonical(metadata ?? {}))).digest('hex')
}
/**
 * Durable mutation lock and audit boundary for account metadata updates.
 * @remarks A failed or uncertain update retains its lock. The host must reconcile it rather than auto-expire or blindly retry.
 * @see applyAccountMembershipChange.
 */
export interface AccountMutationStore {
  /**
   * Acquires an exclusive durable mutation lock before provider reads/writes.
   * @param identityId - Provider identity being changed.
   * @param token - Fresh mutation token generated for this attempt.
   * @param actor - Nonblank authenticated operator identity.
   * @returns No value; resolves only when the lock is held.
   * @throws Rejects conflicting or unavailable persistence; provider work will not start.
   
   * @example
   * ```typescript
   * import type { AccountMutationStore } from "@alneas/eaos-server/browser-auth";
   * export async function lockReviewedIdentity(
   *   store: AccountMutationStore, identityId: string, freshMutationToken: string, authenticatedActor: string,
   * ) {
   *   await store.acquire(identityId, freshMutationToken, authenticatedActor);
   *   // Keep the token until verified completion; uncertain writes require reconciliation.
   * }
   * ```
   */
  acquire(identityId: string, token: string, actor: string): Promise<void>
  /**
   * Records verified completion and finalizes the durable lock/audit state.
   * @param identityId - Changed provider identity.
   * @param token - Token acquired for this attempt; enforce ownership in the host store.
   * @param actor - Authenticated operator identity.
   * @param beforeHash - Reviewed pre-change snapshot hash.
   * @param afterHash - Hash read back and verified after the update.
   * @returns No value; resolves when completion is durably recorded.
   * @throws Persistence errors propagate after the provider may already have changed.
   
   * @example
   * ```typescript
   * import type { AccountMutationStore } from "@alneas/eaos-server/browser-auth";
   * export async function finishVerifiedIdentityMutation(
   *   store: AccountMutationStore, identityId: string, ownedToken: string, authenticatedActor: string,
   *   reviewedBeforeHash: string, verifiedAfterHash: string,
   * ) {
   *   // Call only after reading back and verifying the actual provider metadata update.
   *   await store.complete(identityId, ownedToken, authenticatedActor, reviewedBeforeHash, verifiedAfterHash);
   * }
   * ```
   */
  complete(identityId: string, token: string, actor: string, beforeHash: string, afterHash: string): Promise<void>
}
/**
 * Host-authorized provider administration used by account membership operations.
 * @see publishAccountMemberships.
 */
export interface AccountAdminPort {
  /**
   * Reads the authoritative current provider identity, including both metadata fields.
   * @param identityId - Provider identity ID.
   * @returns Current identity snapshot used for lifecycle and hash checks.
   * @throws Provider errors propagate and retain any acquired durable lock.
   
   * @example
   * ```typescript
   * import type { AccountAdminPort } from "@alneas/eaos-server/browser-auth";
   * export async function readAuthoritativeIdentity(admin: AccountAdminPort, identityId: string) {
   *   // The host supplies an authorized provider-admin connection.
   *   const identity = await admin.read(identityId);
   *   return { id: identity.id, state: identity.state };
   * }
   * ```
   */
  read(identityId: string): Promise<ManagedIdentity>
  /**
   * Writes selected metadata while preserving unrelated identity fields.
   * @param identity - Authoritative identity snapshot; publication supplies both changed metadata fields and requires the port to PUT both in one provider request.
   * @param metadata - Complete replacement value for the selected metadata field.
   * @param field - Selected destination field.
   * @returns No value; resolves when the provider acknowledges the write, before independent readback verification.
   * @throws Provider failures propagate; the provider outcome may be uncertain and the durable lock must remain held.
   
   * @example
   * ```typescript
   * import type { AccountAdminPort } from "@alneas/eaos-server/browser-auth";
   * export async function writeReviewedIdentityMetadata(
   *   admin: AccountAdminPort,
   *   currentIdentity: Parameters<AccountAdminPort["write"]>[0],
   *   reviewedMetadata: Parameters<AccountAdminPort["write"]>[1],
   *   reviewedField: Parameters<AccountAdminPort["write"]>[2],
   * ) {
   *   // Host workflow acquires the mutation lock and checks the reviewed snapshot first.
   *   await admin.write(currentIdentity, reviewedMetadata, reviewedField);
   *   // Read back through admin.read before recording durable mutation completion.
   * }
   * ```
   */
  write(identity: ManagedIdentity, metadata: Record<string, unknown>, field: AccountMetadataField): Promise<void>
}
/**
 * Replaces membership fields under a durable lock and verifies provider readback before recording completion.
 * @param plan - Reviewed target claims, metadata field, and expected pre-change field hash.
 * @param actor - Nonblank authenticated operator identity; authorization is host-owned.
 * @param store - Durable exclusive lock and completion audit implementation.
 * @param admin - Trusted provider read/write implementation.
 * @returns No value; resolves after verified provider update and durable completion. Unrelated metadata keys are retained and absent defaultTenantId is written as null.
 * @throws Rejects invalid actor/metadata field/claims, stale or inactive identity, failed readback, or propagated lock/provider/completion errors.
 * @remarks A failed/uncertain mutation retains its durable lock. Reconcile; never auto-expire or blindly retry. This function does not roll back provider changes. Defaults to metadata_admin; explicitly selecting metadata_public exposes claims to the account holder.
 * @example
 * ```typescript
 * import { applyAccountMembershipChange, type MembershipMigrationPlan, type AccountMutationStore, type AccountAdminPort } from "@alneas/eaos-server/browser-auth/account-memberships";
 * export async function applyReviewedPlan(plan: MembershipMigrationPlan, actor: string, store: AccountMutationStore, admin: AccountAdminPort) {
 *   await applyAccountMembershipChange(plan, actor, store, admin);
 * }
 * ```
 */
export async function applyAccountMembershipChange(plan: MembershipMigrationPlan, actor: string, store: AccountMutationStore, admin: AccountAdminPort) {
  if (!actor.trim()) throw Error('Operator identity required')
  // Preserve the existing private-metadata contract unless the host opts in.
  const field = plan.metadataField ?? 'metadata_admin'
  if (!['metadata_public', 'metadata_admin'].includes(field)) throw Error('Invalid membership metadata field')
  const target = parseAccountMemberships(plan.memberships)
  const token = randomUUID()
  await store.acquire(plan.identityId, token, actor)
  const identity = await admin.read(plan.identityId)
  if (identity.id !== plan.identityId || identity.state !== 'active' || metadataHash(identity[field]) !== plan.beforeMetadataHash) throw Error('Stale identity migration plan; reconcile lock')
  const next = { ...(identity[field] ?? {}), eaos_memberships: target.memberships, eaos_default_tenant_id: target.defaultTenantId ?? null }
  // Null clears a previous default; reader treats it as absent.
  await admin.write(identity, next, field)
  const verified = await admin.read(plan.identityId)
  const afterHash = metadataHash(next)
  if (verified.id !== identity.id || verified.state !== 'active' || metadataHash(verified[field]) !== afterHash) throw Error('Identity update could not be verified; reconcile lock')
  await store.complete(plan.identityId, token, actor, plan.beforeMetadataHash, afterHash)
}

/**
 * Reviewed plan moving existing private membership fields into public metadata without changing claims.
 * @see planAccountMembershipPublication.
 */
export interface MembershipPublicationPlan {
 /** Active identity whose memberships will become public. */
 identityId: string
 /** Combined public/admin metadata snapshot hash used to detect stale plans. */
 beforeMetadataHash: string
 /** Validated claims copied from private membership fields. */
 memberships: AccountMemberships
}
const membershipKeys = ['eaos_memberships', 'eaos_default_tenant_id'] as const
const identityMetadataHash = (identity: ManagedIdentity) => metadataHash({ metadata_public: identity.metadata_public ?? {}, metadata_admin: identity.metadata_admin ?? {} })

/**
 * Plans moving existing administrator membership claims into public identity metadata.
 * @param identity - Active authoritative identity snapshot containing private membership fields and no public membership fields.
 * @returns A new publication plan binding parsed claims to the combined public/admin metadata hash; no writes occur.
 * @throws For inactive identity, missing private memberships, existing public membership fields, invalid claims, or unhashable metadata.
 * @remarks Review the returned plan before publication: membership fields become visible to the account holder.
 * @example
 * ```typescript
 * import { planAccountMembershipPublication, type AccountAdminPort } from "@alneas/eaos-server/browser-auth/account-memberships";
 * export async function reviewPlan(admin: AccountAdminPort, identityId: string) {
 *   return planAccountMembershipPublication(await admin.read(identityId));
 * }
 * ```
 */
export function planAccountMembershipPublication(identity: ManagedIdentity): MembershipPublicationPlan {
  if (identity.state !== 'active') throw Error('Active identity required')
  const source = identity.metadata_admin ?? {}
  if (!Object.hasOwn(source, 'eaos_memberships')) throw Error('Private memberships required for publication')
  const memberships = parseAccountMemberships({ memberships: source.eaos_memberships, defaultTenantId: source.eaos_default_tenant_id ?? undefined })
  const existing = identity.metadata_public ?? {}
  if (membershipKeys.some(key => Object.hasOwn(existing, key))) throw Error('Public membership fields already exist; reconcile before publication')
  return { identityId: identity.id, beforeMetadataHash: identityMetadataHash(identity), memberships }
}

/**
 * Moves reviewed membership fields from administrator to public metadata in one provider write and verifies readback.
 * @param plan - Reviewed publication plan; current private claims must still match exactly.
 * @param actor - Nonblank authenticated operator identity.
 * @param store - Durable exclusive mutation lock and completion audit.
 * @param admin - Provider port that must write both metadata fields from the supplied identity in one request.
 * @returns No value; resolves after verified readback and durable completion, retaining unrelated public/private metadata.
 * @throws Rejects invalid actor/claims, stale snapshot, changed memberships, failed provider verification, or propagated store/provider failures.
 * @remarks The durable lock remains on any failed or uncertain outcome; reconcile instead of blind retry. This function does not roll back or independently authenticate the operator. Atomicity of the two-field update depends on the host port honoring its single-request contract.
 * @example
 * ```typescript
 * import { publishAccountMemberships, type MembershipPublicationPlan, type AccountMutationStore, type AccountAdminPort } from "@alneas/eaos-server/browser-auth/account-memberships";
 * export async function publishReviewedPlan(plan: MembershipPublicationPlan, actor: string, store: AccountMutationStore, admin: AccountAdminPort) {
 *   await publishAccountMemberships(plan, actor, store, admin);
 * }
 * ```
 */
export async function publishAccountMemberships(plan: MembershipPublicationPlan, actor: string, store: AccountMutationStore, admin: AccountAdminPort) {
  if (!actor.trim()) throw Error('Operator identity required')
  const target = parseAccountMemberships(plan.memberships)
  const token = randomUUID()
  await store.acquire(plan.identityId, token, actor)
  const identity = await admin.read(plan.identityId)
  if (identity.id !== plan.identityId || identity.state !== 'active' || identityMetadataHash(identity) !== plan.beforeMetadataHash) throw Error('Stale membership publication plan; reconcile lock')
  const current = planAccountMembershipPublication(identity)
  if (metadataHash(current.memberships) !== metadataHash(target)) throw Error('Publication plan changes memberships; reconcile lock')
  const privateMetadata = { ...(identity.metadata_admin ?? {}) }
  for (const key of membershipKeys) delete privateMetadata[key]
  const publicMetadata = { ...(identity.metadata_public ?? {}), eaos_memberships: target.memberships, eaos_default_tenant_id: target.defaultTenantId ?? null }
  const next = { ...identity, metadata_admin: privateMetadata, metadata_public: publicMetadata }
  // The port must PUT both metadata fields from this identity in one request.
  await admin.write(next, publicMetadata, 'metadata_public')
  const verified = await admin.read(plan.identityId)
  const afterHash = identityMetadataHash(next)
  if (verified.id !== identity.id || verified.state !== 'active' || identityMetadataHash(verified) !== afterHash) throw Error('Membership publication could not be verified; reconcile lock')
  await store.complete(plan.identityId, token, actor, plan.beforeMetadataHash, afterHash)
}
