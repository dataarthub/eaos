import { describe, expect, test } from 'bun:test'
import { AgentGraphEngine, type AgentGraphState } from './graph'
import { DurableWorkflowCoordinator, type WorkflowInstanceStore, type StoredWorkflowInstance } from './workflow-coordinator'
import type { WorkflowInstanceRecord } from '@alneas/eaos-core'

function store(): WorkflowInstanceStore & { value: StoredWorkflowInstance | null } {
  const result = { value: null as StoredWorkflowInstance | null }
  return {
    get value() { return result.value },
    set value(next) { result.value = next },
    async read() { return result.value ? structuredClone(result.value) : null },
    async create(_tenant, record) { if (result.value) throw new Error('duplicate'); result.value = structuredClone(record) },
    async replace(_tenant, record, expected) { if (!result.value || result.value.revision !== expected) return false; result.value = structuredClone(record); return true },
  }
}

const record: WorkflowInstanceRecord = { instanceId: 'wf-1', workflowId: 'review', workflowVersion: '1.0.0', workflowHash: 'a'.repeat(64), tenantId: 'tenant-a', userId: 'user-a', threadId: 'wf-1', status: 'queued', updatedAt: '2026-09-21T00:00:00.000Z' }
const initial: AgentGraphState = { sessionId: 'wf-1', tenantId: 'tenant-a', userId: 'user-a', currentStep: 'start', history: [], isComplete: false }

describe('DurableWorkflowCoordinator', () => {
  test('keeps the workflow instance status aligned with the LangGraph checkpoint', async () => {
    const instances = store()
    const graph = new AgentGraphEngine()
    graph.addNode('start', async () => ({ currentStep: 'done', isComplete: true }))
    const coordinator = new DurableWorkflowCoordinator({ store: instances })
    const state = await coordinator.start(graph, record, initial)
    expect(state.isComplete).toBe(true)
    expect(instances.value?.value.status).toBe('completed')
    expect(instances.value?.revision).toBe(2)
  })
})
