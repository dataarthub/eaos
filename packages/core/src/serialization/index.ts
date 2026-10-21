import { createHash } from 'node:crypto'

import { canonicalJson } from './json'
export { canonicalJson, type CanonicalJsonOptions } from './json'

/**
 * Hash text or bytes with SHA-256.
 * @param value - UTF-8 text or bytes to hash.
 * @returns A lowercase hexadecimal digest.
 * @remarks Requires the Node-compatible node:crypto module. Input is not modified.
 * @example
 * ```typescript
 * import { sha256Digest } from "@alneas/eaos-core/serialization";
 * console.log(sha256Digest("hello"));
 * ```
 */
export function sha256Digest(value: string | Uint8Array): string {
 return createHash('sha256').update(value).digest('hex')
}

/**
 * Hash strict canonical JSON with SHA-256.
 * @param value - Data accepted by canonicalJson in strict mode.
 * @returns The lowercase hexadecimal digest of the canonical JSON text.
 * @throws Error when canonicalJson rejects non-JSON data or cycles.
 * @remarks Requires node:crypto; does not persist or sign the data.
 * @example
 * ```typescript
 * import { canonicalJsonHash } from "@alneas/eaos-core/serialization";
 * console.log(canonicalJsonHash({ a: 1 }));
 * ```
 */
export function canonicalJsonHash(value: unknown): string {
 return sha256Digest(canonicalJson(value))
}
