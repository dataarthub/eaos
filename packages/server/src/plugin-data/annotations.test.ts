import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createAtomicRepository, createSqliteAtomicDriver, atomicHash, atomicCommand } from './atomic'
import { documentAnnotations } from './annotations'
test('version-scoped annotations isolate tenants/users, enforce CAS and ownership, paginate and replay', async () => {
 const db = new Database(':memory:')
 db.exec('CREATE TABLE records (tenant_id TEXT, id TEXT, revision INTEGER, payload TEXT, PRIMARY KEY(tenant_id,id))')
 const repo = createAtomicRepository('records', createSqliteAtomicDriver(db)), p = { tenantId: 't', userId: 'a', roles: [] }, target = { scope: atomicHash('v1'), anchorIds: ['a'], checkIds: ['check'] }
 const call = (op: string, a: Record<string, any>, user = p, t = target) => repo.run(user, tx => {
  const work = () => documentAnnotations(tx, user, t, op, a, '2026-09-17T00:00:00Z')
  return a.commandId ? atomicCommand(tx, user, op, a as any, work) : work()
 })
 const read = (user = p, visibility = 'private', t = target) => call('get_annotations', { visibility }, user, t)
 expect((await read())!.revision).toBe(0)
 const check = { commandId: 'check', itemId: 'check', checked: true, revision: 0 }
 await call('set_check', check); expect((await call('set_check', check))!.revision).toBe(1)
 await expect(call('set_check', { ...check, commandId: 'stale' })).rejects.toThrow()
 await expect(call('set_check', { ...check, commandId: 'invalid', itemId: 'a', revision: 1 })).rejects.toThrow('Unknown')
 expect((await read({ ...p, userId: 'b' }))!.checks).toEqual({})
 expect((await read({ ...p, tenantId: 'other' }))!.checks).toEqual({})
 expect((await read(p, 'private', { ...target, scope: atomicHash('v2') }))!.checks).toEqual({})
 const privateInput = { commandId: 'private', visibility: 'private', anchorId: 'a', body: '<script>plain text</script>' }
 const note = await call('add_comment', privateInput) as any
 expect((await call('add_comment', privateInput) as any).id).toBe(note.id)
 expect((await read())!.comments).toHaveLength(1)
 expect((await read({ ...p, userId: 'b' }))!.comments).toHaveLength(0)
 await expect(call('add_comment', { ...privateInput, commandId: 'bad', anchorId: 'not-here' })).rejects.toThrow('anchor')
 const shared = await call('add_comment', { ...privateInput, commandId: 'shared', visibility: 'shared' }) as any
 expect((await read({ ...p, userId: 'b' }, 'shared'))!.comments![0].canResolve).toBe(false)
 await expect(call('resolve_comment', { commandId: 'deny', commentId: shared.id, visibility: 'shared', revision: 1, resolved: true }, { ...p, userId: 'b' })).rejects.toThrow('author')
 await call('resolve_comment', { commandId: 'resolve', commentId: shared.id, visibility: 'shared', revision: 1, resolved: true })
 expect((await read(p, 'shared'))!.comments![0].resolved).toBe(true)
 for (let n = 0; n < 51; n++) await call('add_comment', { ...privateInput, commandId: `page${n}` })
 const page = await read(); expect(page!.comments).toHaveLength(50); expect(page!.cursor).toBeTruthy()
 const next = await call('get_annotations', { visibility: 'private', cursor: page!.cursor }); expect(next!.comments).toHaveLength(2)
 await expect(call('get_annotations', { visibility: 'shared', cursor: page!.cursor })).rejects.toThrow('cursor')
 await expect(call('get_annotations', { visibility: 'private', cursor: page!.cursor }, { ...p, userId: 'b' })).rejects.toThrow('cursor')
 db.close()
})
