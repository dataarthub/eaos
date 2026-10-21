import { randomUUID } from 'node:crypto'
import { OutboxDispatcher, createOutboxEvent, type OutboxDispatcherOptions, type OutboxEvent, type OutboxEventInput, type OutboxStore, type WorkflowEventEnvelope, type WorkflowEventSink } from '@alneas/eaos-core'
import { PluginError, type PluginPrincipal } from './index'
import type { AtomicRepository, AtomicSession } from './atomic'

const outboxKey = (id: string) => `outbox/${id}`

/**
 * Insert or replay one immutable Outbox event inside the same transaction as its domain write.
 * @param tx - Live tenant-scoped atomic session.
 * @param input - Canonical event input with stable tenant, topic and idempotency identity.
 * @typeParam T - JSON-serializable event payload type.
 * @returns A cloned new event or the matching existing event.
 * @throws Rejects invalid event input, conflicting idempotency input or transaction failures.
 * @remarks Does not deliver externally; the host scheduler and idempotent handler process the committed event later.
 * @example
 * import { enqueueOutboxEvent } from '@alneas/eaos-server/plugin-data'
 * export function enqueue<T>(tx: Parameters<typeof enqueueOutboxEvent>[0], input: Parameters<typeof enqueueOutboxEvent<T>>[1]) { return enqueueOutboxEvent(tx, input) }
 */
export async function enqueueOutboxEvent<T>(tx: AtomicSession, input: OutboxEventInput<T>): Promise<OutboxEvent<T>> {
  const event = createOutboxEvent(input)
  const key = outboxKey(event.id)
  const existing = await tx.get<OutboxEvent<T>>(key)
  if (existing) {
    if (existing.value.payloadHash !== event.payloadHash || existing.value.topic !== event.topic || existing.value.idempotencyKey !== event.idempotencyKey) throw new PluginError(409, 'Outbox idempotency key reused with different input')
    return structuredClone(existing.value)
  }
  await tx.put(key, event, 0)
  return structuredClone(event)
}

/**
 * Bind workflow event append operations to the caller's current atomic transaction.
 * @param tx - Live session containing the same domain CAS operation.
 * @param topicPrefix - Trusted nonempty topic prefix; defaults to workflow and admits letters/digits/underscore/dot/colon/slash/hyphen.
 * @returns A WorkflowEventSink that enqueues copied envelopes in the existing Outbox.
 * @throws Invalid session/prefix throws at construction; appended event validation/idempotency/store failures reject.
 * @remarks The sink owns no commit boundary and performs no external transport; use it only while the parent transaction is active.
 * @example
 * import { createAtomicWorkflowEventSink, type AtomicRepository, type PluginPrincipal } from '@alneas/eaos-server/plugin-data'
 * import type { WorkflowEventEnvelope } from '@alneas/eaos-core'
 * export function appendWorkflow<T>(repository: AtomicRepository, principal: PluginPrincipal, event: WorkflowEventEnvelope<T>) {
 *  return repository.run(principal, session => createAtomicWorkflowEventSink(session).append(event))
 * }
 */
export function createAtomicWorkflowEventSink(tx: AtomicSession, topicPrefix = 'workflow'): WorkflowEventSink {
  if (!tx || typeof tx.put !== 'function') throw new Error('Atomic transaction is required')
  if (!/^[A-Za-z0-9_.:/-]+$/.test(topicPrefix)) throw new Error('Invalid workflow event topic prefix')
  return {
    async append<TPayload>(event: WorkflowEventEnvelope<TPayload>) {
      await enqueueOutboxEvent(tx, {
        tenantId: event.tenantId,
        producer: event.producer,
        topic: `${topicPrefix}.${event.type}`,
        idempotencyKey: event.idempotencyKey,
        payload: structuredClone(event),
        id: event.eventId,
        occurredAt: event.occurredAt,
      })
    },
  }
}

/**
 * Principal, repository and stale-claim settings for durable Outbox transitions.
 * 
 * @see createAtomicOutboxStore for canonical host integration.
 */
export interface AtomicOutboxStoreOptions {
  /**
   * Real atomic repository for durable tenant-scoped Outbox transitions.
   */
  repository: AtomicRepository
  /**
   * Verified fixed tenant/user scope copied at construction; replace the store when identity changes.
   */
  principal: PluginPrincipal
  /**
   * Claim staleness threshold in milliseconds; defaults to 300000 and must be finite and at least 1000.
   */
  staleAfterMs?: number
  /**
   * Optional dispatcher clock; createAtomicOutboxDispatcher forwards it, while standalone store.claim uses its explicit now parameter.
   
   * @returns The trusted current Date when used by createAtomicOutboxDispatcher; standalone store.claim receives an explicit Date.
   * @throws Callback failures propagate to the owning operation; transactional writes roll back when the host boundary rejects.
   */
  now?: () => Date
}

/**
 * Bind durable Outbox claim/result transitions to one verified principal and atomic repository.
 * @param options - Repository/principal plus optional staleAfterMs (default 300000, minimum 1000) and clock.
 * @returns An OutboxStore using CAS claim tokens for publication/failure transitions.
 * @throws Invalid stale timeout throws; claims reject batch sizes outside 1–100, scope mismatches, nonadvancing pages or scan capacity above 30000; result writes reject changed claim tokens.
 * @remarks Stale claims can be reclaimed, so external handlers must tolerate duplicate delivery. No global scheduler or external exactly-once guarantee is provided.
 * @example
 * import { createAtomicOutboxStore } from '@alneas/eaos-server/plugin-data'
 * export function store(options: Parameters<typeof createAtomicOutboxStore>[0]) { return createAtomicOutboxStore(options) }
 */
export function createAtomicOutboxStore(options: AtomicOutboxStoreOptions): OutboxStore {
  const p = structuredClone(options.principal)
  const staleAfterMs = options.staleAfterMs ?? 5 * 60_000
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 1_000) throw new Error('Invalid outbox stale timeout')
  return {
    async claim(now, limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid outbox batch size')
      return options.repository.run(p, async tx => {
        const claimed: OutboxEvent[] = []
        let after='',scanned=0
        for (;;) {
         const rows=await tx.list<OutboxEvent>('outbox/',after,100)
         for (const row of rows) {
          if (claimed.length >= limit) break
          if(++scanned>30000)throw new PluginError(409,'Outbox scan at capacity')
          if(row.value.tenantId!==p.tenantId||row.id!==outboxKey(row.value.id))throw new PluginError(409,'Outbox scope differs')
          const due = row.value.status === 'pending' && Date.parse(row.value.availableAt) <= now.getTime()
          const stale = row.value.status === 'processing' && Date.parse(row.value.claimedAt ?? '') <= now.getTime() - staleAfterMs
          if (!due && !stale) continue
          const next = { ...row.value, status: 'processing' as const, attempts: row.value.attempts + 1, claimedAt: now.toISOString(), claimToken: randomUUID(), lastError: undefined }
          claimed.push((await tx.put(row.id, next, row.revision)).value)
         }
         if(claimed.length>=limit||rows.length<100)break
         const next=rows.at(-1)!.id;if(next<=after)throw new PluginError(409,'Outbox page did not advance');after=next
        }
        return claimed
      })
    },
    async markPublished(id, claimToken, publishedAt) {
      await options.repository.run(p, async tx => {
        const row = await tx.get<OutboxEvent>(outboxKey(id))
        if (!row || row.value.status !== 'processing' || row.value.claimToken !== claimToken) throw new PluginError(409, 'Outbox claim changed')
        await tx.put(row.id, { ...row.value, status: 'published' as const, publishedAt: publishedAt.toISOString(), claimedAt: undefined, claimToken: undefined }, row.revision)
      })
    },
    async markFailed(id, claimToken, error, retryAt) {
      await options.repository.run(p, async tx => {
        const row = await tx.get<OutboxEvent>(outboxKey(id))
        if (!row || row.value.status !== 'processing' || row.value.claimToken !== claimToken) throw new PluginError(409, 'Outbox claim changed')
        await tx.put(row.id, { ...row.value, status: retryAt ? 'pending' as const : 'failed' as const, availableAt: retryAt?.toISOString() ?? row.value.availableAt, claimedAt: undefined, claimToken: undefined, lastError: error }, row.revision)
      })
    },
  }
}

/**
 * Existing dispatcher options combined with the canonical atomic tenant Outbox store.
 * 
 * @see createAtomicOutboxDispatcher for canonical host integration.
 */
export interface AtomicOutboxDispatcherOptions extends Omit<OutboxDispatcherOptions, 'store'>, AtomicOutboxStoreOptions {}

/**
 * Compose the existing OutboxDispatcher with the tenant-scoped atomic Outbox store.
 * @param options - Dispatcher handlers/time/retry settings plus the atomic repository and principal.
 * @returns An OutboxDispatcher instance; construction alone does not start a worker loop.
 * @throws Invalid store/dispatcher configuration throws; later dispatch rejects according to its host handlers and store.
 * @remarks Host scheduling and handler idempotency remain explicit; no parallel transport or global singleton is introduced.
 * @example
 * import { createAtomicOutboxDispatcher } from '@alneas/eaos-server/plugin-data'
 * export function dispatcher(options: Parameters<typeof createAtomicOutboxDispatcher>[0]) { return createAtomicOutboxDispatcher(options) }
 */
export function createAtomicOutboxDispatcher(options: AtomicOutboxDispatcherOptions): OutboxDispatcher {
  const { repository, principal, staleAfterMs, now, ...dispatcher } = options
  return new OutboxDispatcher({ ...dispatcher, now, store: createAtomicOutboxStore({ repository, principal, staleAfterMs, now }) })
}

/**
 * Reset one failed tenant event to pending while retaining its immutable identity.
 * @param tx - Live session entered after explicit host recovery authorization.
 * @param tenantId - Verified tenant identity required to match the stored event.
 * @param id - Existing failed event ID, nonempty and at most 256 characters.
 * @param availableAt - Parseable retry timestamp; defaults to the current ISO time.
 * @returns The requeued event with claim/error fields cleared.
 * @throws Rejects invalid identifiers/timestamps, missing/nonfailed/foreign events or CAS failures.
 * @remarks Does not perform delivery or authorize recovery. A prior uncertain external effect may already exist; handlers must deduplicate by the retained identity.
 * @example
 * import { requeueOutboxEvent } from '@alneas/eaos-server/plugin-data'
 * export function requeue(tx: Parameters<typeof requeueOutboxEvent>[0], tenantId: string, id: string) { return requeueOutboxEvent(tx, tenantId, id) }
 */
export async function requeueOutboxEvent(tx:AtomicSession,tenantId:string,id:string,availableAt=new Date().toISOString()):Promise<OutboxEvent>{
 if(!id||id.length>256||!Number.isFinite(Date.parse(availableAt)))throw new PluginError(400,'Invalid outbox recovery')
 const row=await tx.get<OutboxEvent>(outboxKey(id));if(!row||row.value.tenantId!==tenantId||row.value.id!==id||row.value.status!=='failed')throw new PluginError(409,'Failed outbox event unavailable')
 const next={...row.value,status:'pending' as const,availableAt,claimedAt:undefined,claimToken:undefined,lastError:undefined}
 await tx.put(row.id,next,row.revision);return next
}
