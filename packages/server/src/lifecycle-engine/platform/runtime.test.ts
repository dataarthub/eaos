import { expect, test } from 'bun:test'
import { validatePlatformPackages, type PlatformPackage } from './artifacts'
import { validatePlatformRuntime, resolvePlatformDatabaseTarget } from './runtime'
const entry: PlatformPackage = { id: 'private', inventory: '.eaos/packages/x/deployment.json', module: '.eaos/packages/x/index.js', tenantIds: ['a'], pluginIds: ['private'] }
const shared = { id: 'shared', databaseId: 'adb-1', dialect: 'oracle' as const, mode: 'shared' as const }
const dedicated = { id: 'tenant-a-db', databaseId: 'adb-2', dialect: 'oracle' as const, mode: 'dedicated' as const, tenantId: 'a' }
test('one host routes a dedicated tenant to second DB and others to shared DB', () => {
  const runtime = { backend: shared, databaseTargets: [dedicated], tenantPlacements: { a: dedicated.id } }
  expect(validatePlatformRuntime(runtime, [entry, { ...entry, id: 'other', tenantIds: ['b'] }])).toEqual(runtime)
  expect(resolvePlatformDatabaseTarget(runtime, 'a').databaseId).toBe('adb-2')
  expect(resolvePlatformDatabaseTarget(runtime, 'b').databaseId).toBe('adb-1')
  expect(() => validatePlatformRuntime({ ...runtime, tenantPlacements: { b: dedicated.id } })).toThrow()
  expect(() => validatePlatformRuntime({ ...runtime, tenantPlacements: {} })).toThrow('explicit')
  expect(() => validatePlatformRuntime({ ...runtime, databaseTargets: [{ ...dedicated, databaseId: 'adb-1' }] })).toThrow('own databaseId')
  expect(() => resolvePlatformDatabaseTarget({ backend: dedicated }, 'b')).toThrow('unavailable')
})
test('registrations reject traversal, duplicate/wildcard tenant scopes and missing bundle', () => {
  for (const patch of [{ module: '../bad.js' }, { inventory: '/outside.json' }, { tenantIds: ['*'] }, { tenantIds: [' a'] }, { pluginIds: [] }]) expect(() => validatePlatformPackages([{ ...entry, ...patch }])).toThrow()
  expect(validatePlatformPackages([entry, { ...entry, id: 'other' }])).toHaveLength(2)
})
