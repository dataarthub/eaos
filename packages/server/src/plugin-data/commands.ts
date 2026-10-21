import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { assertPrincipal, PluginError, type PluginPrincipal, type PluginRecordStore } from './index'
/**
 * Minimum tenant-owned aggregate state with an append-only in-record operation history.
 * 
 * @see RecordCommandService for canonical host integration.
 */
export interface CommandState {
  /**
   * Tenant identity bound by the trusted principal; never selected as an authorization grant from request data.
   */
  tenantId: string;
  /**
   * In-record operation/actor/ISO-time history appended for accepted writes; maximum history length is enforced by the service.
   */
  history: { 
    /**
     * Declared accepted write operation appended by RecordCommandService.
     */
    operation: string; 
    /**
     * Verified user ID whose accepted write created this history entry.
     */
    actorId: string; 
    /**
     * Trusted UTC ISO operation timestamp.
     */
    at: string }[] }
/**
 * Tenant/record/revision envelope returned after an admitted aggregate operation.
 * @typeParam T - Cloned reducer response data or resulting state payload.
 * 
 * @see RecordCommandService for canonical host integration.
 */
export interface CommandResponse<T> {
  /**
   * Tenant identity bound by the trusted principal; never selected as an authorization grant from request data.
   */
  tenantId: string;
  /**
   * Logical aggregate ID selected by the trusted definition.
   */
  recordId: string;
  /**
   * Observed aggregate revision; new or unstored reads may use 0, while accepted writes advance it by one.
   */
  revision: number;
  /**
   * Cloned reducer result, or the resulting aggregate state when the reducer returns undefined.
   */
  data: T }
/**
 * Host persistence, transaction and live authorization ports for aggregate command execution.
 * @typeParam T - Tenant-owned aggregate state required by the store and reducer transaction.
 * 
 * @see RecordCommandService for canonical host integration.
 */
export interface CommandHost<T extends CommandState> {
  /**
   * Optional durable tenant record store; used when transaction is absent.
   */
  store?: PluginRecordStore<T>
  /**
   * Runs aggregate reads, CAS and final permission checks through one real connection-bound transaction.
   * 
   * Trusted connection-bound store; all reads, CAS and final authorization share one transaction.
   * May expose an unstored projection at revision 0; the first write creates revision 1.
   * @param principal - Verified current principal owning the transaction.
   * @param work - Async service work receiving the joined record store; do not retain that store after completion.
   * @typeParam R - Value resolved by the transaction/connection callback.
   * @returns The callback result after commit; rejection rolls back joined writes.
   * @throws Rejects propagated host persistence, validation or callback failures.
   
   * @example
   * ```typescript
   * import type { CommandHost, CommandState, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function readAggregate(host: CommandHost<CommandState>, principal: PluginPrincipal, recordId: string) {
   *   if (!host.transaction) throw new Error("Joined transaction port required");
   *   return host.transaction(principal, store => store.read(principal.tenantId, recordId));
   * }
   * ```
   */
  transaction?<R>(principal:PluginPrincipal,work:(store:PluginRecordStore<T>)=>Promise<R>):Promise<R>
  /**
   * Checks current lifecycle and permission for the operation and complete returned aggregate.
   * 
   * Must check live activation and access to the entire returned aggregate, including referenced resources.
   * @param p - Verified principal copied for this check.
   * @param operation - Declared operation name.
   * @param input - Schema input (initial admission occurs before schema validation).
   * @param current - Optional copied current aggregate including all referenced-resource access.
   * @returns Exactly true to admit; false denies with PluginError 403.
   * @throws Rejects propagated host persistence, validation or callback failures.
   
   * @example
   * ```typescript
   * import type { CommandHost, CommandState, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function canOperate(host: CommandHost<CommandState>, principal: PluginPrincipal, operation: string, input: unknown, current: Readonly<CommandState>) {
   *   return await host.authorize(principal, operation, input, current) === true;
   * }
   * ```
   */
  authorize(p: PluginPrincipal, operation: string, input: unknown, current?: Readonly<T>): Promise<boolean>
  /**
   * Optional trusted clock used for operation history timestamps; defaults to new Date().
   
   * @returns A valid Date whose toISOString value becomes the operation timestamp.
   * @throws Callback failures propagate to the owning operation; transactional writes roll back when the host boundary rejects.
   */
  now?: () => Date
}
/**
 * Private mutable reducer context supplied after command and resource validation.
 * @typeParam T - Private mutable aggregate state supplied to the reducer.
 * 
 * @see RecordCommandService for canonical host integration.
 */
export interface CommandContext<T> {
  /**
   * Cloned verified principal for this admitted reducer invocation.
   */
  principal: PluginPrincipal;
  /**
   * Declared operation being executed.
   */
  operation: string;
  /**
   * Cloned schema-validated operation input.
   */
  args: Record<string, any>;
  /**
   * Private mutable aggregate snapshot; persist through the owning service rather than writing the store directly.
   */
  state: T;
  /**
   * Trusted UTC ISO operation timestamp.
   */
  at: string;
  /**
   * Logical aggregate ID resolved for this command.
   */
  recordId: string }
/**
 * Executes schema-validated aggregate reducers through tenant isolation, live admission and revision-predicated persistence.
 * 
 * Plugin-owned reducers may change their private snapshot only; irreversible external effects must be queued durably.
 * @typeParam T - Tenant-owned aggregate state with tenantId and appendable operation history.
 * 
 * @remarks
 * Requires server Ajv/formats and a real host store or connection-bound transaction. Reducers mutate only their private cloned snapshot; queue irreversible external effects durably. Transactional hosts keep reads, write/CAS and final admission in one commit boundary; plain stores do not add a transaction. No command deduplication or automatic retry is added.
 * 
 * @example
 * ```typescript
 * import { RecordCommandService, type CommandState, type CommandHost } from '@alneas/eaos-server/plugin-data';
 * export function connectAggregate<T extends CommandState>(host: CommandHost<T>, definition: ConstructorParameters<typeof RecordCommandService<T>>[1]) { return new RecordCommandService(host, definition); }
 * ```
 */
export class RecordCommandService<T extends CommandState> {
 private readonly validators
  /**
   * Compiles the declared operation schemas and binds real host persistence/admission capabilities.
   * @param host - Live authorization and durable store or transaction; transaction takes precedence when provided.
   * @param definition - Plugin schemas, write-operation allowlist, record-ID resolver, initial-state factory, reducer and invariant validator.
   * @throws Throws for absent durable store/transaction or live authorization and for invalid strict Ajv schemas.
   * 
   * @example
   * ```typescript
   * import { RecordCommandService, type CommandState, type CommandHost } from '@alneas/eaos-server/plugin-data';
   * export function connectAggregate<T extends CommandState>(host: CommandHost<T>, definition: ConstructorParameters<typeof RecordCommandService<T>>[1]) { return new RecordCommandService(host, definition); }
   * ```
   */
  constructor(private readonly host: CommandHost<T>, private readonly definition: {
  
    /**
     * Strict noncoercing JSON Schemas indexed by accepted operation names.
     */
    schemas: Record<string, object>; 
    /**
     * Explicit operation names that persist state, require matching revision and append history.
     */
    writes: readonly string[]; 
    /**
     * Optional pure resolver from admitted input to a nonblank record scope up to 256 characters; omitted uses state.
     
     * @param input - Cloned schema-admitted input.
     * @returns Nonblank logical record ID up to 256 characters; omitted resolver defaults to state.
     * @throws Callback failures propagate to the owning operation; transactional writes roll back when the host boundary rejects.
     */
    recordId?: (input: Record<string, any>) => string
  
    /**
     * Create a tenant/record-bound unstored aggregate snapshot when no row exists.
     
     * @param tenantId - Verified tenant ID owning the aggregate.
     * @param recordId - Resolved logical record ID.
     * @returns A new private unstored tenant-owned state with initialized history.
     * @throws Callback failures propagate to the owning operation; transactional writes roll back when the host boundary rejects.
     */
    initial: (tenantId: string, recordId: string) => T
  
    /**
     * Async plugin reducer receiving private state/input and verified context; mutate only that snapshot and queue external effects durably.
     
     * @param context - Private mutable state, cloned principal/input and trusted operation time.
     * @returns Optional domain response data; undefined selects the resulting state for response data.
     * @throws Callback failures propagate to the owning operation; transactional writes roll back when the host boundary rejects.
     */
    reduce: (context: CommandContext<T>) => Promise<unknown>
  
    /**
     * Synchronous aggregate invariant assertion before/after writes; throw to reject invalid state.
     
     * @param state - Private aggregate state whose tenant/history/domain invariants must hold.
     * @returns Completes without a value when invariants pass; throw to reject before persistence.
     * @throws Callback failures propagate to the owning operation; transactional writes roll back when the host boundary rejects.
     */
    validate: (state: T) => void
 }) {
  if ((!host?.store && typeof host?.transaction !== 'function') || typeof host.authorize !== 'function') throw new Error('Durable store and live authorization required')
  const ajv = new Ajv({ strict: true, coerceTypes: false }); addFormats(ajv)
  this.validators = new Map(Object.entries(definition.schemas).map(([key, schema]) => [key, ajv.compile(schema)]))
 }
  /**
   * Validates and admits one aggregate operation, running a reducer against a private current snapshot.
   * @param principal - Host-authenticated current tenant/user context; structural validation alone proves no membership.
   * @param operation - Declared schema key; membership in definition.writes selects persistence.
   * @param input - Operation-schema input; writes require a safe integer revision matching the current snapshot, including 0 for a new/unstored aggregate.
   * @returns A tenant/record/revision envelope with cloned reducer data, or resulting state when the reducer returns undefined; read-only reducers do not persist mutations.
   * @throws Rejects malformed principal (401), denied live admission (403), schema/scope errors (400), stale revision/capacity/CAS conflict (409), invalid foreign records/reducer scope, and propagated reducer/invariant/clock/store/transaction failures.
   * 
   * @remarks
   * Record ID defaults to state and must be nonblank/up to 256 characters. Writes append actor/UTC history and reject over 5000 entries or 8 MiB JSON state. Host transaction projections may start at revision 0. Rejections can follow partial plain-store/adapter effects; callers must reload before retrying uncertain outcomes.
   * 
   * @example
   * ```typescript
   * import { RecordCommandService, type CommandState, type PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export function executeAggregate<T extends CommandState>(service: RecordCommandService<T>, principal: PluginPrincipal, operation: string, input: unknown) { return service.execute(principal, operation, input); }
   * ```
   */
  async execute(principal: PluginPrincipal, operation: string, input: unknown): Promise<CommandResponse<any>> {
  assertPrincipal(principal)
  const p = structuredClone(principal), args = structuredClone(input) as Record<string, any>
  const allow = async (state?: T) => { if (await this.host.authorize(structuredClone(p), operation, structuredClone(args), state && structuredClone(state)) !== true) throw new PluginError(403, 'Plugin access denied') }
  await allow()
  if (!this.validators.get(operation)?.(args)) throw new PluginError(400, 'Invalid command')
  const id = this.definition.recordId?.(args) ?? 'state'
  if (typeof id !== 'string' || !id.trim() || id.length > 256) throw new PluginError(400, 'Invalid record scope')
  const run = async (store:PluginRecordStore<T>) => {
  const record = await store.read(p.tenantId, id)
  if (record && (record.id !== id || record.value.tenantId !== p.tenantId || !Number.isSafeInteger(record.revision) || record.revision < (this.host.transaction ? 0 : 1))) throw new Error('Foreign or invalid plugin record')
  const state = structuredClone(record?.value ?? this.definition.initial(p.tenantId, id)), current = structuredClone(state), revision = record?.revision ?? 0
  this.definition.validate(state); await allow(current)
  const write = this.definition.writes.includes(operation)
  if (write && (!Number.isSafeInteger(args.revision) || args.revision !== revision)) throw new PluginError(409, 'Plugin revision changed')
  const at = (this.host.now?.() ?? new Date()).toISOString()
  const result = await this.definition.reduce({ principal: structuredClone(p), operation, args, state, at, recordId: id })
  if (write) {
   if (state.tenantId !== p.tenantId) throw new Error('Reducer changed tenant')
   state.history.push({ operation, actorId: p.userId, at }); this.definition.validate(state)
   if (state.history.length > 5000 || Buffer.byteLength(JSON.stringify(state)) > 8 * 1024 * 1024) throw new PluginError(409, 'Plugin aggregate capacity reached')
   await allow(current)
   const next = { id, revision: revision + 1, value: state }
   if (!record || revision===0) await store.create(p.tenantId, next)
   else if (!await store.replace(p.tenantId, next, revision)) throw new PluginError(409, 'Plugin revision changed')
  } else await allow(current)
  if(this.host.transaction)await allow(current)
  return { tenantId: p.tenantId, recordId: id, revision: revision + (write ? 1 : 0), data: structuredClone(result === undefined ? state : result) }
  }
  return this.host.transaction ? this.host.transaction(p,run) : run(this.host.store!)
 }
}
