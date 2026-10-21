import { describe, expect, test } from 'bun:test'
import { assertGraphProjectionResult, type GraphProjectionQueryResult } from './workflow-runtime'

const result = (overrides: Partial<GraphProjectionQueryResult> = {}): GraphProjectionQueryResult => ({
  tenantId: 'tenant-a',
  nodes: [
    { tenantId: 'tenant-a', id: 'project-1', type: 'project' },
    { tenantId: 'tenant-a', id: 'task-1', type: 'task' },
  ],
  edges: [{ tenantId: 'tenant-a', sourceId: 'project-1', targetId: 'task-1', type: 'contains' }],
  projectedAt: '2026-09-23T00:00:00.000Z',
  stale: false,
  ...overrides,
})

describe('graph projection contracts', () => {
  test('accepts a tenant-scoped graph result', () => {
    expect(assertGraphProjectionResult(result(), 'tenant-a').nodes).toHaveLength(2)
  })

  test('rejects foreign nodes and dangling edges', () => {
    expect(() => assertGraphProjectionResult(result({ nodes: [{ tenantId: 'tenant-b', id: 'project-1', type: 'project' }] }), 'tenant-a')).toThrow('node')
    expect(() => assertGraphProjectionResult(result({ edges: [{ tenantId: 'tenant-a', sourceId: 'project-1', targetId: 'missing', type: 'contains' }] }), 'tenant-a')).toThrow('edge')
  })
})
