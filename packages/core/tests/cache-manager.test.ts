import { describe, it, expect, beforeEach } from 'bun:test'
import { McpCacheManager } from '../src/agent/cache-manager'

describe('McpCacheManager Semantic Cache & Tenant Quota Control', () => {
  let cacheManager: McpCacheManager

  beforeEach(() => {
    cacheManager = new McpCacheManager()
  })

  it('should cache and retrieve tool execution results within TTL', () => {
    cacheManager.setCache('tenant-1', 'list_projects', {}, [{ id: 'p1' }], 10)
    const cached = cacheManager.getCache('tenant-1', 'list_projects', {})
    expect(cached).toEqual([{ id: 'p1' }])
  })

  it('should enforce daily quota limits per tenant', () => {
    cacheManager.setTenantQuota('tenant-limited', { maxCallsPerDay: 2 })

    expect(cacheManager.checkQuota('tenant-limited').allowed).toBe(true)
    cacheManager.incrementQuota('tenant-limited')

    expect(cacheManager.checkQuota('tenant-limited').allowed).toBe(true)
    cacheManager.incrementQuota('tenant-limited')

    const result = cacheManager.checkQuota('tenant-limited')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('exceeded daily MCP quota')
  })
})
