/**
 * Whether plugin data may or must use external object storage.
 * @see {@link resolvePluginStoragePolicy}
 */
export type ObjectStorageRequirement = 'forbidden' | 'optional' | 'required'
/**
 * Declared archival destination or retention deletion strategy; execution belongs to the host.
 * @see {@link resolvePluginStoragePolicy}
 */
export type ArchiveMode = 'none' | 'object-storage' | 'cold-storage' | 'delete-after-retention'

/**
 * Archive strategy and required delay for modes other than none.
 * @see {@link resolvePluginStoragePolicy}
 */
export interface PluginArchivePolicy {
  
  /** Selected operation/storage/execution variant; the owning discriminated union determines applicable fields. */
  mode: ArchiveMode
  /** Required for every mode except none. */
  afterDays?: number
}

/**
 * Per-record payload bounds, object-storage requirement and history/archive retention policy.
 * @see {@link resolvePluginStoragePolicy}
 */
export interface PluginStoragePolicy {
  /** Maximum UTF-8 JSON payload for one DB record. */
  maxPayloadBytes: number
  /** Whether large/private bodies must be kept outside the operational DB. */
  objectStorage: ObjectStorageRequirement
  /** null means retain history indefinitely; deletion is never automatic on uninstall. */
  historyRetentionDays: number | null
  
/** Declared retention/archive strategy; validation does not execute archives or deletion. */
  archive: PluginArchivePolicy
}

/**
 * Default 4 MiB payload limit, optional object storage, indefinite history and no archive.
 * @see {@link resolvePluginStoragePolicy}
 */
export const DEFAULT_PLUGIN_STORAGE_POLICY: Readonly<PluginStoragePolicy> = Object.freeze({
  maxPayloadBytes: 4 * 1024 * 1024,
  objectStorage: 'optional',
  historyRetentionDays: null,
  archive: { mode: 'none' },
} as const)

function positiveInteger(value: unknown, name: string, allowNull = false): number | null {
  if (allowNull && value === null) return null
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`Invalid storage policy ${name}`)
  return Number(value)
}

/**
 * Validate and normalize record retention and storage constraints.
 * @param policy - Policy with a positive safe-integer payload limit up to 64 MiB, positive retention days or null, and a compatible archive policy.
 * @returns A new policy object with a new archive object.
 * @throws Error for invalid values, missing archive delay, archive delay with none, indefinite delete retention, or external archives when object storage is forbidden.
 * @remarks Validation does not schedule archives, delete records or provision object storage.
 * @example
 * ```typescript
 * import { assertPluginStoragePolicy } from "@alneas/eaos-core/plugin-sdk/storage-policy";
 * const policy = assertPluginStoragePolicy({ maxPayloadBytes: 1024, objectStorage: "optional", historyRetentionDays: null, archive: { mode: "none" } });
 * console.log(policy.maxPayloadBytes);
 * ```
 */
export function assertPluginStoragePolicy(policy: PluginStoragePolicy): PluginStoragePolicy {
  if (!policy || typeof policy !== 'object') throw new Error('Storage policy is required')
  const maxPayloadBytes = positiveInteger(policy.maxPayloadBytes, 'maxPayloadBytes')!
  if (maxPayloadBytes > 64 * 1024 * 1024) throw new Error('Storage policy maxPayloadBytes is too large')
  if (!['forbidden', 'optional', 'required'].includes(policy.objectStorage)) throw new Error('Invalid storage policy objectStorage')
  const historyRetentionDays = positiveInteger(policy.historyRetentionDays, 'historyRetentionDays', true)
  if (!policy.archive || typeof policy.archive !== 'object' || !['none', 'object-storage', 'cold-storage', 'delete-after-retention'].includes(policy.archive.mode)) throw new Error('Invalid storage policy archive mode')
  const afterDays = policy.archive.afterDays === undefined ? undefined : positiveInteger(policy.archive.afterDays, 'archive.afterDays')!
  if (policy.archive.mode !== 'none' && afterDays === undefined) throw new Error('Storage policy archive.afterDays is required')
  if (policy.archive.mode === 'none' && afterDays !== undefined) throw new Error('Storage policy archive.afterDays is not allowed for none')
  if (policy.archive.mode === 'delete-after-retention' && historyRetentionDays === null) throw new Error('Delete archive requires a finite historyRetentionDays')
  if (['object-storage', 'cold-storage'].includes(policy.archive.mode) && policy.objectStorage === 'forbidden') throw new Error('External archive requires objectStorage')
  return { maxPayloadBytes, objectStorage: policy.objectStorage, historyRetentionDays, archive: { mode: policy.archive.mode, ...(afterDays === undefined ? {} : { afterDays }) } }
}

/**
 * Resolve an optional storage policy through the standard validator.
 * @param policy - Explicit policy; omission uses DEFAULT_PLUGIN_STORAGE_POLICY (4 MiB, optional object storage, indefinite history, no archive).
 * @returns A validated fresh policy object.
 * @throws Error when the supplied policy is invalid.
 * @example
 * ```typescript
 * import { resolvePluginStoragePolicy } from "@alneas/eaos-core/plugin-sdk/storage-policy";
 * console.log(resolvePluginStoragePolicy().maxPayloadBytes); // 4194304
 * ```
 */
export function resolvePluginStoragePolicy(policy?: PluginStoragePolicy): PluginStoragePolicy {
  return assertPluginStoragePolicy(policy ?? DEFAULT_PLUGIN_STORAGE_POLICY)
}

/**
 * Serialize a payload and enforce its UTF-8 storage size limit.
 * @param policy - Storage constraints validated before serialization.
 * @param value - Value passed to JSON.stringify; top-level undefined is rejected.
 * @returns Serialized JSON when it fits the byte limit.
 * @throws Error for invalid policy, missing JSON output or oversized output; JSON.stringify errors, including cycles and bigint, propagate.
 * @remarks Uses TextEncoder; native JSON serialization semantics, including toJSON, apply.
 * @example
 * ```typescript
 * import { assertPayloadWithinPolicy } from "@alneas/eaos-core/plugin-sdk/storage-policy";
 * const policy = { maxPayloadBytes: 1024, objectStorage: "optional", historyRetentionDays: null, archive: { mode: "none" } } as const;
 * console.log(assertPayloadWithinPolicy(policy, { message: "hello" }));
 * ```
 */
export function assertPayloadWithinPolicy(policy: PluginStoragePolicy, value: unknown): string {
  const resolved = assertPluginStoragePolicy(policy)
  const payload = JSON.stringify(value)
  if (payload === undefined || new TextEncoder().encode(payload).byteLength > resolved.maxPayloadBytes) throw new Error('Storage policy payload limit exceeded')
  return payload
}
