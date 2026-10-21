import { expect, test } from 'bun:test'
import { createKratosBrowserAuth, validateBrowserAuthConfig } from '../../src/client/browser-auth'
const config = { publicUrl: 'https://identity.example', provider: 'line', returnTo: 'https://app.example/login-callback', redirectOrigins: ['https://access.line.me'] }
test('browser OIDC submits CSRF with cookies and follows only a trusted provider redirect', async () => {
 const calls: [unknown, any][] = [], redirects: string[] = []
 const request = async (url: unknown, init: any) => { calls.push([url, init]); return calls.length === 1 ? Response.json({ id: 'flow', ui: { nodes: [{ attributes: { name: 'csrf_token', value: 'csrf' } }] } }) : Response.json({ error: { id: 'browser_location_change_required' }, redirect_browser_to: 'https://access.line.me/oauth2/v2.1/authorize?state=state' }, { status: 422 }) }
 await createKratosBrowserAuth({ ...config, fetch: request as any, navigate: url => redirects.push(url) }).login()
 expect(calls[0][0]).toContain('/self-service/login/browser?')
 expect(calls[1][1].credentials).toBe('include')
 expect(JSON.parse(calls[1][1].body)).toEqual({ method: 'oidc', provider: 'line', csrf_token: 'csrf' })
 expect(redirects).toEqual(['https://access.line.me/oauth2/v2.1/authorize?state=state'])
})
test('rejects missing CSRF, error responses and untrusted redirects', async () => {
 for (const bad of ['csrf', 'redirect', 'status']) {
  let calls = 0
  const request = async () => ++calls === 1 ? Response.json({ id: 'flow', ui: { nodes: bad === 'csrf' ? [] : [{ attributes: { name: 'csrf_token', value: 'csrf' } }] } }) : Response.json({ error: { id: 'browser_location_change_required' }, redirect_browser_to: 'https://evil.example/' }, { status: bad === 'status' ? 400 : 422 })
  await expect(createKratosBrowserAuth({ ...config, fetch: request as any, navigate: () => { throw new Error('Must not navigate') } }).login()).rejects.toThrow()
 }
 expect(() => validateBrowserAuthConfig({ ...config, publicUrl: 'https://user:secret@identity.example' })).toThrow()
})
test('logout accepts only the IdP origin', async () => {
 const redirects: string[] = []
 const auth = createKratosBrowserAuth({ ...config, fetch: (async () => Response.json({ logout_url: 'https://identity.example/self-service/logout?token=logout' })) as any, navigate: url => redirects.push(url) })
 await auth.logout(); expect(redirects[0]).toContain('/self-service/logout?')
})
