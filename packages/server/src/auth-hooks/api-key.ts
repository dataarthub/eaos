import { verifyApiKey, type ApiKeyRecord, type PlatformPrincipal } from '@alneas/eaos-core'

/**
 * Host persistence lookup for {@link resolveApiKey}; records must retain hashed credentials and lifecycle state.
 */
export interface ApiKeyLookup {
  /**
   * Reads a key record by its 12-character public prefix.
   * @param prefix - Prefix extracted from an eaos_ credential; never the full secret.
   * @returns The stored record, or null if absent.
   * @throws Persistence errors propagate to resolveApiKey callers.
   
   * @example
   * ```typescript
   * import type { ApiKeyLookup } from "@alneas/eaos-server/auth-hooks";
   * export async function findStoredApiKey(lookup: ApiKeyLookup, parsedPrefix: string) {
   *   const record = await lookup.findByPrefix(parsedPrefix);
   *   return record; // A record match still requires secret, scope and lifecycle verification.
   * }
   * ```
   */
  findByPrefix(prefix: string): Promise<ApiKeyRecord | null>
}

function credentialFromHeaders(headers: { authorization?: string | null; apiKey?: string | null }): string | null {
  const bearer = headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  const value = bearer ?? headers.apiKey?.trim()
  return value?.startsWith('eaos_') ? value : null
}

function prefixFromCredential(secret: string): string | null {
  // The random token uses base64url, whose alphabet includes `_`. Splitting on
  // `_` therefore truncates valid prefixes and made resolution intermittently
  // fail depending on the random token generated at issuance time.
  const prefixStart = 'eaos_'.length
  const prefixEnd = prefixStart + 12
  if (secret.length <= prefixEnd || secret[prefixEnd] !== '_') return null
  const prefix = secret.slice(prefixStart, prefixEnd)
  return prefix.length === 12 ? prefix : null
}

/**
 * Verifies a stored API key and resolves its trusted user, tenant, and copied scopes.
 * @param headers - Raw authorization and apiKey header values; a Bearer credential takes precedence, and credentials must begin with eaos_.
 * @param lookup - Host record lookup by public prefix; see {@link ApiKeyLookup}.
 * @param options - requiredScope is checked by core verification; now overrides the verification clock; authorize runs only after cryptographic and scope checks and must return exactly true.
 * @returns A principal with apiKeyId and empty roles, or null for malformed, missing, invalid, expired, insufficiently scoped, or host-denied credentials.
 * @throws Rejects on lookup or authorize failure; these are not converted to null.
 * @remarks Membership and tenant lifecycle checks belong in authorize. No key usage or persistence update occurs here.
 * @example
 * ```typescript
 * import { resolveApiKey, type ApiKeyLookup } from "@alneas/eaos-server/auth-hooks/api-key";
 * import type { ApiKeyRecord } from "@alneas/eaos-core";
 * export async function authenticate(
 *   authorization: string | null,
 *   lookup: ApiKeyLookup,
 *   authorize: (record: ApiKeyRecord) => Promise<boolean>,
 * ) {
 *   return resolveApiKey({ authorization }, lookup, { requiredScope: "records:read", authorize });
 * }
 * ```
 */
export async function resolveApiKey(headers: {
  /**
 * Optional raw Authorization header; a parsed Bearer credential takes precedence over the dedicated apiKey value.
 */
authorization?: string | null;
  /**
 * Optional dedicated API-key header used only when no Bearer credential is parsed; surrounding whitespace is trimmed.
 */
apiKey?: string | null }, lookup: ApiKeyLookup, options: {
  /**
 * Optional exact key scope checked by core cryptographic/lifecycle verification.
 */
requiredScope?: string;
  /**
 * Optional verification clock override; omission uses the core verifier clock.
 */
now?: Date;
  /**
 * Optional live membership/lifecycle callback after key verification; receives the stored record and must return exactly true to allow, while errors reject resolution.
 */
authorize?: (record: ApiKeyRecord) => Promise<boolean> | boolean } = {}): Promise<(PlatformPrincipal & {
  /**
 * Stored key record ID attached to the resolved principal for audit/correlation, never the credential secret.
 */
apiKeyId: string }) | null> {
  const secret = credentialFromHeaders(headers)
  if (!secret) return null
  const prefix = prefixFromCredential(secret)
  if (!prefix) return null
  const record = await lookup.findByPrefix(prefix)
  if (!record || !verifyApiKey(secret, record, options.requiredScope, options.now) || (options.authorize && await options.authorize(record) !== true)) return null
  return { userId: record.userId, tenantId: record.tenantId, roles: [], scopes: [...record.scopes], apiKeyId: record.id }
}
