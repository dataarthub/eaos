import { expect, test } from 'bun:test'
import { createHealthRouter } from './index'

test('health router separates liveness from dependency readiness and redacts failures', async () => {
  const app = createHealthRouter({ appName: 'test', checks: [{ id: 'database', run: async () => { throw new Error('password=secret') } }], now: () => new Date('2026-09-19T00:00:00.000Z') })
  const live = await app.request('/health')
  expect(live.status).toBe(200)
  expect(await live.json()).toEqual({ status: 'healthy', appName: 'test', state: 'alive', checkedAt: '2026-09-19T00:00:00.000Z' })
  const ready = await app.request('/health/ready')
  expect(ready.status).toBe(503)
  const body = await ready.json() as Record<string, unknown>
  expect(body).toMatchObject({ appName: 'test', state: 'not_ready', checks: [{ id: 'database', state: 'failed' }] })
  expect(JSON.stringify(body)).not.toContain('secret')
})
