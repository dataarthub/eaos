import { expect, test } from 'bun:test'
import { createBrowserSessionRouter, createKratosSessionVerifier } from '../src/browser-auth/index'
test('whoami validates active identity without calling Admin API or leaking mixed credentials', async () => {
 const calls: any[] = []
 const verify = createKratosSessionVerifier({ publicUrl: 'https://identity.example', fetch: (async (url, init) => { calls.push([String(url), init]); return Response.json({ active: true, identity: { id: 'user' } }) }) as any })
 expect(await verify({})).toBeNull()
 expect((await verify({ cookie: 'old', sessionToken: 'native' }))?.userId).toBe('user')
 expect(calls).toHaveLength(1); expect(calls[0][0]).toBe('https://identity.example/sessions/whoami')
 expect(calls[0][1].headers.Cookie).toBeUndefined()
 expect(calls[0][1].headers['X-Session-Token']).toBe('native')
})
test('router rechecks host membership on every request and serializes no config secrets', async () => {
 let enabled = true
 const router = createBrowserSessionRouter({ configuration: () => ({ publicUrl: 'https://identity.example', provider: 'line', returnTo: 'https://app.example/callback', redirectOrigins: [], secret: 'hidden' }), resolveSession: async () => enabled ? { userId: 'u', tenantId: 't', roles: [], enabledModules: [] } : null })
 expect(await (await router.request('/config')).text()).not.toContain('hidden')
 expect((await router.request('/session')).status).toBe(200)
 enabled = false
 const denied = await router.request('/session'); expect(denied.status).toBe(401); expect(denied.headers.get('Cache-Control')).toBe('no-store')
})
