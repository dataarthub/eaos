import { describe, expect, test } from 'bun:test'
import { GraphProjectionCoordinator, type ProjectionCursorStore } from './graph-projection'
import type { GraphProjectionAdapter, GraphProjectionCursor, WorkflowEventEnvelope } from '@alneas/eaos-core'

function event(revision: number, id = `event-${revision}`): WorkflowEventEnvelope {
  return { eventId: id, tenantId: 'tenant-a', aggregateType: 'task-graph', aggregateId: 'graph', aggregateRevision: revision, type: 'task_graph.revision_committed', producer: 'test', correlationId: 'corr', idempotencyKey: id, occurredAt: new Date().toISOString(), payload: {} }
}

describe('GraphProjectionCoordinator', () => {
  test('applies events idempotently and records lag/failure state', async () => {
    const cursors = new Map<string, GraphProjectionCursor>()
    const applied: string[] = []
    const store: ProjectionCursorStore = { get: async (id, tenant) => cursors.get(`${id}:${tenant}`) ?? null, put: async cursor => { cursors.set(`${cursor.projectionId}:${cursor.tenantId}`, cursor) } }
    const adapter: GraphProjectionAdapter = { apply: async current => { applied.push(current.eventId) }, rebuild: async () => undefined }
    const coordinator = new GraphProjectionCoordinator({ projectionId: 'adb-graph', cursorStore: store, adapter })
    await coordinator.apply(event(1))
    await coordinator.apply(event(1))
    await coordinator.apply(event(3))
    expect(applied).toEqual(['event-1', 'event-3'])
    expect((await store.get('adb-graph', 'tenant-a'))?.status).toBe('lagging')
  })

  test('marks a projection failure and permits a later rebuild', async () => {
    const cursors = new Map<string, GraphProjectionCursor>()
    const store: ProjectionCursorStore = { get: async (id, tenant) => cursors.get(`${id}:${tenant}`) ?? null, put: async cursor => { cursors.set(`${cursor.projectionId}:${cursor.tenantId}`, cursor) } }
    let fail = true
    const adapter: GraphProjectionAdapter = { apply: async () => { if (fail) throw new Error('graph down') }, rebuild: async () => { fail = false } }
    const coordinator = new GraphProjectionCoordinator({ projectionId: 'adb-graph', cursorStore: store, adapter })
    await expect(coordinator.apply(event(1))).rejects.toThrow('graph down')
    expect((await store.get('adb-graph', 'tenant-a'))?.status).toBe('failed')
    await coordinator.rebuild('tenant-a', 1, { tasks: [] })
    expect((await store.get('adb-graph', 'tenant-a'))?.status).toBe('healthy')
  })
})
