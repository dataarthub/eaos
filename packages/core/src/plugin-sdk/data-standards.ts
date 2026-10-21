import { canonicalJsonHash } from '../serialization/index'

/**
 * Shared value semantics. A business ID is opaque; an external key is never an authority.
 * @see {@link externalEntityId}
 */
export const DATA_STANDARDS_VERSION = '1.0.0'
/**
 * Frozen scalar JSON Schemas for identities, revisions, money, quantities, ratios, dates and instants.
 * @see {@link externalEntityId}
 */
export const dataStandardSchemas = {
 /** Opaque nonempty identity, at most 256 characters, without surrounding whitespace or ASCII control characters. */
 id: { type: 'string', minLength: 1, maxLength: 256, pattern: '^(?!.*[\\u0000-\\u001f\\u007f])\\S(?:.*\\S)?$' },
 /** Positive safe-integer revision used for optimistic domain state. */
 revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
 /** Signed safe-integer monetary amount already expressed in currency minor units. */
 moneyMinor: { type: 'integer', minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
 /** Safe-integer minor-unit amount that may be zero but not negative. */
 nonnegativeMoneyMinor: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
 /** Three uppercase ASCII currency letters; this pattern does not verify membership in a currency registry. */
 currency: { type: 'string', pattern: '^[A-Z]{3}$' },
 /** Nonnegative numeric quantity; interpret together with an explicit quantityUnit. */
 quantity: { type: 'number', minimum: 0 },
 /** Recognized quantity units: m, m2, m3, kg, each, lot, hour and day. */
 quantityUnit: { type: 'string', enum: ['m','m2','m3','kg','each','lot','hour','day'] },
 /** Inclusive fractional ratio from zero to one. */
 ratio: { type: 'number', minimum: 0, maximum: 1 },
 /** Date-only YYYY-MM-DD schema; assertBusinessDate additionally verifies a real calendar date. */
 businessDate: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
 /** Timestamp with seconds, optional 1–9 fractional digits and explicit Z/numeric timezone. */
 instant: { type: 'string', format: 'date-time', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$' },
} as const
Object.freeze(dataStandardSchemas.quantityUnit.enum)
for (const schema of Object.values(dataStandardSchemas)) Object.freeze(schema)
Object.freeze(dataStandardSchemas)

/**
 * Provider system, account/facility scope, entity kind and opaque external ID.
 * @see {@link externalEntityId}
 */
export interface ExternalEntityIdentity { 
  /** External provider/system identity used in deterministic entity identity hashing. */
  system: string; 
  
  /** Provider account/facility boundary included in deterministic external-entity identity; must be a valid business ID. */
  scope: string; 
  /** External provider entity category used with system/scope/ID to derive a collision-resistant identity. */
  entityType: string; 
/** Optional external resource identity reported by the provider. */
  externalId: string }
/**
 * Validate an opaque business identifier.
 * @param value - Nonempty text up to 256 UTF-16 code units, without surrounding whitespace or ASCII control characters.
 * @returns No value; successful completion narrows value to string.
 * @throws Error when the business identity is invalid.
 * @example
 * ```typescript
 * import { assertBusinessId } from "@alneas/eaos-core/plugin-sdk/data-standards";
 * assertBusinessId("order-001");
 * ```
 */
export function assertBusinessId(value: unknown): asserts value is string {
 if (typeof value !== 'string' || !value || value.length > 256 || value.trim() !== value || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw Error('Invalid business identity')
}
/**
 * Deliberately includes tenant, provider account/facility scope and entity kind.
 * @param tenantId - Tenant business identifier accepted by assertBusinessId.
 * @param identity - Provider system, account/facility scope, entity kind and external identifier; each must be a valid business ID.
 * @returns An ext- prefixed SHA-256 identity incorporating DATA_STANDARDS_VERSION.
 * @throws Error when a scope component is not a business ID.
 * @remarks External identifiers confer no authorization; hashing requires node:crypto.
 * @example
 * ```typescript
 * import { externalEntityId } from "@alneas/eaos-core/plugin-sdk/data-standards";
 * const id = externalEntityId("tenant-demo", { system: "erp", scope: "warehouse-a", entityType: "order", externalId: "123" });
 * console.log(id);
 * ```
 */
export function externalEntityId(tenantId: string, identity: ExternalEntityIdentity): string {
 assertBusinessId(tenantId)
 for (const key of ['system', 'scope', 'entityType', 'externalId'] as const) assertBusinessId(identity[key])
 return `ext-${canonicalJsonHash([DATA_STANDARDS_VERSION, tenantId, identity.system, identity.scope, identity.entityType, identity.externalId])}`
}
/**
 * Validate a monetary amount already expressed in minor units.
 * @param value - Safe integer amount; no currency conversion is performed.
 * @param nonnegative - Reject negative amounts when true; defaults to false.
 * @returns No value; successful completion narrows value to number.
 * @throws Error for a nonsafe integer or a prohibited negative amount.
 * @example
 * ```typescript
 * import { assertMoneyMinor } from "@alneas/eaos-core/plugin-sdk/data-standards";
 * assertMoneyMinor(1250, true);
 * ```
 */
export function assertMoneyMinor(value: unknown, nonnegative = false): asserts value is number {
 if (!Number.isSafeInteger(value) || nonnegative && Number(value) < 0) throw Error('Amount must be a safe integer in currency minor units')
}
/**
 * Validate a real Gregorian calendar date in YYYY-MM-DD form.
 * @param value - Date-only text, without time or timezone.
 * @returns No value; successful completion narrows value to string.
 * @throws Error for invalid syntax or a date that does not round-trip through UTC.
 * @example
 * ```typescript
 * import { assertBusinessDate } from "@alneas/eaos-core/plugin-sdk/data-standards";
 * assertBusinessDate("2026-10-19");
 * ```
 */
export function assertBusinessDate(value: unknown): asserts value is string {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Invalid business date')
 const date = new Date(`${value}T00:00:00.000Z`)
 if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw Error('Invalid business date')
}
/**
 * Validate an ISO-style timestamp with an explicit timezone.
 * @param value - Timestamp with seconds and Z or numeric timezone offset; optional 1–9 fractional digits.
 * @returns No value; successful completion narrows value to string.
 * @throws Error for invalid timestamp syntax, date, hour/minute/second or an unparseable instant.
 * @example
 * ```typescript
 * import { assertInstant } from "@alneas/eaos-core/plugin-sdk/data-standards";
 * assertInstant("2026-10-19T10:00:00+09:00");
 * ```
 */
export function assertInstant(value: unknown): asserts value is string {
 if (typeof value !== 'string' || !new RegExp(dataStandardSchemas.instant.pattern).test(value) || !Number.isFinite(Date.parse(value))) throw Error('Invalid instant with explicit timezone')
 assertBusinessDate(value.slice(0, 10))
 const hour = Number(value.slice(11, 13)), minute = Number(value.slice(14, 16)), second = Number(value.slice(17, 19))
 if (hour > 23 || minute > 59 || second > 59) throw Error('Invalid instant with explicit timezone')
}

/**
 * Exact decimal conversion; requires an explicit power-of-ten currency scale.
 * @param value - Finite major-unit amount; calculation uses its String representation.
 * @param minorUnitsPerMajorUnit - Explicit scale: 1, 10, 100, 1000, 10000, 100000 or 1000000.
 * @returns The safe integer minor-unit amount.
 * @throws Error for an unsupported scale, nonfinite amount, required rounding or unsafe result.
 * @example
 * ```typescript
 * import { majorAmountToMinor } from "@alneas/eaos-core/plugin-sdk/data-standards";
 * console.log(majorAmountToMinor(12.5, 100)); // 1250
 * ```
 */
export function majorAmountToMinor(value: number, minorUnitsPerMajorUnit: number): number {
 if (!Number.isFinite(value) || ![1,10,100,1000,10000,100000,1000000].includes(minorUnitsPerMajorUnit)) throw Error('Explicit currency minor-unit scale required')
 const [decimal, exponentText] = String(value).toLowerCase().split('e')
 const [whole, fraction = ''] = decimal!.split('.')
 const digits = BigInt(whole! + fraction)
 const shift = Number(exponentText ?? 0) - fraction.length + Math.log10(minorUnitsPerMajorUnit)
 const divisor = shift < 0 ? 10n ** BigInt(-shift) : 1n
 if (digits % divisor !== 0n) throw Error('Amount cannot be represented in currency minor units')
 const result = Number(shift < 0 ? digits / divisor : digits * 10n ** BigInt(shift))
 assertMoneyMinor(result)
 return result
}
