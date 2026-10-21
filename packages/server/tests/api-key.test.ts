import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { issueApiKey } from '@alneas/eaos-core'
import { resolveApiKey } from '../src/auth-hooks/api-key'

test('API key resolver accepts verified bearer credentials and host authorization', async () => {
  const issued = issueApiKey({ tenantId: 'tenant-a', userId: 'user-a', scopes: ['estate:read'], now: new Date('2026-01-01T00:00:00.000Z') })
  const principal = await resolveApiKey({ authorization: `Bearer ${issued.secret}` }, { findByPrefix: async prefix => prefix === issued.record.prefix ? issued.record : null }, { requiredScope: 'estate:read', authorize: record => record.tenantId === 'tenant-a', now: new Date('2026-01-01T00:00:00.000Z') })
  expect(principal).toMatchObject({ tenantId: 'tenant-a', userId: 'user-a', apiKeyId: issued.record.id, scopes: ['estate:read'] })
  expect(await resolveApiKey({ authorization: `Bearer ${issued.secret}` }, { findByPrefix: async () => issued.record }, { requiredScope: 'estate:write' })).toBeNull()
})

test('API key resolver preserves valid base64url prefixes containing underscores', async () => {
  const secret = 'eaos_' + 'abc_defghijk' + '_' + '0'.repeat(35)
  const record = {
    id: 'key-with-underscore-prefix',
    prefix: 'abc_defghijk',
    hash: createHash('sha256').update(secret, 'utf8').digest('hex'),
    tenantId: 'tenant-a',
    userId: 'user-a',
    scopes: ['estate:read'],
    createdAt: '2026-01-01T00:00:00.000Z',
    revokedAt: null,
  } as const
  const principal = await resolveApiKey({ authorization: `Bearer ${secret}` }, { findByPrefix: async prefix => prefix === record.prefix ? record : null }, { requiredScope: 'estate:read', now: new Date('2026-01-01T00:00:00.000Z') })
  expect(principal).toMatchObject({ tenantId: 'tenant-a', userId: 'user-a', apiKeyId: record.id })
})
