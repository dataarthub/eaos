import { describe, expect, it } from 'bun:test'
import { createPlatformContext } from '../src/adapters/platform-context'

const db = {} as any
const storage = {} as any

describe('createPlatformContext', () => {
  it('creates an event bus per context when no bus is supplied', () => {
    const first = createPlatformContext({ db, storage })
    const second = createPlatformContext({ db, storage })
    expect(first.events).not.toBe(second.events)
    let calls = 0
    first.events.subscribe('test', () => { calls++ })
    second.events.publish('test', {})
    expect(calls).toBe(0)
    first.events.publish('test', {})
    expect(calls).toBe(1)
  })

  it('preserves host-scoped AI adapters without creating provider state in core', () => {
    const adapters = { calendar: { id: 'calendar-host', capabilities: ['calendar.read'] } as any }
    const context = createPlatformContext({ db, storage, tenantId: 'tenant-a', userId: 'user-a', aiHostAdapters: adapters })
    expect(context.aiHostAdapters).toBe(adapters)
    expect(context.tenantId).toBe('tenant-a')
    expect(context.userId).toBe('user-a')
  })
})
