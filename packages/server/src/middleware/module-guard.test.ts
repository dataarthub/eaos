import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { EaosEnv } from '@alneas/eaos-core'
import { createModuleGuard } from './module-guard'

function appWith(enabledModules: unknown, options?: { isDev?: boolean }) {
  const app = new Hono<EaosEnv>()
  app.use('/protected', async (c, next) => {
    c.set('enabledModules', enabledModules)
    await next()
  })
  app.use('/protected', createModuleGuard('billing', options))
  app.get('/protected', c => c.text('ok'))
  return app
}

describe('createModuleGuard', () => {
  test('fails closed when entitlements are absent or malformed', async () => {
    expect((await appWith(undefined).request('/protected')).status).toBe(403)
    expect((await appWith(['billing', 42]).request('/protected')).status).toBe(403)
  })

  test('allows only an enabled module or all-module entitlement', async () => {
    expect((await appWith(['billing']).request('/protected')).status).toBe(200)
    expect((await appWith(['other']).request('/protected')).status).toBe(403)
    expect((await appWith(['all']).request('/protected')).status).toBe(200)
  })

  test('supports an explicit development bypass without an environment bypass', async () => {
    expect((await appWith(undefined, { isDev: true }).request('/protected')).status).toBe(200)
  })
})
