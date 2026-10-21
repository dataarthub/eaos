import { describe, expect, test } from 'bun:test'
import { createWorkflowEvent, hashAgentJobRequest } from '../src/workflow-runtime'

describe('workflow runtime contracts', () => {
  test('creates a deterministic idempotent event envelope', () => {
    const input = {
      tenantId: 'tenant-a',
      workflowInstanceId: 'wf-1',
      aggregateType: 'task-graph',
      aggregateId: 'graph',
      aggregateRevision: 3,
      type: 'task.status_changed',
      producer: 'task-graph',
      correlationId: 'corr-1',
      payload: { taskId: 'task-1', status: 'completed' },
    }
    const first = createWorkflowEvent(input)
    const second = createWorkflowEvent(input)
    expect(first.eventId).toBe(second.eventId)
    expect(first.idempotencyKey).toBe(second.idempotencyKey)
    expect(first.payload).toEqual(input.payload)
  })

  test('hashes job requests without mutating them', () => {
    const request = { kind: 'document-analysis', input: { sourceId: 'doc-1' } }
    const hash = hashAgentJobRequest(request)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(request).toEqual({ kind: 'document-analysis', input: { sourceId: 'doc-1' } })
  })
})
