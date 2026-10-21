import { describe, expect, test } from 'bun:test'
import { createOutboxEvent, OutboxDispatchError, OutboxDispatcher, type OutboxEvent, type OutboxStore } from '../src/events/outbox'

function store(events: OutboxEvent[]): OutboxStore {
  return {
    async claim(now, limit) {
      return events.filter(event => event.status === 'pending' && Date.parse(event.availableAt) <= now.getTime()).slice(0, limit).map(event => {
        event.status = 'processing'
        event.attempts++
        event.claimToken = `claim-${event.attempts}`
        event.claimedAt = now.toISOString()
        return structuredClone(event)
      })
    },
    async markPublished(id, token, at) {
      const event = events.find(value => value.id === id)
      if (!event || event.claimToken !== token) throw new Error('claim changed')
      event.status = 'published'; event.publishedAt = at.toISOString()
    },
    async markFailed(id, token, error, retryAt) {
      const event = events.find(value => value.id === id)
      if (!event || event.claimToken !== token) throw new Error('claim changed')
      event.status = retryAt ? 'pending' : 'failed'; event.availableAt = retryAt?.toISOString() ?? event.availableAt; event.lastError = error
    },
  }
}

describe('outbox contracts', () => {
  test('creates a deterministic idempotency identity and payload hash', () => {
    const a = createOutboxEvent({ tenantId: 'tenant-1', producer: 'estate-properties', topic: 'property.updated', idempotencyKey: 'command-1', payload: { b: 2, a: 1 } })
    const b = createOutboxEvent({ tenantId: 'tenant-1', producer: 'estate-properties', topic: 'property.updated', idempotencyKey: 'command-1', payload: { b: 2, a: 1 } })
    expect(a.id).toBe(b.id)
    expect(a.payloadHash).toBe(b.payloadHash)
  })

  test('publishes successful events and retries failures without sleeping', async () => {
    const event = { ...createOutboxEvent({ tenantId: 'tenant-1', producer: 'estate-properties', topic: 'property.updated', idempotencyKey: 'command-1', payload: { id: 'p1' }, availableAt: '2026-09-18T00:00:00.000Z' }) }
    const events = [event as OutboxEvent]
    let calls = 0
    let current = new Date('2026-09-19T00:00:00.000Z')
    const dispatcher = new OutboxDispatcher({ store: store(events), handlers: { 'property.updated': async () => { calls++; if (calls === 1) throw new Error('temporary') } }, now: () => current, retryPolicy: { baseDelayMs: 10, maxDelayMs: 10 } })
    expect(await dispatcher.runOnce()).toMatchObject({ claimed: 1, retried: 1, published: 0 })
    expect(events[0].status).toBe('pending')
    current = new Date('2026-09-19T00:00:00.010Z')
    expect(await dispatcher.runOnce()).toMatchObject({ claimed: 1, published: 1 })
    expect(calls).toBe(2)
  })

  test('does not retry a permanent handler error', async () => {
    const event = { ...createOutboxEvent({ tenantId: 'tenant-1', producer: 'estate-properties', topic: 'property.deleted', idempotencyKey: 'command-2', payload: {}, availableAt: '2026-09-18T00:00:00.000Z' }) }
    const events = [event as OutboxEvent]
    const dispatcher = new OutboxDispatcher({ store: store(events), handlers: { 'property.deleted': async () => { throw new OutboxDispatchError('authorization revoked', { retryable: false }) } } })
    expect(await dispatcher.runOnce()).toMatchObject({ failed: 1, retried: 0 })
    expect(events[0].status).toBe('failed')
  })
})
