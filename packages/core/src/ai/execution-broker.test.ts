import { describe, expect, it } from 'bun:test'
import { AIExecutionRouteUnavailableError, createAIExecutionBroker, type AIExecutionCandidate } from './execution-broker'

const base = {
  adapterId: 'fixture',
  capabilities: ['chat', 'structured-output'] as const,
  allowedSensitivity: ['level1_public', 'level2_internal', 'level3_strict'] as const,
  requiresNoTraining: true,
  quality: 'standard' as const,
  supportedModes: ['durable-workflow', 'interactive'] as const,
}

const routes: AIExecutionCandidate[] = [
  { ...base, routeId: 'local-subscription', target: 'local-subscription-cli', requiresNoTraining: false, quality: 'premium', userBound: true },
  { ...base, routeId: 'local-mlx', target: 'local-mlx', quality: 'standard' },
  { ...base, routeId: 'arm', target: 'arm-agent', quality: 'standard', priority: 2 },
  { ...base, routeId: 'free-cloud', target: 'external-no-training', quality: 'standard' },
]

const context = { tenantId: 'tenant-a', userId: 'user-a', operation: 'workflow.proposal' }

describe('AI execution broker', () => {
  it('does not select a user-bound subscription runner unless explicitly allowed', () => {
    const broker = createAIExecutionBroker({ routes })
    const decision = broker.decide({ context, capability: 'chat', sensitivityLevel: 'level1_public', mode: 'interactive', quality: 'premium', latency: 'interactive', requiresNoTraining: false })
    expect(decision.route.routeId).toBe('local-mlx')

    const allowed = broker.decide({ context, capability: 'chat', sensitivityLevel: 'level1_public', mode: 'interactive', quality: 'premium', latency: 'interactive', requiresNoTraining: false, allowUserBoundRunner: true })
    expect(allowed.route.routeId).toBe('local-subscription')
  })

  it('keeps strict data on no-training local routes', () => {
    const broker = createAIExecutionBroker({ routes })
    const decision = broker.decide({ context, capability: 'chat', sensitivityLevel: 'level3_strict', mode: 'durable-workflow', quality: 'standard', latency: 'normal', requiresNoTraining: true })
    expect(decision.route.routeId).toBe('local-mlx')
    expect(decision.fallbacks.map(route => route.routeId)).toContain('arm')
    expect(decision.fallbacks.map(route => route.routeId)).not.toContain('local-subscription')
  })

  it('fails closed when all eligible routes are offline', () => {
    const broker = createAIExecutionBroker({ routes: routes.map(route => ({ ...route, capacity: { state: 'offline' as const } })) })
    expect(() => broker.decide({ context, capability: 'chat', sensitivityLevel: 'level1_public', mode: 'durable-workflow', quality: 'standard', latency: 'batch', requiresNoTraining: true })).toThrow(AIExecutionRouteUnavailableError)
  })
})
