import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAtomicRepository, createSqliteAtomicDriver } from '../plugin-data/atomic'
import { AtomicCheckpointSaver } from './atomic-checkpointer'
import { AgentGraphEngine, type AgentGraphState } from './graph'

const principal = { tenantId: 'tenant', userId: 'requester', roles: ['member'] }
function connection(path: string) { const db = new Database(path); db.exec('CREATE TABLE IF NOT EXISTS records (tenant_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(tenant_id,id))'); return db }
function saver(db: Database, verifyCurrent = async () => {}, p = principal) { return new AtomicCheckpointSaver({ repository: createAtomicRepository('records', createSqliteAtomicDriver(db)), principal: p, verifyCurrent }) }
function graph(checkpointer: AtomicCheckpointSaver, current = true) {
  return new AgentGraphEngine({ checkpointer, authorizeResume: async (_s, p) => current && p.approverId === 'manager' && p.approverRole === 'manager' })
    .addNode('prepare', async () => ({ pendingApproval: { toolName: 'confirm', args: { report: 'frozen' }, approvalLevel: 'L3_MANAGER', riskLevel: 'high', reason: 'Review the actual report' } }))
    .addNode('save', async s => { if (s.lastApproval?.approverId !== 'manager') throw Error('Actual verified approver missing'); return { context: { confirmedBy: s.lastApproval.approverId }, isComplete: true } })
    .addEdge('prepare', 'save').setEntryPoint('prepare')
}

test('official graph interrupt survives SQLite close/reopen, binds actual approval and denies foreign tenant and stale approval replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eaos-graph-')), path = join(directory, 'checkpoint.db'); let db = connection(path)
  try {
    const initial: AgentGraphState = { sessionId: 'intake-1', tenantId: principal.tenantId, userId: principal.userId, currentStep: '', history: [], isComplete: false }
    const waiting = await graph(saver(db)).runStep(initial)
    expect(waiting.pendingApproval?.binding?.inputHash).toBeDefined(); expect(waiting.isComplete).toBe(false)
    db.close(); db = connection(path)
    const restarted = graph(saver(db)), current = await restarted.getCheckpoint(initial.sessionId)
    expect(current?.pendingApproval).toEqual(waiting.pendingApproval)
    expect(await graph(saver(db, async () => {}, { ...principal, tenantId: 'foreign' })).getCheckpoint(initial.sessionId)).toBeNull()
    const ticket = { sessionId: initial.sessionId, approvalId: waiting.pendingApproval!.approvalId, bindingHash: waiting.pendingApproval!.binding!.bindingHash, approved: true, approverId: 'manager', approverRole: 'manager' }
    expect((await graph(saver(db), false).resumeAfterApproval(ticket)).resumed).toBe(false)
    expect((await restarted.resumeAfterApproval({ ...ticket, bindingHash: 'f'.repeat(64) })).resumed).toBe(false)
    const result = await restarted.resumeAfterApproval(ticket)
    expect(result.resumed).toBe(true); expect(result.state?.context?.confirmedBy).toBe('manager')
    expect(result.state?.lastApproval).toMatchObject({ approvalId: ticket.approvalId, bindingHash: ticket.bindingHash, approverId: 'manager', approverRole: 'manager', approved: true })
    expect((await restarted.resumeAfterApproval(ticket)).resumed).toBe(false)
    db.close(); db = connection(path)
    expect((await graph(saver(db)).getCheckpoint(initial.sessionId))?.context?.confirmedBy).toBe('manager')
    const history = []; for await (const entry of saver(db).list({ configurable: { thread_id: initial.sessionId } }, { limit: 2 })) history.push(entry)
    expect(history).toHaveLength(2); expect(history[0].checkpoint.id > history[1].checkpoint.id).toBe(true)
  } finally { db.close(); await rm(directory, { recursive: true, force: true }) }
})

test('revoked current admission rolls back checkpoint creation and serialized pending writes preserve official special channels', async () => {
  const db = connection(':memory:'); let allowed = true, calls = 0
  try {
    const verifier = async () => { if (++calls >= 3) allowed = false; if (!allowed) throw Error('Revoked') }
    const checkpoint = { v: 4, id: 'a', ts: new Date().toISOString(), channel_values: {}, channel_versions: {}, versions_seen: {} }
    const config = { configurable: { thread_id: 'thread', checkpoint_ns: '' } }, metadata = { source: 'input' as const, step: 0, parents: {} }
    await expect(saver(db, verifier).put(config, checkpoint, metadata)).rejects.toThrow('Revoked')
    expect(await saver(db).getTuple(config)).toBeUndefined()
    const saved = await saver(db).put(config, checkpoint, metadata)
    await saver(db).putWrites(saved, [['value', { x: 1 }], ['__error__', 'first']], 'task')
    await saver(db).putWrites(saved, [['value', { x: 2 }], ['__error__', 'last']], 'task')
    expect((await saver(db).getTuple(saved))?.pendingWrites).toEqual([['task', 'value', { x: 1 }], ['task', '__error__', 'last']])
    await expect(saver(db).put(config, { ...checkpoint, channel_values: { changed: true } }, metadata)).rejects.toThrow('reused')
    await expect(saver(db).deleteThread('thread')).rejects.toThrow('retention executor')
  } finally { db.close() }
})
