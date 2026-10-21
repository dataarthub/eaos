import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { LocalFirstSqliteAdapter } from '@alneas/eaos-server/db/local-first-sqlite-adapter'
import type { DataAccessAdapter } from '@alneas/appkit-core/data/types'

test('count uses the local filter and ignores pagination', async () => {
 const db = new Database(':memory:')
 const adapter = new LocalFirstSqliteAdapter({
  sqlite: { execute: async (sql, params = []) => db.run(sql, params), select: async (sql, params = []) => db.query(sql).all(...params) as any },
  upstream: {} as DataAccessAdapter,
  syncIntervalMs: 0,
  enableLifecycleSync: false,
 })
 try {
  await adapter.initSchema()
  db.run('CREATE TABLE notes (id TEXT, done INTEGER)')
  db.run("INSERT INTO notes VALUES ('a', 1), ('b', 1), ('c', 0)")
  expect(await adapter.count('notes', { done: { $eq: 1 } }, { limit: 1, skip: 1 })).toBe(2)
  expect(await adapter.count('notes', { done: 2 })).toBe(0)
 } finally { adapter.destroy(); db.close() }
})
