import { test, expect } from 'bun:test'
import { createLiffClient, type LiffAdapter } from '../../src/client/liff'
function setup(overrides: Partial<LiffAdapter> = {}) {
 let loggedIn = true, initializations = 0
 const logins: string[] = []
 const sdk: LiffAdapter = { init: async () => { initializations++ }, isLoggedIn: () => loggedIn, login: value => { logins.push(value.redirectUri) }, logout: () => { loggedIn = false }, getProfile: async () => ({ userId: 'u', displayName: 'User', accessToken: 'never-export' } as any), isInClient: () => true, ...overrides }
 const client = createLiffClient({ sdk, liffId: 'configured-id', redirectUri: 'https://app.example/line' })
 return { client, stats: () => ({ initializations, logins }), loggedIn: (value: boolean) => { loggedIn = value } }
}
test('initialization is shared and provider credentials are excluded from profiles', async () => {
 const { client, stats } = setup()
 await Promise.all([client.initialize(), client.initialize(), client.getProfile()])
 expect(stats().initializations).toBe(1); expect(client.isInitialized()).toBe(true); expect(client.isInClient()).toBe(true)
 expect(await client.getProfile()).toEqual({ userId: 'u', displayName: 'User' })
})
test('initialization failures can retry; unauthenticated reads do not redirect automatically', async () => {
 let calls = 0
 const { client, stats, loggedIn } = setup({ init: async () => { if (++calls === 1) throw new Error('offline') } })
 await expect(client.initialize()).rejects.toThrow('offline'); expect(client.isInitialized()).toBe(false)
 await client.initialize(); expect(calls).toBe(2)
 loggedIn(false); expect(await client.getProfile()).toBeNull(); expect(stats().logins).toEqual([])
 await client.login(); expect(stats().logins).toEqual(['https://app.example/line'])
})
test('logout and host invalidation discard late profile results', async () => {
 let finish!: (profile: any) => void
 const { client, loggedIn } = setup({ getProfile: () => new Promise(resolve => { finish = resolve }) })
 await client.initialize()
 const pending = client.getProfile(); await Promise.resolve(); await client.logout()
 finish({ userId: 'old', displayName: 'Old' }); expect(await pending).toBeNull()
 loggedIn(true); const next = client.getProfile(); await Promise.resolve(); client.invalidate()
 finish({ userId: 'old', displayName: 'Old' }); expect(await next).toBeNull()
})
test('untrusted redirect configuration is rejected', () => {
 const sdk = {} as LiffAdapter
 expect(() => createLiffClient({ sdk, liffId: 'id', redirectUri: 'http://app.example/' })).toThrow()
 expect(() => createLiffClient({ sdk, liffId: '', redirectUri: 'https://app.example/' })).toThrow()
})
