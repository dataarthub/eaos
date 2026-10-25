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


test('lost publication acknowledgement retries the same delivery identity until explicit exhaustion', async () => {
 const event = createOutboxEvent({ tenantId: 'tenant-a', producer: 'fixture', topic: 'notify', idempotencyKey: 'command', payload: { message: 'once' }, availableAt: '2026-10-01T00:00:00Z' })
 const events: OutboxEvent[] = [structuredClone(event)], durable = store(events), delivered = new Set<string>(), attempts: string[] = []
 let current = new Date('2026-10-02T00:00:00Z')
 const dispatcher = new OutboxDispatcher({ store: { ...durable, markPublished: async () => { throw new Error('acknowledgement lost after remote success') } }, handlers: { notify: async value => { attempts.push(value.id); delivered.add(value.id) } }, now: () => current, retryPolicy: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 10 } })
 expect(await dispatcher.runOnce()).toMatchObject({ published: 0, retried: 1 })
 current = new Date(current.getTime() + 10)
 expect(await dispatcher.runOnce()).toMatchObject({ published: 0, failed: 1 })
 expect(attempts).toEqual([event.id, event.id]); expect(delivered.size).toBe(1)
 expect(events[0]).toMatchObject({ status: 'failed', attempts: 2, idempotencyKey: 'command', payloadHash: event.payloadHash })
 expect(await dispatcher.runOnce()).toMatchObject({ claimed: 0 })
})

test('suspension after claim prevents the deferred effect and quarantines work without granting replay authority', async () => {
 const events: OutboxEvent[] = [structuredClone(createOutboxEvent({ tenantId: 'tenant-a', producer: 'fixture', topic: 'notify', idempotencyKey: 'suspended', payload: {}, availableAt: '2026-10-01T00:00:00Z' }))]
 const durable = store(events); let active = true, effects = 0
 const dispatcher = new OutboxDispatcher({ store: { ...durable, claim: async (now, limit) => { const result = await durable.claim(now, limit); active = false; return result } }, handlers: { notify: async () => { effects++ } }, execute: async (_event, operation) => { if (!active) throw new OutboxDispatchError('activation revoked', { retryable: false }); await operation() } })
 expect(await dispatcher.runOnce()).toMatchObject({ claimed: 1, failed: 1, retried: 0 })
 expect(effects).toBe(0); active = true
 expect(await dispatcher.runOnce()).toMatchObject({ claimed: 0 }); expect(effects).toBe(0)
})
