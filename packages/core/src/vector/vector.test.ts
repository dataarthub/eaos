import { describe, expect, test } from 'bun:test'
import { assertVectorSearchHits, assertVectorSearchRequest, type VectorSearchAdapter } from './index'

describe('provider-neutral vector search', () => {
  test('uses an index catalog key and requires tenant scope', async () => {
    const adapter: VectorSearchAdapter = { search: async input => [{ tenantId: input.tenantId, id: 'doc-1', score: 0.9 }] }
    await expect(adapter.search(assertVectorSearchRequest({ tenantId: 'tenant-a', indexId: 'documents', queryVector: [0.1, 0.2], topK: 5 }))).resolves.toEqual([{ tenantId: 'tenant-a', id: 'doc-1', score: 0.9 }])
    expect(() => assertVectorSearchRequest({ tenantId: '', indexId: 'documents', queryVector: [0.1], topK: 1 })).toThrow('tenantId')
  })

  test('rejects foreign or duplicate provider hits', () => {
    expect(() => assertVectorSearchHits([{ tenantId: 'tenant-b', id: 'doc-1', score: 0.9 }], 'tenant-a')).toThrow('result')
    expect(() => assertVectorSearchHits([{ tenantId: 'tenant-a', id: 'doc-1', score: 0.9 }, { tenantId: 'tenant-a', id: 'doc-1', score: 0.8 }], 'tenant-a')).toThrow('result')
  })
})
