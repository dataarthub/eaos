import { expect, test } from 'bun:test'
import { selectImage, selectServiceNetwork } from './lookups'

const image = (id: string, timeCreated: string, displayName = 'Ubuntu') => ({ id, timeCreated, displayName })
test('latest is deterministic even when provider results are unordered or dates tie', () => {
  const candidates = [image('z', '2026-09-17T00:00:00Z'), image('old', '2026-01-01T00:00:00Z'), image('a', '2026-09-17T00:00:00Z')]
  expect(selectImage(candidates, 'latest')).toBe('a')
  expect(candidates.map(candidate => candidate.id)).toEqual(['z', 'old', 'a'])
})
test('exact selection requires one matching name, rather than taking the first result', () => {
  expect(selectImage([image('old', 'unused', 'old'), image('match', 'unused', 'pinned')], 'exact', 'pinned')).toBe('match')
  expect(() => selectImage([image('a', 'unused'), image('b', 'unused')], 'exact', 'Ubuntu')).toThrow('one image')
  expect(() => selectImage([], 'latest')).toThrow('no compatible')
  expect(() => selectImage([image('a', 'bad-date')], 'latest')).toThrow('creation time')
  expect(() => selectImage([image('', '2026-09-17T00:00:00Z')], 'latest')).toThrow('missing image ID')
})
test('service lookup excludes Object Storage and returns the ID and regional CIDR together', () => {
  expect(selectServiceNetwork([
    { id: 'object-storage', name: 'OCI KIX Object Storage', cidrBlock: 'oci-kix-objectstorage' },
    { id: 'all-services', name: 'All KIX Services In Oracle Services Network', cidrBlock: 'all-kix-services-in-oracle-services-network' },
  ])).toEqual({ id: 'all-services', cidrBlock: 'all-kix-services-in-oracle-services-network' })
  expect(() => selectServiceNetwork([])).toThrow('exactly one')
  expect(() => selectServiceNetwork(['KIX', 'NRT'].map(region => ({ id: region, name: `All ${region} Services In Oracle Services Network`, cidrBlock: region })))).toThrow('exactly one')
})
