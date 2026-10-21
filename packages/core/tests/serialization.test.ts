import { describe, expect, it } from 'bun:test'
import { canonicalJson, canonicalJsonHash, sha256Digest } from '../src/serialization/index'

describe('serialization helpers', () => {
 it('canonicalizes strict JSON once for hashes and cursors', () => {
  expect(canonicalJson({ b: 2, a: [{ z: 1, x: 2 }] })).toBe('{"a":[{"x":2,"z":1}],"b":2}')
  expect(canonicalJsonHash({ a: 1 })).toBe(sha256Digest('{"a":1}'))
  expect(() => canonicalJson(new Date())).toThrow()
 })
})
