import { expect, test } from 'bun:test'
import { assertActiveConsent, DurableAuditTrail, hasActiveConsent, issueApiKey, revokeApiKey, verifyApiKey, verifyAuditChain } from '../src/security/platform-security'

test('API keys are hashed, scoped, expiring and revocable', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  const issued = issueApiKey({ tenantId: 'tenant-a', userId: 'user-a', scopes: ['estate:read'], now, expiresAt: '2026-02-01T00:00:00.000Z' })
  expect(issued.record.hash).not.toContain(issued.secret)
  expect(verifyApiKey(issued.secret, issued.record, 'estate:read', now)).toBe(true)
  expect(verifyApiKey(issued.secret, issued.record, 'estate:write', now)).toBe(false)
  expect(verifyApiKey(issued.secret, issued.record, 'estate:read', new Date('2026-03-01T00:00:00.000Z'))).toBe(false)
  expect(verifyApiKey(issued.secret, revokeApiKey(issued.record, now), 'estate:read', now)).toBe(false)
})

test('durable audit appends a serialized hash chain and fails closed on sink errors', async () => {
  const events: any[] = []; const trail = new DurableAuditTrail({ append: async event => { events.push(event) } }, () => new Date('2026-01-01T00:00:00.000Z'))
  await Promise.all([trail.append({ tenantId: 'tenant-a', userId: 'user-a', action: 'read', outcome: 'success' }), trail.append({ tenantId: 'tenant-a', userId: 'user-a', action: 'export', outcome: 'denied' })])
  expect(events).toHaveLength(2); expect(verifyAuditChain(events)).toBe(true); expect(events[1].previousHash).toBe(events[0].hash)
  const failed = new DurableAuditTrail({ append: async () => { throw new Error('sink unavailable') } })
  await expect(failed.append({ tenantId: 'tenant-a', userId: 'user-a', action: 'delete', outcome: 'failure' })).rejects.toThrow('sink unavailable')
})

test('consent requires matching purpose/version and active dates', () => {
  const records = [{ tenantId: 'tenant-a', userId: 'user-a', purpose: 'listing', version: 'v1', grantedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-02-01T00:00:00.000Z' }]
  const requirement = { tenantId: 'tenant-a', userId: 'user-a', purpose: 'listing', version: 'v1', now: new Date('2026-01-15T00:00:00.000Z') }
  expect(hasActiveConsent(records, requirement)).toBe(true); expect(hasActiveConsent(records, { ...requirement, version: 'v2' })).toBe(false); expect(() => assertActiveConsent(records, { ...requirement, now: new Date('2026-03-01T00:00:00.000Z') })).toThrow('Active consent required')
})
