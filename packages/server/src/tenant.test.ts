import { describe, expect, test } from 'bun:test'
import { createTenantResolver } from './tenant'

describe('TenantResolver', () => {
  const resolver = createTenantResolver({
    defaultTenantId: 'tkc',
    domainTenantMap: {
      'tokyo-kensetsu.page': 'tkc',
      'tokyo-kensetsu.com': 'tkc',
      'partner.co.jp': 'partner',
    },
    hostTenantMap: {
      'special.corp.com': 'special-tenant',
    },
  })

  test('resolves tenant from email domain', () => {
    expect(resolver.resolveFromEmail('ikoma@tokyo-kensetsu.page')).toBe('tkc')
    expect(resolver.resolveFromEmail('user@tokyo-kensetsu.com')).toBe('tkc')
    expect(resolver.resolveFromEmail('john@partner.co.jp')).toBe('partner')
    expect(resolver.resolveFromEmail('unknown@external.com')).toBeNull()
  })

  test('resolves tenant only from explicit trusted host mappings', () => {
    expect(resolver.resolveFromHost('special.corp.com')).toBe('special-tenant')
    expect(resolver.resolveFromHost('tenant-xyz.example.com')).toBeNull()
    expect(resolver.resolveFromHost('app.tokyo-kensetsu.com')).toBeNull()
    expect(resolver.resolveFromHost('localhost:3000')).toBeNull()
  })

  test('falls back to defaultTenantId when no matches', () => {
    expect(resolver.resolve({ email: 'user@other.com', host: 'app.example.com' })).toBe('tkc')
  })

  test('respects explicit tenant ID if provided', () => {
    expect(resolver.resolve({ explicitTenantId: 'override-tenant', email: 'ikoma@tokyo-kensetsu.page' })).toBe('override-tenant')
  })

  test('does not treat email domains as authenticated tenant claims', () => {
    expect(resolver.resolve({ email: 'john@partner.co.jp' })).toBe('tkc')
    expect(resolver.resolve({ host: 'special.corp.com', email: 'john@partner.co.jp' })).toBe('special-tenant')
  })
})
