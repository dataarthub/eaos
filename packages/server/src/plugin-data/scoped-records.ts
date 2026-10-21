import {appendAtomicAudit} from './audit'
import Ajv from 'ajv'
import { assertPrincipal, exactKeys, PluginError, parseRecordCursor, recordCursor, revisionInput, textInput, type PluginPrincipal, type PluginRecordStore } from './index'
import { createAtomicRecordStore, atomicHash, atomicCommand, type AtomicSession, type AtomicRepository } from './atomic'

/**
 * Host record storage and live resource authorization, optionally joined to a shared atomic repository.
 * @typeParam T - Tenant-owned stored record payload.
 * 
 * @see ScopedRecordService for canonical host integration.
 */
export interface ScopedRecordHost<T> {
  /**
   * Host record store with real tenant scoping and revision-predicated writes.
   */
  store: PluginRecordStore<T>
  /**
   * Checks current plugin activation and resource permission before exposing or persisting records.
   * @param principal - Verified current principal.
   * @param operation - Declared operation name.
   * @param input - Operation input, list criteria or created payload appropriate to the check.
   * @param current - Optional copied current record; absence requires operation-level admission.
   * @returns Exactly true to admit the operation/record; false denies or filters the record during lists.
   * @throws Rejects propagated host persistence, validation or callback failures.
   
   * @example
   * ```typescript
   * import type { ScopedRecordHost, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function admitted(host: ScopedRecordHost<{ title: string }>, principal: PluginPrincipal, operation: string, input: unknown, current?: unknown) {
   *   return await host.authorize(principal, operation, input, current) === true;
   * }
   * ```
   */
  authorize(principal: PluginPrincipal, operation: string, input: unknown, current?: unknown): Promise<boolean>
  /**
   * Optional trusted operation clock; defaults to new Date().
   
   * @returns A valid Date used for the current CRUD/domain operation timestamp.
   * @throws Callback failures propagate to the owning operation; transactional writes roll back when the host boundary rejects.
   */
  now?: () => Date
  /**
   * Optional existing atomic repository joining ordinary CRUD, workflow commands, reservations and audit in one commit boundary.
   * 
   * Ordinary CRUD and workflow commands share the provided transaction boundary.
   */
  repository?: AtomicRepository
}

/**
 * Plugin-owned schemas, CRUD reducers, filtering and transactional identity/composition rules.
 * @typeParam T - Stored record payload with stable tenantId/id.
 * @typeParam S - Decoded record view extending T with a positive CAS revision.
 * 
 * @see ScopedRecordService for canonical host integration.
 */
export interface ScopedRecordDefinition<T extends { tenantId: string; id: string }, S extends T & { revision: number }> {
  /**
   * Explicit per-operation JSON Schemas compiled with coercion disabled.
   */
  schemas: Record<string, object>
  /**
   * Exact list/get/create/update/archive operation names used for shared dispatch.
   */
  operations: { 
    /**
     * Host operation name for bounded or keyset-paged authorized record listing.
     */
    list: string; 
    /**
     * Host operation name for reading one authorized record.
     */
    get: string; 
    /**
     * Host operation name for creating one tenant record.
     */
    create: string; 
    /**
     * Host operation name for revision-predicated record patching.
     */
    update: string; 
    /**
     * Host operation name for the plugin-owned retained-data archive transition.
     */
    archive: string }
  /**
   * Response property under which admitted records are returned.
   */
  listKey: string
  /**
   * Trusted domain label used in validation/conflict errors.
   */
  label: string
  /**
   * Enable filtered keyset scanning when the host store supplies listPage; otherwise a supplied cursor is rejected.
   * 
   * Enable complete filtered paging when the store supplies listPage.
   */
  pagination?: boolean
  /**
   * Additional auxiliary record prefixes omitted from business CRUD results.
   * 
   * Plugin-owned auxiliary keys must not appear as business records.
   */
  excludedIdPrefixes?: readonly string[]
  /**
   * Optional composite identity reservation rules; require a shared transaction for concurrent enforcement.
   * 
   * Transactional reservations enforce composite business identities across concurrent writers.
   */
  unique?: readonly { 
    /**
     * Trusted uniqueness constraint label matching lowercase letter followed by up to 60 lowercase letters/digits/underscore/hyphen characters.
     */
    name: string; 
    /**
     * Nonempty ordered stored field keys; every active value must be a nonblank string.
     */
    fields: readonly (keyof T & string)[];
    /** Trusted domain predicate; false releases this record's reservation. 
     * @param record - Cloned current record; this predicate must be pure.
     * @returns True to reserve the composite identity, false to release it; nonboolean results reject.
     * @throws Callback failures propagate to the owning operation; transactional writes roll back when the host boundary rejects.
     */ when?: (record:T)=>boolean }[]
  /**
   * Fields searched by the generic case-insensitive query filter.
   */
  searchableFields?: readonly (keyof S & string)[]
  /**
   * Optional synchronous domain filter applied in addition to standard criteria and live record authorization.
   
   * @param input - Schema-admitted list criteria.
   * @param value - Decoded scoped record being considered.
   * @returns True to retain this candidate before the additional search/live-record permission checks.
   * @throws Callback failures propagate to the owning operation; transactional writes roll back when the host boundary rejects.
   */
  filter?: (input: Record<string, any>, value: S) => boolean
  /**
   * Creates a new tenant-owned domain payload from admitted inputs.
   * @param input - Schema-validated create input.
   * @param principal - Verified current tenant principal.
   * @param at - Trusted UTC ISO operation timestamp.
   * @returns The new payload with stable id and matching tenantId; no persistence is performed by this reducer.
   * @throws Reducer errors propagate; do not perform irreversible external effects.
   
   * @example
   * ```typescript
   * import type { ScopedRecordDefinition, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * type Stored = { tenantId: string; id: string; archived: boolean };
   * type View = Stored & { revision: number };
   * export function reduceCreate(definition: ScopedRecordDefinition<Stored, View>, principal: PluginPrincipal, admittedInput: Record<string, unknown>) {
   *   return definition.create(admittedInput, principal, new Date().toISOString());
   * }
   * ```
   */
  create(input: Record<string, any>, principal: PluginPrincipal, at: string): T
  /**
   * Mutates only the private record snapshot with the admitted patch.
   * @param value - Mutable current decoded revisioned record; preserve tenantId/id.
   * @param patch - Schema-admitted patch fields.
   * @param at - Trusted UTC ISO operation timestamp.
   * @returns Completes without a value; the owning service performs CAS persistence.
   * @throws Reducer errors propagate and roll back joined transactional work.
   
   * @example
   * ```typescript
   * import type { ScopedRecordDefinition } from '@alneas/eaos-server/plugin-data';
   * type Stored = { tenantId: string; id: string; archived: boolean };
   * type View = Stored & { revision: number };
   * export function reduceUpdate(definition: ScopedRecordDefinition<Stored, View>, snapshot: View, admittedPatch: Record<string, unknown>) {
   *   const next = structuredClone(snapshot);
   *   definition.update(next, admittedPatch, new Date().toISOString());
   *   return next; // The owning service still performs revision-checked persistence.
   * }
   * ```
   */
  update(value: S, patch: Record<string, unknown>, at: string): void
  /**
   * Mutates the private record snapshot to the plugin's archive state.
   * @param value - Mutable current record; preserve stable tenantId/id.
   * @param at - Trusted UTC ISO operation timestamp.
   * @param input - Optional schema-admitted archive command input.
   * @param principal - Optional verified current principal supplied by the service.
   * @returns Completes without a value; archive retains data according to the plugin reducer.
   * @throws Reducer errors propagate; do not perform irreversible external effects.
   
   * @example
   * ```typescript
   * import type { ScopedRecordDefinition, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * type Stored = { tenantId: string; id: string; archived: boolean };
   * type View = Stored & { revision: number };
   * export function reduceArchive(definition: ScopedRecordDefinition<Stored, View>, snapshot: View, principal: PluginPrincipal, admittedInput: Record<string, unknown>) {
   *   const next = structuredClone(snapshot);
   *   definition.archive(next, new Date().toISOString(), admittedInput, principal);
   *   return next; // No persistence is performed by this reducer call.
   * }
   * ```
   */
  archive(value: S, at: string, input?: Record<string, any>, principal?: PluginPrincipal): void
  /**
   * Additional plugin-owned mutation reducers persisted through the same CAS path; never perform irreversible external effects here.
   * 
   * Plugin-owned durable workflow commands. Each command is validated by its
   * declared schema, receives the current revision, and is persisted through
   * the same tenant-scoped CAS path as update/archive.
   
   * @param value - Private mutable revisioned record; preserve stable tenant/id.
   * @param input - Schema-admitted custom command input.
   * @param at - Trusted ISO operation timestamp.
   * @param principal - Verified current principal.
   * @returns Completes without a value after mutating the private snapshot; the owning service performs CAS persistence.
   * @throws Callback failures propagate to the owning operation; transactional writes roll back when the host boundary rejects.
   */
  custom?: Record<string, (value: S, input: Record<string, any>, at: string, principal: PluginPrincipal) => void>
  /**
   * Optional async owning-domain composition inside the shared transaction before final authorization; not an external side-effect hook.
   * 
   * Owning domain composition inside the existing transaction, before final live authorization. Never use for external effects.
   
   * @param principal - Verified current principal.
   * @param operation - Declared mutation operation.
   * @param input - Schema-admitted command input.
   * @param current - Cloned resulting decoded record; do not mutate service state through this copy.
   * @param previous - Optional prior decoded record, absent on create.
   * @returns Resolves without a value after owning-domain composition inside the same transaction; no external effects.
   * @throws Callback failures propagate to the owning operation; transactional writes roll back when the host boundary rejects.
   */
  afterWrite?: (principal: PluginPrincipal, operation: string, input: Record<string, any>, current: S, previous?: S) => Promise<void>
}

/**
 * Derive a stable atomic reservation key for a named composite business identity.
 * @param name - Trusted lowercase uniqueness label of at most 61 characters.
 * @param values - Nonempty tuple of nonblank string values in canonical field order.
 * @returns unique/ followed by a canonical content hash.
 * @throws Invalid declarations throw Error; nonstring/blank identity values throw PluginError 409.
 * @remarks Derivation alone reserves nothing; concurrent uniqueness requires CAS reservations in the enclosing atomic transaction.
 * @example
 * import { uniqueRecordKey } from '@alneas/eaos-server/plugin-data'
 * const key = uniqueRecordKey('external-id', ['example'])
 */
export function uniqueRecordKey(name:string,values:readonly unknown[]):string {
 if(!/^[a-z][a-z0-9_-]{0,60}$/.test(name)||!values.length)throw new Error('Invalid trusted uniqueness declaration')
 if(values.some(value=>typeof value!=='string'||!value.trim()))throw new PluginError(409,'Unique identity fields must be nonempty strings')
 return `unique/${atomicHash([name,values])}`
}

/**
 * Applies schema-validated record CRUD and workflow commands through tenant checks, live admission and optimistic revisions.
 * 
 * Shared tenant-scoped CRUD/CAS boundary for small plugin-owned master records.
 * @typeParam T - Stored tenant-owned record payload containing stable tenantId and id.
 * @typeParam S - Decoded public record view extending T with a positive CAS revision.
 * 
 * @remarks
 * Use a real atomic repository for unique identity reservations, owning-domain composition and command/audit receipts. Repository execution joins CRUD/domain writes and final authorization in one transaction; plain stores do not gain those guarantees. Domain reducers must not perform irreversible external effects. Auxiliary audit/command/event/unique keys are excluded from business results as configured.
 * 
 * @example
 * ```typescript
 * import { ScopedRecordService, type ScopedRecordHost, type ScopedRecordDefinition } from '@alneas/eaos-server/plugin-data';
 * type Row = { tenantId: string; id: string; title: string };
 * type RevisionedRow = Row & { revision: number };
 * export function connectRecords(host: ScopedRecordHost<Row>, definition: ScopedRecordDefinition<Row, RevisionedRow>) { return new ScopedRecordService(host, definition); }
 * ```
 */
export class ScopedRecordService<T extends { tenantId: string; id: string }, S extends T & { revision: number }> {
  private readonly validators: Map<string, (value: unknown) => boolean>
  /**
   * Compiles strict noncoercing command schemas for one trusted record definition.
   * @param host - Durable tenant-scoped store, live authorization, optional clock and shared atomic repository.
   * @param definition - Plugin-owned operation names, schemas, reducers, paging and identity rules.
   * @param atomicSession - Optional already active internal session used for joined composition/uniqueness; its lifetime must not exceed the enclosing repository callback.
   * @throws Throws when durable store or live authorization is missing, or strict schema compilation fails.
   * 
   * @example
   * ```typescript
   * import { ScopedRecordService, type ScopedRecordHost, type ScopedRecordDefinition } from '@alneas/eaos-server/plugin-data';
   * type Row = { tenantId: string; id: string; title: string };
   * type RevisionedRow = Row & { revision: number };
   * export function connectRecords(host: ScopedRecordHost<Row>, definition: ScopedRecordDefinition<Row, RevisionedRow>) { return new ScopedRecordService(host, definition); }
   * ```
   */
  constructor(private readonly host: ScopedRecordHost<T>, private readonly definition: ScopedRecordDefinition<T, S>, private readonly atomicSession?: AtomicSession) {
    if (!host?.store || typeof host.authorize !== 'function') throw new Error('Durable scoped record store and live authorization required')
    const ajv = new Ajv({ strict: true, coerceTypes: false })
    this.validators = new Map(Object.entries(definition.schemas).map(([name, schema]) => [name, ajv.compile(schema)]))
  }
  private async allow(principal: PluginPrincipal, operation: string, input: unknown, current?: S) {
    assertPrincipal(principal)
    if (await this.host.authorize(structuredClone(principal), operation, structuredClone(input), current && structuredClone(current)) !== true) throw new PluginError(403, `${this.definition.label} access denied`)
  }
  /**
   * Exposes the same live tenant/permission check to a plugin's read-only
   * domain previews. Preview operations do not persist records, but they must
   * still be authorized through the host before invoking domain logic.
   */
  protected async authorizeOperation(principal: PluginPrincipal, operation: string, input: unknown, current?: S) {
    await this.allow(principal, operation, input, current)
  }
  protected currentTime(): Date { return this.host.now?.() ?? new Date() }
  private excluded(id: string): boolean { return id.startsWith('audit/') || (!!this.definition.unique?.length && id.startsWith('unique/')) || (Object.values(this.definition.schemas).some(schema => (schema as any)?.properties?.commandId) && /^(?:command|event)\//.test(id)) || this.definition.excludedIdPrefixes?.some(prefix=>id.startsWith(prefix)) === true }
  private decode(principal: PluginPrincipal, record: { id: string; revision: number; value: T }): S {
    if (record.id !== record.value.id || record.value.tenantId !== principal.tenantId || !Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error(`Invalid scoped ${this.definition.label} record`)
    return { ...structuredClone(record.value), revision: record.revision } as S
  }
  private async load(principal: PluginPrincipal, id: string): Promise<S> {
    if (this.excluded(id)) throw new PluginError(404,`${this.definition.label} not found`)
    const record = await this.host.store.read(principal.tenantId, id)
    if (!record) throw new PluginError(404, `${this.definition.label} not found`)
    return this.decode(principal, record)
  }
  private matches(args: Record<string,any>, value: S): boolean {
    return (!this.definition.filter || this.definition.filter(args,value)) && (!args.search || this.definition.searchableFields?.some(key=>typeof value[key]==='string' && String(value[key]).toLocaleLowerCase().includes(args.search.toLocaleLowerCase()))) === true
  }
  /** Read all authorized records for plugin-owned reports; providers must support keyset paging. */
  protected async readAllAuthorized(principal: PluginPrincipal, operation: string, input: unknown, accept: (value: S)=>boolean): Promise<S[]> {
    if (this.host.repository) return this.host.repository.run(principal, tx => this.readAllFromStore(principal, operation, input, accept, createAtomicRecordStore(tx, principal)))
    return this.readAllFromStore(principal, operation, input, accept, this.host.store)
  }
  private async readAllFromStore(principal: PluginPrincipal, operation: string, input: unknown, accept: (value: S)=>boolean, store: PluginRecordStore<T>): Promise<S[]> {
    await this.allow(principal,operation,input)
    if (!store.listPage) throw new PluginError(409,'Paged record storage required for complete reports')
    const values:S[]=[];let after=''
    for (;;) { const rows=await store.listPage(principal.tenantId,100,after);for(const raw of rows){if(this.excluded(raw.id))continue;const value=this.decode(principal,raw);if(accept(value) && await this.host.authorize(structuredClone(principal),operation,structuredClone(input),structuredClone(value))===true)values.push(value)}if(rows.length<100)break;const next=rows.at(-1)!.id;if(next<=after)throw new Error('Record page did not advance');after=next }
    await this.allow(principal,operation,input);return values
  }
  private async reserveUnique(value: T, previous?: T) {
    if (!this.definition.unique?.length) return
    const tx = this.atomicSession
    if (!tx) throw new PluginError(409, 'Transactional storage required for unique business identities')
    for (const constraint of this.definition.unique) {
      if(!constraint.fields.length)throw new Error('Invalid trusted uniqueness declaration')
      const key=(record:T)=>uniqueRecordKey(constraint.name,constraint.fields.map(field=>record[field]))
      const applies=(record:T)=>{const active=constraint.when?constraint.when(structuredClone(record)):true;if(typeof active!=='boolean')throw new Error('Unique predicate must return a boolean');return active}
      const nextActive=applies(value),oldActive=previous?applies(previous):false,nextKey=nextActive?key(value):null,oldKey=previous&&oldActive?key(previous):null
      if(nextKey){
        const reservation=await tx.get<{recordId:string|null}>(nextKey)
        if(reservation&&reservation.value.recordId!==null&&reservation.value.recordId!==value.id)throw new PluginError(409,`${this.definition.label} identity already exists`)
        if(!reservation||reservation.value.recordId===null)await tx.put(nextKey,{recordId:value.id},reservation?.revision??0)
      }
      if(oldKey&&oldKey!==nextKey){
        const old=await tx.get<{recordId:string|null}>(oldKey)
        if(!old||old.value.recordId!==value.id)throw new PluginError(409,'Unique identity reservation conflicts')
        await tx.put(oldKey,{recordId:null},old.revision)
      }
    }
  }

  /**
   * Dispatches one admitted record operation and optionally joins it to durable command/audit receipt handling.
   * @param principal - Verified current tenant/user principal; host authorization is rechecked throughout the operation.
   * @param operation - Declared list/get/create/update/archive or plugin custom reducer key.
   * @param input - Operation-schema input; mutations require matching record revision and optional durable commandId when declared.
   * @returns List operations return the configured listKey with scoped records and paging metadata; get/mutations return a decoded revisioned record. Paged results may be incomplete and carry nextCursor/mayHaveMore.
   * @throws Rejects invalid principal (401), denied/revoked admission (403), schema/operation errors (400), missing/excluded record (404), stale revision/uniqueness/CAS conflict or missing required transactional capability (409), foreign/corrupt records, and propagated domain/store/clock/callback failures.
   * 
   * @remarks
   * Pagination scans at most 10000 rows per request, selecting authorized/filter-matching records. Without paging, filtering applies only to the bounded store result. Repository writes with declared commandId replay the stored identical result; other repository writes append audit. Recheck live resource permission before replay, and reload uncertain plain-store outcomes rather than retrying blindly.
   * 
   * @example
   * ```typescript
   * import { ScopedRecordService, type PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export function dispatch<T extends {tenantId: string; id: string}, S extends T & {revision: number}>(service: ScopedRecordService<T, S>, principal: PluginPrincipal, operation: string, input: unknown) { return service.execute(principal, operation, input); }
   * ```
   */
  async execute(principal: PluginPrincipal, operation: string, input: unknown): Promise<unknown> {
    if (this.host.repository) {
      await this.allow(principal, operation, input)
      const p = structuredClone(principal)
      return this.host.repository.run(p, async tx => {
        const service = new ScopedRecordService<T, S>({ ...this.host, repository: undefined, store: createAtomicRecordStore<T>(tx, p) }, this.definition, tx)
        const write = operation !== this.definition.operations.list && operation !== this.definition.operations.get
        const journaled = write && (this.definition.schemas[operation] as any)?.properties?.commandId && typeof (input as any)?.commandId === 'string'
        const perform = () => service.execute(p, operation, input)
        if (journaled && !this.validators.get(operation)?.(input)) throw new PluginError(400, `Invalid ${this.definition.label} command`)
        const result = journaled ? await atomicCommand(tx, p, operation, input as { commandId: string }, perform) : await perform()
        if(write&&!journaled)await appendAtomicAudit(tx,p,operation,input,result)
        const resource = operation === this.definition.operations.list ? undefined : await service.load(p, (result as S).id)
        await this.allow(p, operation, input, resource)
        return result
      })
    }
    await this.allow(principal, operation, input)
    const validate = this.validators.get(operation)
    if (!validate || !validate(input)) throw new PluginError(400, `Invalid ${this.definition.label} command`)
    if (!this.atomicSession && operation !== this.definition.operations.list && operation !== this.definition.operations.get && (this.definition.schemas[operation] as any)?.properties?.commandId && typeof (input as any)?.commandId === 'string') throw new PluginError(409, 'Transactional storage required for durable command receipts')
    const args = input as Record<string, any>, at = (this.host.now?.() ?? new Date()).toISOString(), ops = this.definition.operations
    if (this.definition.afterWrite && !this.atomicSession && operation !== ops.list && operation !== ops.get) throw new PluginError(409, 'Transactional storage required for owning record composition')
    if (operation === ops.list) {
      const limit = args.limit ?? 50, values:S[]=[]
      if (this.definition.pagination && this.host.store.listPage) {
        const {cursor,...criteria}=args,scope=[principal.tenantId,principal.userId,operation,criteria];let position=parseRecordCursor(scope,cursor),finished=false,scannedCount=0
        while(values.length<limit && scannedCount<10000){const rows=await this.host.store.listPage(principal.tenantId,100,position);if(!rows.length){finished=true;break}for(const raw of rows){position=raw.id;scannedCount++;if(this.excluded(raw.id))continue;const value=this.decode(principal,raw);if(this.matches(args,value) && await this.host.authorize(structuredClone(principal),operation,{...criteria,id:value.id},structuredClone(value))===true)values.push(value);if(values.length===limit)break}if(values.length<limit&&rows.length<100){finished=true;break}}
        await this.allow(principal,operation,input)
        return { [this.definition.listKey]:values,scannedLimit:limit,scannedCount,mayHaveMore:!finished,nextCursor:finished?null:recordCursor(scope,position) }
      }
      if (args.cursor) throw new PluginError(409,'Paged record storage unavailable')
      const records=await this.host.store.list(principal.tenantId,limit)
      for(const raw of records){if(this.excluded(raw.id))continue;const value=this.decode(principal,raw);if(this.matches(args,value) && await this.host.authorize(structuredClone(principal),operation,{id:value.id},structuredClone(value))===true)values.push(value)}
      await this.allow(principal,operation,input)
      return { [this.definition.listKey]:values,scannedLimit:limit,mayHaveMore:records.length===limit }

    }
    if (operation === ops.create) {
      const value = this.definition.create(args, principal, at)
      if (value.tenantId !== principal.tenantId || !value.id || this.excluded(value.id)) throw new Error(`Invalid ${this.definition.label} scope`)
      await this.allow(principal, operation, value)
      await this.reserveUnique(value)
      await this.host.store.create(principal.tenantId, { id: value.id, revision: 1, value })
      const created = { ...value, revision: 1 } as S
      if (this.definition.afterWrite) {
        await this.definition.afterWrite(structuredClone(principal), operation, structuredClone(args), structuredClone(created))
        await this.allow(principal, operation, input, created)
      }
      return created
    }
    const current = await this.load(principal, textInput(args.id, 'id', 128)); await this.allow(principal, operation, input, current)
    if (operation === ops.get) return current
    const previous = structuredClone(current)
    const expected = revisionInput(args.revision)
    if (expected !== current.revision) throw new PluginError(409, `${this.definition.label} changed`)
    if (operation === ops.archive) {
      this.definition.archive(current, at, args, principal)
    } else if (operation === ops.update) {
      const patch = args.patch as Record<string, unknown>
      const patchSchema = (this.definition.schemas[ops.update] as any)?.properties?.patch?.properties
      if (patchSchema) exactKeys(patch, Object.keys(patchSchema))
      this.definition.update(current, patch, at)
    } else if (this.definition.custom?.[operation]) {
      this.definition.custom[operation](current, args, at, principal)
    } else {
      throw new PluginError(400, `Unknown ${this.definition.label} operation`)
    }
    await this.allow(principal, operation, input, current)
    await this.reserveUnique(current, previous)
    const nextRevision = expected + 1
    const {revision:_revision,...payload}=current
    if (!await this.host.store.replace(principal.tenantId, { id: current.id, revision: nextRevision, value: payload as unknown as T }, expected)) throw new PluginError(409, `${this.definition.label} changed`)
    current.revision = nextRevision
    if (this.definition.afterWrite) {
      await this.definition.afterWrite(structuredClone(principal), operation, structuredClone(args), structuredClone(current), previous)
      await this.allow(principal, operation, input, current)
    }
    return current
  }
}
