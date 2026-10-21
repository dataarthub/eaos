import { expect, test } from 'bun:test'
import { createPluginExecutionRouter } from '../src/execution/index'
test('execution uses verified identity and current authorization, with bounded JSON input', async () => {
 let allowed = true, invoked = 0
 const router = createPluginExecutionRouter({ maxBodyBytes: 64, resolveIdentity: async () => ({ tenantId: 'trusted', userId: 'u' }), authorize: async () => allowed, operations: { 'notes:parse': async (identity, payload) => { invoked++; return { identity, payload } } } })
 const call = (body: string, action = 'parse') => router.request(`/notes/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
 const response = await call('{"tenantId":"spoofed"}'); expect((await response.json() as any).identity.tenantId).toBe('trusted')
 allowed = false; expect((await call('{}')).status).toBe(403)
 expect((await call('bad')).status).toBe(400); expect((await call('x'.repeat(65))).status).toBe(413)
  expect((await call('{}', 'unknown')).status).toBe(404); expect(invoked).toBe(1)
  expect((await router.request('/notes/parse', { method: 'POST', body: '{}' })).status).toBe(415)
  expect((await router.request('/notes/parse', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })).status).toBe(403)
})
