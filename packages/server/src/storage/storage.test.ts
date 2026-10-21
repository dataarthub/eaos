import { test, expect } from 'bun:test'
import { createTenantStorage, type StorageAdapter } from './index'
function fixture() {
  const calls: any[] = [], objects = new Map<string, string>()
  const base: StorageAdapter = {
    async upload(key, data, options) { calls.push(['upload', key, options]); objects.set(key, String(data)); return { key } },
    async download(key) { calls.push(['download', key]); return objects.has(key) ? Buffer.from(objects.get(key)!) : null },
    async delete(key) { calls.push(['delete', key]); return objects.delete(key) },
    async exists(key) { calls.push(['exists', key]); return objects.has(key) },
    async head(key) { calls.push(['head', key]); return objects.has(key) ? { key } : null },
    async getUrl(key, options) { calls.push(['getUrl', key, options]); return `https://storage.invalid/${key}` },
    async list(options) { calls.push(['list', options]); return { objects: [...objects.keys()].filter(k => k.startsWith(options?.prefix ?? '')).map(key => ({ key })), hasMore: true, nextCursor: 'provider-token', prefixes: [options!.prefix! + 'folder/'] } },
    async copy(source, key) { calls.push(['copy', source, key]); return { key } },
    async move(source, key) { calls.push(['move', source, key]); return { key } },
  }
  let enabled = true
  const options = { tenantId: 'alpha', pluginId: 'notes', authorize: () => enabled }
  return { base, calls, objects, scoped: createTenantStorage(base, options), disable: () => { enabled = false } }
}
test('all operations use tenant and plugin paths; returns relative keys', async () => {
  const f = fixture(), s = f.scoped
  expect((await s.upload('doc.txt', 'data')).key).toBe('doc.txt')
  expect((await s.download('doc.txt'))?.toString()).toBe('data')
  expect(await s.exists('doc.txt')).toBe(true); expect((await s.head('doc.txt'))?.key).toBe('doc.txt')
  expect((await s.copy!('doc.txt', 'copy.txt')).key).toBe('copy.txt')
  expect((await s.move!('copy.txt', 'new.txt')).key).toBe('new.txt')
  await s.getUrl('doc.txt')
  const page = await s.list()
  expect(page.objects).toEqual([{ key: 'doc.txt' }]); expect(page.prefixes).toEqual(['folder/'])
  await s.list({ cursor: page.nextCursor })
  expect(f.calls.at(-1)[1].cursor).toBe('provider-token')
  expect(f.calls.filter(c => c[0] !== 'list').every(c => c[1].startsWith('tenants/alpha/plugins/notes/'))).toBe(true)
  expect(await s.delete('doc.txt')).toBe(true)
})
test('separates tenants and plugins with identical object keys', async () => {
  const f = fixture(); await f.scoped.upload('doc.txt', 'alpha')
  for (const [tenantId, pluginId] of [['beta', 'notes'], ['alpha', 'other']]) {
    const s = createTenantStorage(f.base, { tenantId, pluginId, authorize: () => true })
    expect(await s.download('doc.txt')).toBeNull(); expect((await s.list()).objects).toEqual([])
    await s.upload('doc.txt', 'other')
  }
  expect((await f.scoped.download('doc.txt'))?.toString()).toBe('alpha')
})
test('rejects paths that can escape or normalize to another location', async () => {
  const f = fixture()
  for (const key of ['', '../x', 'a/../x', '/root', 'a\\b', '%2e%2e/x', 'a//x', './x', 'a\0b', 'a?x', 'a#x']) {
    await expect(f.scoped.download(key)).rejects.toThrow('key')
    await expect(f.scoped.copy!('valid', key)).rejects.toThrow('key')
  }
  expect(f.calls).toHaveLength(0)
  expect(() => createTenantStorage(f.base, { tenantId: '../beta', pluginId: 'notes', authorize: () => true })).toThrow('scope')
})
test('rechecks authorization for every operation after disable', async () => {
  const f = fixture(); await f.scoped.upload('a', 'a'); const before = f.calls.length; f.disable()
  for (const call of [() => f.scoped.download('a'), () => f.scoped.upload('a', 'a'), () => f.scoped.getUrl('a'), () => f.scoped.delete('a'), () => f.scoped.exists('a'), () => f.scoped.head('a'), () => f.scoped.list(), () => f.scoped.copy!('a', 'b'), () => f.scoped.move!('a', 'b')]) await expect(call()).rejects.toThrow('denied')
  expect(f.calls.length).toBe(before)
})
test('private upload and short signed URLs are mandatory', async () => {
  const f = fixture()
  await expect(f.scoped.upload('a', 'a', { public: true })).rejects.toThrow('Public')
  await expect(f.scoped.getUrl('a', { signed: false })).rejects.toThrow('policy')
  for (const expiresIn of [0, 301, Infinity, 0.5]) await expect(f.scoped.getUrl('a', { expiresIn })).rejects.toThrow('policy')
  expect(f.calls).toHaveLength(0)
  await f.scoped.getUrl('a'); expect(f.calls.at(-1)[2]).toEqual({ signed: true, expiresIn: 300 })
})
test('rejects provider results and cursors from another scope', async () => {
  const f = fixture(); const page = await f.scoped.list()
  const other = createTenantStorage(f.base, { tenantId: 'beta', pluginId: 'notes', authorize: () => true })
  await expect(other.list({ cursor: page.nextCursor })).rejects.toThrow('cursor')
  await expect(f.scoped.list({ prefix: 'other/', cursor: page.nextCursor })).rejects.toThrow('cursor')
  f.base.list = async () => ({ objects: [{ key: 'tenants/beta/plugins/notes/a' }], hasMore: false })
  await expect(f.scoped.list()).rejects.toThrow('outside')
  f.base.head = async () => ({ key: 'tenants/alpha/plugins/notes/../other/a' })
  await expect(f.scoped.head('a')).rejects.toThrow('key')
})
