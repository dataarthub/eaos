import { test, expect } from 'bun:test'
import { MemoryCacheManager } from '../src/cache/index'
test('invalidation during fetch cannot repopulate old data, and last fetch wins', async () => {
 const cache = new MemoryCacheManager(); let finish!: (v: string) => void
 const pending = cache.getOrSet('k', () => new Promise<string>(r => finish = r), { tags: ['t'] })
 cache.invalidateTags('t'); finish('old'); await pending; expect(cache.size()).toBe(0)
 const stale = cache.getOrSet('k', () => new Promise<string>(r => finish = r))
 await cache.getOrSet('k', async () => 'new'); finish('old'); await stale
 expect(await cache.getOrSet('k', async () => 'wrong')).toBe('new')
})
test('replacing tags cleans indexes; bounded values are detached; expiry is removed', async () => {
 const c = new MemoryCacheManager({ maxEntries: 2 }); c.set('k', { a: 1 }, 5000, ['old']); c.set('k', { a: 2 }, 5000, ['new']); c.invalidateTags('old')
 const v = await c.getOrSet('k', async () => ({ a: 0 })); v.a = 9; expect(await c.getOrSet('k', async () => ({ a: 0 }))).toEqual({ a: 2 })
 c.set('b', 2); c.set('c', 3); expect(c.size()).toBe(2); c.set('b', 2, 0); expect(c.size()).toBe(1)
 c.invalidateTags('new'); c.clear(); expect(c.size()).toBe(0)
})
test('scope and authorization protect cached and in-flight results', async () => {
 const c = new MemoryCacheManager(); let enabled = true
 const a = c.forScope({ tenantId: 'a', pluginId: 'p', userId: 'u' }, () => enabled), b = c.forScope({ tenantId: 'b', pluginId: 'p', userId: 'u' }, () => true)
 expect(await a.getOrSet('same', async () => 'a')).toBe('a'); expect(await b.getOrSet('same', async () => 'b')).toBe('b')
 enabled = false; await expect(a.getOrSet('same', async () => 'oops')).rejects.toThrow('denied')
 enabled = true; await expect(a.getOrSet('another', async () => { enabled = false; return 'secret' })).rejects.toThrow('denied')
 expect(c.size()).toBe(2)
})
