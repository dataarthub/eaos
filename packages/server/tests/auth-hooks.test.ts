import { test, expect } from 'bun:test'
import { createRegistrationHook } from '../src/auth-hooks/index'
test('registration hook verifies caller and validates body before policy callback', async () => {
 let calls = 0
 const app = createRegistrationHook({ verify: async c => c.req.header('x-key') === 'test' ? undefined : c.json({ error: 'denied' }, 401), parse: v => { if (!v || typeof (v as any).identity_id !== 'string') throw new Error('bad'); return v }, register: async (_v, c) => { calls++; return c.json({ ok: true }) } })
 expect((await app.request('/registration', { method: 'POST', body: '{}' })).status).toBe(401)
 expect((await app.request('/registration', { method: 'POST', headers: { 'x-key': 'test' }, body: '{}' })).status).toBe(400)
 expect(calls).toBe(0)
 expect((await app.request('/registration', { method: 'POST', headers: { 'x-key': 'test' }, body: '{"identity_id":"verified"}' })).status).toBe(200); expect(calls).toBe(1)
})
