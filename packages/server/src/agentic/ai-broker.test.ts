import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createAtomicRepository, createSqliteAtomicDriver } from '../plugin-data/atomic'
import { createAtomicAgentJobStore } from './agent-jobs'
import { DurableAIExecutionBroker } from './ai-broker'
import { LocalRunnerPullCoordinator } from './local-runner'

const principal = { tenantId: 'tenant-a', userId: 'user-a', roles: ['worker'] }
const routes = [
  { routeId: 'local-cli', target: 'local-subscription-cli' as const, adapterId: 'local-cli', capabilities: ['chat'] as const, allowedSensitivity: ['level1_public', 'level2_internal'] as const, requiresNoTraining: false, quality: 'premium' as const, supportedModes: ['durable-workflow', 'interactive'] as const, userBound: true, workerType: 'local_cli' as const, dispatchMode: 'local-pull' as const, runnerId: 'runner-a' },
  { routeId: 'arm', target: 'arm-agent' as const, adapterId: 'arm', capabilities: ['chat'] as const, allowedSensitivity: ['level1_public', 'level2_internal', 'level3_strict'] as const, requiresNoTraining: true, quality: 'standard' as const, supportedModes: ['durable-workflow'] as const, workerType: 'hermes_agent' as const, dispatchMode: 'server-queue' as const },
]

function setup() {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE jobs(tenant_id TEXT, id TEXT, revision INTEGER, payload TEXT, PRIMARY KEY(tenant_id,id))')
  const repository = createAtomicRepository('jobs', createSqliteAtomicDriver(db))
  const store = createAtomicAgentJobStore({ repository, principal, now: () => new Date('2026-09-21T00:00:00Z') })
  return { db, repository, store }
}

describe('DurableAIExecutionBroker and local runner pull', () => {
  it('persists the controller-selected local route and lets only the bound runner claim it', async () => {
    const { db, repository, store } = setup()
    const broker = new DurableAIExecutionBroker({ routes, now: () => new Date('2026-09-21T00:00:00Z') })
    const plan = broker.plan({
      routing: { context: { tenantId: 'tenant-a', userId: 'user-a', operation: 'workflow.proposal' }, capability: 'chat', sensitivityLevel: 'level1_public', mode: 'durable-workflow', quality: 'premium', latency: 'normal', requiresNoTraining: false, allowUserBoundRunner: true },
      task: { id: 'task-1', tenantId: 'tenant-a', userId: 'user-a', title: 'Draft proposal', instructions: 'Return a proposal.' },
      kind: 'workflow-proposal',
      idempotencyKey: 'task-1',
    })
    expect(plan.decision.route.routeId).toBe('local-cli')
    expect(plan.job.request.executionContext).toMatchObject({ routeId: 'local-cli', dispatchMode: 'local-pull', runnerId: 'runner-a' })

    await repository.run(principal, tx => broker.enqueue(tx, {
      routing: { context: { tenantId: 'tenant-a', userId: 'user-a', operation: 'workflow.proposal' }, capability: 'chat', sensitivityLevel: 'level1_public', mode: 'durable-workflow', quality: 'premium', latency: 'normal', requiresNoTraining: false, allowUserBoundRunner: true },
      task: { id: 'task-1', tenantId: 'tenant-a', userId: 'user-a', title: 'Draft proposal', instructions: 'Return a proposal.' },
      kind: 'workflow-proposal',
      idempotencyKey: 'task-1',
    }))

    const coordinator = new LocalRunnerPullCoordinator({ store, now: () => new Date('2026-09-21T00:00:00Z') })
    expect(await coordinator.claim({ runnerId: 'other-runner', userId: 'user-a', supportedRouteIds: ['local-cli'] })).toHaveLength(0)
    const claimed = await coordinator.claim({ runnerId: 'runner-a', userId: 'user-a', supportedRouteIds: ['local-cli'] })
    expect(claimed).toHaveLength(1)
    await coordinator.submit({ runnerId: 'runner-a', userId: 'user-a', supportedRouteIds: ['local-cli'] }, claimed[0], { taskId: 'task-1', status: 'COMPLETED', output: '{"ok":true}', durationMs: 1 })
    expect((await store.claim(new Date('2026-09-21T00:00:00Z'), 1))).toHaveLength(0)
    db.close()
  })

  it('keeps a disconnected local runner retryable instead of falling through silently', async () => {
    const { db, repository, store } = setup()
    const broker = new DurableAIExecutionBroker({ routes, now: () => new Date('2026-09-21T00:00:00Z') })
    await repository.run(principal, tx => broker.enqueue(tx, {
      routing: { context: { tenantId: 'tenant-a', userId: 'user-a', operation: 'workflow.proposal' }, capability: 'chat', sensitivityLevel: 'level1_public', mode: 'durable-workflow', quality: 'premium', latency: 'normal', requiresNoTraining: false, allowUserBoundRunner: true },
      task: { id: 'task-2', tenantId: 'tenant-a', userId: 'user-a', title: 'Draft proposal', instructions: 'Return a proposal.' },
      kind: 'workflow-proposal',
      idempotencyKey: 'task-2',
    }))
    const coordinator = new LocalRunnerPullCoordinator({ store, now: () => new Date('2026-09-21T00:00:00Z'), retryDelayMs: 1 })
    const claimed = await coordinator.claim({ runnerId: 'runner-a', userId: 'user-a', supportedRouteIds: ['local-cli'] })
    await coordinator.submit({ runnerId: 'runner-a', userId: 'user-a', supportedRouteIds: ['local-cli'] }, claimed[0], { taskId: 'task-2', status: 'FAILED', error: 'CLI unavailable', failureCode: 'AGENT_UNAVAILABLE', retryable: true, durationMs: 1 })
    expect((await store.claim(new Date('2026-09-21T00:00:00Z'), 1))).toHaveLength(0)
    db.close()
  })
})
