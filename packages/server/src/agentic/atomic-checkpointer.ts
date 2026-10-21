import { BaseCheckpointSaver, type Checkpoint, type CheckpointMetadata, type CheckpointTuple } from '@langchain/langgraph'
import { atomicHash, type AtomicRepository, type AtomicSession } from '../plugin-data/atomic'
import { assertPrincipal, type PluginPrincipal } from '../plugin-data/index'

type Config = Parameters<BaseCheckpointSaver['getTuple']>[0]
type ListOptions = Parameters<BaseCheckpointSaver['list']>[1]
type Writes = Parameters<BaseCheckpointSaver['putWrites']>[1]
type Encoded = [string, string]
interface StoredCheckpoint {
  tenantId: string; threadId: string; namespace: string; checkpointId: string
  checkpoint: Encoded; metadata: Encoded; parentId?: string
  writes: Array<{ taskId: string; index: number; channel: string; value: Encoded }>
}
const specialWrites: Record<string, number> = { __error__: -1, __scheduled__: -2, __interrupt__: -3, __resume__: -4 }
function identifier(value: unknown, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value) || value.length > 512 || [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw Error('Invalid checkpoint identifier')
  return value
}

/**
 * Stores LangGraph checkpoints and pending writes in an existing scoped atomic repository.
 * @remarks Admission and workflow writer serialization remain host-owned. Each saver instance serializes repository work through an internal Promise chain and calls verifyCurrent before the transaction and before/after its work. This does not serialize other saver instances or whole graph invocations. The repository owns durability/CAS; this saver installs no timers and does not close host storage. Checkpoint erasure requires a separate host retention executor.
 * @example
 * ```typescript
 * import { AtomicCheckpointSaver } from "@alneas/eaos-server/agentic/atomic-checkpointer";
 * export function saver(options: ConstructorParameters<typeof AtomicCheckpointSaver>[0]) {
 *   return new AtomicCheckpointSaver(options);
 * }
 * ```
 */
export class AtomicCheckpointSaver extends BaseCheckpointSaver {
  private readonly principal: PluginPrincipal
  private pending: Promise<void> = Promise.resolve()
  /**
   * Captures a verified plugin principal and required current-admission callback.
   * @param options - Scoped repository; principal is validated/cloned; verifyCurrent must reject on revoked admission; prefix defaults to graph-checkpoint and must contain 1–64 lowercase letters/digits/underscore/hyphen.
   * @throws Invalid principal, absent repository/verifier, invalid prefix, or clone failure.
   */
  constructor(private readonly options: { 
  /**
   * Connected host atomic repository used for scoped checkpoint and pending-write transactions; this saver does not close it.
   */
  repository: AtomicRepository; 
  /**
   * Verified plugin principal validated and cloned at construction; fixes the tenant/plugin/user scope used for repository transactions.
   */
  principal: PluginPrincipal; 
  /**
   * Recheck current host admission before repository work and at transaction boundaries.
   * @returns No value; resolve only while the captured principal remains admitted and reject when admission is revoked.
   * @remarks Required callback; called before the repository transaction and before/after its work, and before each history yield. The host owns the live policy lookup.
   * @see {@link AtomicCheckpointSaver}
   */
  verifyCurrent: () => Promise<void>; 
  /**
   * Optional repository key prefix; defaults to graph-checkpoint and must contain 1–64 lowercase letters, digits, underscores or hyphens.
   */
  prefix?: string }) {
    super(); assertPrincipal(options.principal); this.principal = structuredClone(options.principal)
    if (!options.repository || typeof options.verifyCurrent !== 'function' || !/^[a-z0-9_-]{1,64}$/.test(options.prefix ?? 'graph-checkpoint')) throw Error('Scoped checkpoint repository and current verifier required')
  }
  private scope(config: Config) {
    const threadId = identifier(config.configurable?.thread_id), namespace = identifier(config.configurable?.checkpoint_ns ?? '', true)
    const checkpointId = config.configurable?.checkpoint_id === undefined ? undefined : identifier(config.configurable.checkpoint_id)
    const prefix = `${this.options.prefix ?? 'graph-checkpoint'}/${atomicHash([threadId, namespace])}/`
    return { threadId, namespace, checkpointId, prefix }
  }
  private config(s: ReturnType<AtomicCheckpointSaver['scope']>, id: string): Config { return { configurable: { thread_id: s.threadId, checkpoint_ns: s.namespace, checkpoint_id: id } } }
  private async encode(value: unknown): Promise<Encoded> { const [kind, bytes] = await this.serde.dumpsTyped(value); return [kind, Buffer.from(bytes).toString('base64')] }
  private async decode(value: Encoded) { return this.serde.loadsTyped(value[0], Buffer.from(value[1], 'base64')) }
  private async run<T>(work: (tx: AtomicSession) => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      await this.options.verifyCurrent()
      return this.options.repository.run(this.principal, async tx => { await this.options.verifyCurrent(); const result = await work(tx); await this.options.verifyCurrent(); return result })
    })
    this.pending = result.then(() => undefined, () => undefined)
    return result
  }
  private async tuple(v: StoredCheckpoint, s: ReturnType<AtomicCheckpointSaver['scope']>): Promise<CheckpointTuple> {
    if (v.tenantId !== this.principal.tenantId || v.threadId !== s.threadId || v.namespace !== s.namespace) throw Error('Checkpoint identity differs')
    const checkpoint = await this.decode(v.checkpoint) as Checkpoint
    if (checkpoint.id !== v.checkpointId || checkpoint.v !== 4) throw Error('Checkpoint format or identity differs')
    return { config: this.config(s, v.checkpointId), checkpoint, metadata: await this.decode(v.metadata) as CheckpointMetadata,
      ...(v.parentId ? { parentConfig: this.config(s, v.parentId) } : {}),
      pendingWrites: await Promise.all(v.writes.map(async w => [w.taskId, w.channel, await this.decode(w.value)] as [string, string, unknown])) }
  }
  /**
   * Reads one scoped checkpoint and its separately stored pending writes.
   * @param config - LangGraph config with required thread_id, optional checkpoint_ns (default empty), and optional checkpoint_id (default latest lexicographic ID). Identifiers are bounded to 512 characters without control characters.
   * @returns Decoded checkpoint tuple or undefined if no selected checkpoint exists.
   * @throws Rejects invalid identifiers, tenant/thread/namespace or format mismatch, and admission/repository/serialization failures.
   * @example
   * ```typescript
   * import { AtomicCheckpointSaver } from "@alneas/eaos-server/agentic/atomic-checkpointer";
   * export async function read(saver: AtomicCheckpointSaver, config: Parameters<AtomicCheckpointSaver["getTuple"]>[0]) { return saver.getTuple(config); }
   * ```
   */
  async getTuple(config: Config): Promise<CheckpointTuple | undefined> {
    const s = this.scope(config)
    return this.run(async tx => {
      const id = s.checkpointId ?? (await tx.get<{ id: string }>(s.prefix + 'latest'))?.value.id
      if (!id) return undefined
      const row = await tx.get<StoredCheckpoint>(s.prefix + 'item-' + id)
      if (!row) return undefined
      const writes = await tx.get<Pick<StoredCheckpoint, 'tenantId' | 'threadId' | 'namespace' | 'checkpointId' | 'writes'>>(s.prefix + 'writes-' + id)
      if (writes && (writes.value.tenantId !== this.principal.tenantId || writes.value.threadId !== s.threadId || writes.value.namespace !== s.namespace || writes.value.checkpointId !== id)) throw Error('Pending write identity differs')
      return this.tuple({ ...row.value, writes: writes?.value.writes ?? [] }, s)
    })
  }
  /**
   * Lists scoped checkpoint history in descending lexicographic checkpoint-ID order.
   * @param config - Required thread scope, optional namespace, and optional exact checkpoint ID filter.
   * @param options - limit defaults to 100 and must be a safe integer 1–2000; before must use the same thread/namespace and excludes its ID and newer IDs; filter compares metadata fields by atomic hash.
   * @returns Async sequence of decoded tuples, possibly empty, with admission rechecked before each yield.
   * @throws Iteration rejects invalid scope/limits, more than 2000 scanned checkpoint rows, identity/format mismatch, or admission/repository/serialization errors.
   * @remarks History is collected in a bounded repository transaction before yielding; changing authorization can still stop later yields.
   * @example
   * ```typescript
   * import { AtomicCheckpointSaver } from "@alneas/eaos-server/agentic/atomic-checkpointer";
   * export async function history(saver: AtomicCheckpointSaver, config: Parameters<AtomicCheckpointSaver["list"]>[0]) {
   *   const tuples = [];
   *   for await (const tuple of saver.list(config, { limit: 10 })) tuples.push(tuple);
   *   return tuples;
   * }
   * ```
   */
  async *list(config: Config, options: ListOptions = {}): AsyncGenerator<CheckpointTuple> {
    const s = this.scope(config), limit = options?.limit ?? 100, before = options?.before ? this.scope(options.before) : undefined
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000 || before && (before.threadId !== s.threadId || before.namespace !== s.namespace)) throw Error('Invalid scoped checkpoint history request')
    const values = await this.run(async tx => {
      const rows: StoredCheckpoint[] = []; let after = ''
      while (true) { const page = await tx.list<StoredCheckpoint>(s.prefix + 'item-', after, 100); rows.push(...page.map(r => r.value)); if (rows.length > 2000) throw Error('Checkpoint history exceeds bounded capacity'); if (page.length < 100) break; after = page.at(-1)!.id }
      const out: CheckpointTuple[] = []
      for (const value of rows.sort((a, b) => b.checkpointId.localeCompare(a.checkpointId))) {
        if (s.checkpointId && value.checkpointId !== s.checkpointId || before?.checkpointId && value.checkpointId >= before.checkpointId) continue
        const writes = await tx.get<Pick<StoredCheckpoint, 'tenantId' | 'threadId' | 'namespace' | 'checkpointId' | 'writes'>>(s.prefix + 'writes-' + value.checkpointId)
        if (writes && (writes.value.tenantId !== this.principal.tenantId || writes.value.threadId !== s.threadId || writes.value.namespace !== s.namespace || writes.value.checkpointId !== value.checkpointId)) throw Error('Pending write identity differs')
        const tuple = await this.tuple({ ...value, writes: writes?.value.writes ?? [] }, s)
        if (options?.filter && Object.entries(options.filter).some(([k, v]) => atomicHash((tuple.metadata as any)?.[k] ?? null) !== atomicHash(v ?? null))) continue
        out.push(tuple); if (out.length === limit) break
      }
      return out
    })
    for (const value of values) { await this.options.verifyCurrent(); yield value }
  }
  /**
   * Writes an immutable version-4 checkpoint and advances the scoped latest pointer when its ID sorts later.
   * @param config - Thread/namespace scope; optional checkpoint_id becomes the new checkpoint's parent ID.
   * @param checkpoint - Current LangGraph version-4 checkpoint with valid nonempty bounded ID.
   * @param metadata - Serializer-supported checkpoint metadata.
   * @returns A config selecting the stored checkpoint ID.
   * @throws Rejects unsupported format, ID reuse with different content, admission/CAS/repository errors, or serialization failures.
   * @remarks Repeating identical content is accepted; latest ordering is lexicographic, so host checkpoint IDs must reflect desired chronology.
   * @example
   * ```typescript
   * import { AtomicCheckpointSaver } from "@alneas/eaos-server/agentic/atomic-checkpointer";
   * export async function write(saver: AtomicCheckpointSaver, ...args: Parameters<AtomicCheckpointSaver["put"]>) { return saver.put(...args); }
   * ```
   */
  async put(config: Config, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<Config> {
    const s = this.scope(config), id = identifier(checkpoint.id)
    if (checkpoint.v !== 4) throw Error('Only the current LangGraph checkpoint format is supported')
    const checkpointBytes = await this.encode(checkpoint), metadataBytes = await this.encode(metadata)
    await this.run(async tx => {
      const key = s.prefix + 'item-' + id, existing = await tx.get<StoredCheckpoint>(key)
      const value: StoredCheckpoint = { tenantId: this.principal.tenantId, threadId: s.threadId, namespace: s.namespace, checkpointId: id, checkpoint: checkpointBytes, metadata: metadataBytes, ...(s.checkpointId ? { parentId: s.checkpointId } : {}), writes: existing?.value.writes ?? [] }
      if (existing && atomicHash({ ...existing.value, writes: [] }) !== atomicHash({ ...value, writes: [] })) throw Error('Checkpoint ID reused with different content')
      if (!existing) await tx.put(key, value, 0)
      const latest = await tx.get<{ id: string }>(s.prefix + 'latest')
      if (!latest || id > latest.value.id) await tx.put(s.prefix + 'latest', { id }, latest?.revision ?? 0)
    })
    return this.config(s, id)
  }
  /**
   * Merges pending channel writes by task/index for one scoped checkpoint.
   * @param config - Thread/namespace with required checkpoint_id.
   * @param writes - At most 256 channel/value pairs; channels are valid bounded identifiers. Ordinary task/index duplicates retain their first value; reserved negative-index channels replace prior values.
   * @param taskId - Nonempty bounded task identifier associating writes.
   * @returns No value; resolves after the merged writes are durably stored.
   * @throws Rejects missing checkpoint ID, invalid task/channel, identity mismatch, more than 2000 stored pending writes, or admission/repository/serialization errors.
   * @example
   * ```typescript
   * import { AtomicCheckpointSaver } from "@alneas/eaos-server/agentic/atomic-checkpointer";
   * export async function writePending(saver: AtomicCheckpointSaver, ...args: Parameters<AtomicCheckpointSaver["putWrites"]>) { await saver.putWrites(...args); }
   * ```
   */
  async putWrites(config: Config, writes: Writes, taskId: string): Promise<void> {
    const s = this.scope(config); identifier(taskId)
    if (!s.checkpointId || !Array.isArray(writes) || writes.length > 256) throw Error('Checkpoint and bounded writes required')
    const prepared = await Promise.all(writes.map(async ([channel, value], index) => ({ taskId, index: Object.hasOwn(specialWrites, channel) ? specialWrites[channel] : index, channel: identifier(channel), value: await this.encode(value) })))
    await this.run(async tx => {
      const key = s.prefix + 'writes-' + s.checkpointId, row = await tx.get<Pick<StoredCheckpoint, 'tenantId' | 'threadId' | 'namespace' | 'checkpointId' | 'writes'>>(key)
      if (row && (row.value.tenantId !== this.principal.tenantId || row.value.threadId !== s.threadId || row.value.namespace !== s.namespace || row.value.checkpointId !== s.checkpointId)) throw Error('Pending write identity differs')
      const value = row ? structuredClone(row.value) : { tenantId: this.principal.tenantId, threadId: s.threadId, namespace: s.namespace, checkpointId: s.checkpointId, writes: [] as StoredCheckpoint['writes'] }
      for (const write of prepared) {
        const index = value.writes.findIndex(w => w.taskId === taskId && w.index === write.index)
        if (index < 0) value.writes.push(write)
        else if (write.index < 0) value.writes[index] = write
      }
      if (value.writes.length > 2000) throw Error('Checkpoint pending writes exceed bounded capacity')
      await tx.put(key, value, row?.revision ?? 0)
    })
  }
  /**
   * Rejects thread deletion because this repository contract provides no approved erasure operation.
   * @param _threadId - Requested thread ID; not read or deleted.
   * @returns No value; this operation always rejects before performing storage work.
   * @throws Always rejects with an error directing the caller to the host retention executor.
   * @example
   * ```typescript
   * import { AtomicCheckpointSaver } from "@alneas/eaos-server/agentic/atomic-checkpointer";
   * export async function erase(saver: AtomicCheckpointSaver, threadId: string) {
   *   try { await saver.deleteThread(threadId); } catch (error) {
   *     // Host retention tooling must perform reviewed erasure.
   *     throw error;
   *   }
   * }
   * ```
   */
  async deleteThread(_threadId: string): Promise<void> { throw Error('Checkpoint erasure requires the host retention executor; this repository exposes no delete contract') }
}
