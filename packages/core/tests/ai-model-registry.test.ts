import { expect, test } from 'bun:test'
import { createAIModelRegistry } from '../src/ai/model-registry'

const route = {
  modelId: 'strict-local',
  adapterId: 'host-chat',
  capabilities: ['chat', 'tools'] as const,
  allowedSensitivity: ['level2_internal', 'level3_strict'] as const,
  requiresNoTraining: true,
  maxInputChars: 10_000,
  maxOutputChars: 20_000,
}
const context = { tenantId: 'tenant-a', userId: 'user-a', operation: 'model:chat' }

test('AI model registry exposes immutable approved routes and fails closed', () => {
  const registry = createAIModelRegistry({ routes: [route], defaultModelId: route.modelId })
  const listed = registry.list()
  expect(listed[0]).toEqual(route)
  ;(listed[0]!.capabilities as string[]).push('embedding')
  expect(registry.list()[0]?.capabilities).toEqual(['chat', 'tools'])
  expect(registry.resolve({ context, capability: 'chat', sensitivityLevel: 'level3_strict' })).toEqual(route)
  expect(() => registry.resolve({ context, capability: 'embedding' })).toThrow('capability')
  expect(() => registry.resolve({ context, capability: 'chat', sensitivityLevel: 'level1_public' })).toThrow('sensitivity')
  expect(() => registry.resolve({ context: { ...context, tenantId: '' }, capability: 'chat' })).toThrow('context')
})

test('unknown explicit model ids cannot bypass the host-selected default', () => {
  const registry = createAIModelRegistry({ routes: [route], defaultModelId: route.modelId })
  expect(() => registry.resolve({ context, capability: 'chat', modelId: 'unapproved' })).toThrow('not registered')
})
