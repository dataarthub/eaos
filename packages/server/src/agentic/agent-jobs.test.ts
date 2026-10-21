import { describe, expect, test } from 'bun:test'
import { DurableAgentJobDispatcher, createAgentJob, type AgentJobStore } from './agent-jobs'
import type { AgentJobRecord } from '@alneas/eaos-core'
import type { ServerAgentTaskRequest, ServerAgentTaskResult } from './types'
import { Database } from 'bun:sqlite'
import { createAtomicRepository, createSqliteAtomicDriver } from '../plugin-data/atomic'
import { createAtomicAgentJobStore, enqueueAgentJob } from './agent-jobs'

function storeFor(job: AgentJobRecord<ServerAgentTaskRequest>): AgentJobStore & { state: typeof job } {
  const state = structuredClone(job)
  return {
    state,
    async claim() { state.status = 'running'; state.leaseToken = 'lease-1'; state.attempt += 1; return [structuredClone(state)] },
    async markCompleted(_id, token, result, now) { if (token !== state.leaseToken) throw new Error('lease'); state.status = 'succeeded'; state.result = result; state.updatedAt = now.toISOString() },
    async markWaitingApproval(_id, token, result, now) { if (token !== state.leaseToken) throw new Error('lease'); state.status = 'waiting_approval'; state.result = result; state.updatedAt = now.toISOString() },
    async markRetryable(_id, token, error, failureCode, retryAt, now) { if (token !== state.leaseToken) throw new Error('lease'); state.status = 'retryable'; state.error = error; state.failureCode = failureCode; state.availableAt = retryAt.toISOString(); state.updatedAt = now.toISOString() },
    async markFailed(_id, token, error, failureCode, now) { if (token !== state.leaseToken) throw new Error('lease'); state.status = 'failed'; state.error = error; state.failureCode = failureCode; state.updatedAt = now.toISOString() },
  }
}

const request: ServerAgentTaskRequest = { id: 'job-1', tenantId: 'tenant-a', userId: 'bot', title: 'Analyze document', instructions: 'analyze', workerType: 'custom', jobKind: 'document-analysis' }

describe('DurableAgentJobDispatcher', () => {
  test('runs a generic non-task-graph agent job and invokes completion', async () => {
    const job = createAgentJob({ request, kind: 'document-analysis', now: new Date('2026-09-21T00:00:00Z') })
    const store = storeFor(job)
    let completed = false
    const worker = { runTask: async (): Promise<ServerAgentTaskResult> => ({ taskId: 'job-1', status: 'COMPLETED', output: '{"ok":true}', durationMs: 1 }) }
    const dispatcher = new DurableAgentJobDispatcher({ store, worker: worker as any, onCompleted: async () => { completed = true } })
    expect(await dispatcher.runOnce()).toMatchObject({ claimed: 1, succeeded: 1, retried: 0, failed: 0 })
    expect(completed).toBe(true)
    expect(store.state.status).toBe('succeeded')
  })

  test('keeps retryable ARM failures out of the completed state', async () => {
    const job = createAgentJob({ request, kind: 'anomaly-investigation' })
    const store = storeFor(job)
    const worker = { runTask: async (): Promise<ServerAgentTaskResult> => ({ taskId: 'job-1', status: 'FAILED', error: 'ARM unavailable', failureCode: 'AGENT_UNAVAILABLE', retryable: true, durationMs: 1 }) }
    const dispatcher = new DurableAgentJobDispatcher({ store, worker: worker as any, baseDelayMs: 1, maxDelayMs: 1 })
    expect(await dispatcher.runOnce()).toMatchObject({ claimed: 1, retried: 1, succeeded: 0 })
    expect(store.state.status).toBe('retryable')
  })

  test('persists jobs and idempotency through the tenant-scoped atomic repository', async () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE jobs(tenant_id TEXT, id TEXT, revision INTEGER, payload TEXT, PRIMARY KEY(tenant_id,id))')
    const repository = createAtomicRepository('jobs', createSqliteAtomicDriver(db))
    const principal = { tenantId: 'tenant-a', userId: 'scheduler', roles: ['worker'] }
    const job = createAgentJob({ request, kind: 'document-analysis', now: new Date('2026-09-21T00:00:00Z') })
    const first = await repository.run(principal, tx => enqueueAgentJob(tx, job))
    const second = await repository.run(principal, tx => enqueueAgentJob(tx, { ...job, jobId: 'different-id' }))
    expect(second.jobId).toBe(first.jobId)
    const durable = createAtomicAgentJobStore({ repository, principal, now: () => new Date('2026-09-21T00:00:00Z') })
    const claimed = await durable.claim(new Date('2026-09-21T00:00:00Z'), 1)
    expect(claimed[0].status).toBe('running')
    await durable.markCompleted(claimed[0].jobId, claimed[0].leaseToken!, { taskId: request.id, status: 'COMPLETED', output: 'ok', durationMs: 1 }, new Date())
    expect((await durable.claim(new Date('2026-09-21T00:00:00Z'), 1))).toHaveLength(0)
    db.close()
  })
})


test('completed history on early pages never starves later due jobs, and cancellation uses the same durable record',async()=>{
 const {cancelAgentJob}=await import('./agent-jobs')
 const db=new Database(':memory:');db.exec('CREATE TABLE jobs(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))')
 const p={tenantId:'tenant-a',userId:'bot',roles:['worker']},repository=createAtomicRepository('jobs',createSqliteAtomicDriver(db))
 try{
  await repository.run(p,async tx=>{for(let i=0;i<205;i++){const job=createAgentJob({request:{...request,id:'task-'+i},kind:'report-draft',now:new Date('2026-01-01T00:00:00Z')});job.jobId='job-'+String(i).padStart(3,'0');if(i<204)job.status='succeeded';await tx.put('agent-job/'+job.jobId,job,0)}})
  const store=createAtomicAgentJobStore({repository,principal:p}),jobs=await store.claim(new Date('2026-10-01T00:00:00Z'),1,{userId:'bot'})
  expect(jobs).toHaveLength(1);expect(jobs[0].jobId).toBe('job-204')
  await expect(repository.run(p,tx=>cancelAgentJob(tx,p,'job-204'))).rejects.toThrow('unstarted')
  const queued=createAgentJob({request:{...request,id:'cancel'},kind:'report-draft'})
  await repository.run(p,tx=>enqueueAgentJob(tx,queued))
  await expect(repository.run(p,tx=>cancelAgentJob(tx,{...p,userId:'other'},queued.jobId))).rejects.toThrow('unavailable')
  expect((await repository.run(p,tx=>cancelAgentJob(tx,p,queued.jobId))).status).toBe('cancelled')
  await store.markCompleted(jobs[0].jobId,jobs[0].leaseToken!,{taskId:jobs[0].request.id,status:'COMPLETED',output:'done',durationMs:1},new Date())
  expect(await store.claim(new Date('2030-01-01'),10)).toHaveLength(0)
 }finally{db.close()}
})


test('domain result and succeeded job commit together, and late current admission rolls both back',async()=>{
 const db=new Database(':memory:');db.exec('CREATE TABLE jobs(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))')
 const p={tenantId:'tenant-a',userId:'bot',roles:['worker']},repository=createAtomicRepository('jobs',createSqliteAtomicDriver(db));let checks=0,deny=Infinity
 try{const job=createAgentJob({request:{...request,id:'atomic-result'},kind:'report-draft'});await repository.run(p,tx=>enqueueAgentJob(tx,job));const store=createAtomicAgentJobStore({repository,principal:p,verifyCurrent:async()=>{if(++checks===deny)throw Error('Current host revoked')},onCompleted:async(tx,current,result)=>{expect(current.leaseToken).toBeTruthy();await tx.put('domain-result/'+current.request.id,{tenantId:p.tenantId,result:result.output},0)}}),claimed=(await store.claim(new Date('2030-01-01'),1))[0];checks=0;deny=2;await expect(store.markCompleted(job.jobId,claimed.leaseToken!,{taskId:request.id,status:'COMPLETED',output:'actual result',durationMs:1},new Date())).rejects.toThrow('revoked');expect(await repository.run(p,tx=>tx.get('domain-result/atomic-result'))).toBeNull();expect((await repository.run(p,tx=>tx.get<any>('agent-job/'+job.jobId)))!.value.status).toBe('running');deny=Infinity;await store.markCompleted(job.jobId,claimed.leaseToken!,{taskId:request.id,status:'COMPLETED',output:'actual result',durationMs:1},new Date());expect((await repository.run(p,tx=>tx.get<any>('domain-result/atomic-result')))!.value.result).toBe('actual result');expect((await repository.run(p,tx=>tx.get<any>('agent-job/'+job.jobId)))!.value.status).toBe('succeeded')
 }finally{db.close()}
})
