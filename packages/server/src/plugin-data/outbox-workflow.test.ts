import { describe, expect, test } from 'bun:test'
import { createAtomicWorkflowEventSink } from './outbox'
import type { AtomicSession } from './atomic'
import { createWorkflowEvent } from '@alneas/eaos-core'

describe('atomic workflow event sink', () => {
  test('stores workflow events in the caller transaction with stable identity', async () => {
    const values = new Map<string, any>()
    const tx: AtomicSession = {
      async get(id) { const value = values.get(id); return value ? structuredClone(value) : null },
      async list() { return [] },
      async put(id, value, expected) { if (expected !== 0 || values.has(id)) throw new Error('unexpected duplicate'); const row = { id, revision: 1, value: structuredClone(value) }; values.set(id, row); return row },
    }
    const event = createWorkflowEvent({ tenantId: 'tenant-a', aggregateType: 'task', aggregateId: 't1', aggregateRevision: 1, type: 'task.created', producer: 'test', correlationId: 'c1', payload: { title: 'Review' } })
    await createAtomicWorkflowEventSink(tx).append(event)
    const stored = [...values.values()][0].value
    expect(stored.topic).toBe('workflow.task.created')
    expect(stored.idempotencyKey).toBe(event.idempotencyKey)
    expect(stored.payload.eventId).toBe(event.eventId)
  })
})
