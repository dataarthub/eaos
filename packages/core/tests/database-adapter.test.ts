import { describe, it, expect } from 'bun:test'
import type { DatabaseAdapter } from '../src/db/adapter'

describe('DatabaseAdapter (Oracle & Supabase Multi-Cloud Interface)', () => {
  it('defines the core DatabaseAdapter interface contract', () => {
    const mockAdapter: DatabaseAdapter = {
      type: 'oracle',
      withConnection: async (domain, cb) => cb({}),
      withTenantConnection: async (domain, cb, ctx) => cb({ tenantId: ctx.tenantId }),
      ping: async () => true,
      getStats: () => ({ activeConnections: 0, poolSize: 5, driver: 'oracle' }),
      close: async () => {},
    }

    expect(mockAdapter.type).toBe('oracle')
  })
})
