import { expect, test } from 'bun:test'
import { createCompositePluginService, PluginError, type PluginPrincipal } from '../src/plugin-data/index'

const principal: PluginPrincipal = { tenantId: 'tenant-a', userId: 'user-a', roles: ['USER'] }

test('dispatches bundled operations without changing child service context', async () => {
  const calls: string[] = []
  const service = createCompositePluginService({ portfolio: { execute: async (p, op, input) => { calls.push(`${p.tenantId}:${op}`); return input } }, leasing: { execute: async (_p, op) => op } }, { estate_properties_list: 'portfolio', estate_applications_create: 'leasing' })
  expect(await service.execute(principal, 'estate_properties_list', { limit: 10 })).toEqual({ limit: 10 })
  expect(await service.execute(principal, 'estate_applications_create', {})).toBe('estate_applications_create')
  expect(calls).toEqual(['tenant-a:estate_properties_list'])
})

test('fails closed for undeclared operations and bad owners', async () => {
  expect(() => createCompositePluginService({}, { operation: 'missing' })).toThrow('Unknown composite service')
  const service = createCompositePluginService({ portfolio: { execute: async () => null } }, { known: 'portfolio' })
  await expect(service.execute(principal, 'unknown', {})).rejects.toBeInstanceOf(PluginError)
})
