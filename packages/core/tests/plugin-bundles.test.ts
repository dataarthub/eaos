import { describe, expect, test } from 'bun:test'
import { bundlePluginIds, selectPluginBundles } from '../src/plugin-bundles'

const catalog = {
  base: [{ id: 'properties' }, { id: 'units' }],
  operations: [{ id: 'units' }, { id: 'repairs' }],
} as const

describe('plugin bundle helpers', () => {
  test('creates lifecycle IDs and de-duplicates selected manifests', () => {
    expect(bundlePluginIds(catalog)).toEqual({ base: ['properties', 'units'], operations: ['units', 'repairs'] })
    expect(selectPluginBundles(catalog, ['base', 'operations']).map(plugin => plugin.id)).toEqual(['properties', 'units', 'repairs'])
  })

  test('rejects an unknown bundle instead of silently installing an empty profile', () => {
    expect(() => selectPluginBundles(catalog, ['missing'])).toThrow('Unknown plugin bundle')
  })
})
