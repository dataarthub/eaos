/**
 * Control normalization before deterministic serialization.
 * @see {@link canonicalJson}
 */
export interface CanonicalJsonOptions {
 /** Reject non-JSON values instead of normalizing with JSON.stringify/parse. @defaultValue true */
 strict?: boolean
}

/**
 * Deterministic JSON for hashes, cursors and identity keys.
 * @param value - Acyclic JSON data; strict mode permits only plain objects, dense arrays, finite numbers, strings, booleans and null.
 * @param options - Serialization mode; strict defaults to true. With strict false, JSON.stringify/parse normalization runs before sorting.
 * @returns The deterministic JSON text; array order is preserved.
 * @throws Error for unsupported strict values, cycles, sparse or decorated arrays; native JSON serialization errors propagate in non-strict mode.
 * @example
 * ```typescript
 * import { canonicalJson } from "@alneas/eaos-core/serialization/json";
 * console.log(canonicalJson({ b: 2, a: 1 })); // {"a":1,"b":2}
 * ```
 */
export function canonicalJson(value: unknown, options: CanonicalJsonOptions = {}): string {
 if (options.strict === false) {
  const normalize = (input: any): any => Array.isArray(input) ? input.map(normalize) : input && typeof input === 'object' ? Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize(input[key])])) : input
  return JSON.stringify(normalize(JSON.parse(JSON.stringify(value))))
 }
 const active = new Set<object>()
 function encode(input: unknown): string {
  if (input === null || typeof input === 'boolean' || typeof input === 'string') return JSON.stringify(input)
  if (typeof input === 'number' && Number.isFinite(input)) return JSON.stringify(input)
  if (typeof input !== 'object' || active.has(input)) throw new Error('Expected acyclic finite JSON')
  active.add(input)
  let result: string
  if (Array.isArray(input)) {
   if (Object.keys(input).length !== input.length) throw new Error('Sparse or decorated array')
   result = '[' + input.map(encode).join(',') + ']'
  } else {
   if (![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('Expected plain JSON object')
   result = '{' + Object.keys(input).sort().map(key => JSON.stringify(key) + ':' + encode((input as Record<string, unknown>)[key])).join(',') + '}'
  }
  active.delete(input)
  return result
 }
 return encode(value)
}
