import { atomicSqlBindings as joinedConnections } from './atomic-context'
import {appendAtomicAudit} from './audit'
import { assertPrincipal, PluginError, type PluginPrincipal } from './index'
import type { PluginRecordStore } from './index'
import type { DataContractCatalog, JsonDocumentContract } from '@alneas/eaos-server/lifecycle-engine'
import { createRecordDocumentValidator, recordDocuments } from './json-documents'
import { canonicalJsonHash } from '@alneas/eaos-core/serialization'
import { assertPayloadWithinPolicy, resolvePluginStoragePolicy, type PluginManifest, type PluginStoragePolicy } from '@alneas/eaos-core/plugin-sdk'

function storagePayload(policy: PluginStoragePolicy, value: unknown): string {
 try { return assertPayloadWithinPolicy(policy, value) } catch (error) {
  if (error instanceof Error && error.message === 'Storage policy payload limit exceeded') throw new PluginError(409, error.message)
  throw error
 }
}

/**
 * Tenant-scoped logical row and its CAS revision at the time of reading/writing.
 * @typeParam T - JSON row payload shape; defaults to unknown.
 * 
 * @see createAtomicRepository for canonical host integration.
 */
export interface AtomicRow<T = unknown> {
  /**
   * Logical tenant/namespace-scoped record identity.
   */
  id: string;
  /**
   * CAS revision for the stored envelope; persisted records start at 1 unless a documented host projection uses 0.
   */
  revision: number;
  /**
   * Stored JSON payload whose runtime validation depends on the configured document contracts.
   */
  value: T }
/**
 * Temporary tenant/namespace-bound session valid only inside its repository work callback.
 * 
 * @see createAtomicRepository for canonical host integration.
 */
export interface AtomicSession {
  /**
   * Performs one scoped read inside the active repository transaction.
   * @param id - Logical row ID; 1–240 supported record-key characters.
   * @typeParam T - JSON payload type read or persisted by this session operation.
   * @returns The scoped envelope or null when absent.
   * @throws Rejects expired session, invalid IDs/revisions/limits, document/payload errors, duplicate/create or CAS conflict and provider failures as applicable.
   
   * @example
   * ```typescript
   * import type { AtomicRepository, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function readTitle(repository: AtomicRepository, principal: PluginPrincipal, id: string) {
   *   return repository.run(principal, async session => {
   *     const row = await session.get<{ title: string }>(id);
   *     return row?.value.title ?? null;
   *   });
   * }
   * ```
   */
  get<T>(id: string): Promise<AtomicRow<T> | null>
  /**
   * Performs ordered batch reads inside the active repository transaction.
   * 
   * Batch reads preserve tenant scope and input order; missing rows are null.
   * @param ids - Logical IDs in desired output order; duplicates retain their positions.
   * @typeParam T - JSON payload type read or persisted by this session operation.
   * @returns One envelope or null per input ID in the same order.
   * @throws Rejects expired session, invalid IDs/revisions/limits, document/payload errors, duplicate/create or CAS conflict and provider failures as applicable.
   
   * @example
   * ```typescript
   * import type { AtomicRepository, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function readTitles(repository: AtomicRepository, principal: PluginPrincipal, ids: string[]) {
   *   return repository.run(principal, async session => {
   *     if (!session.getMany) throw new Error("Batch reads not supported");
   *     return session.getMany<{ title: string }>(ids);
   *   });
   * }
   * ```
   */
  getMany?<T>(ids: string[]): Promise<(AtomicRow<T> | null)[]>
  /**
   * Performs transactional batch CAS writes inside the active repository transaction.
   * 
   * Every item uses CAS in the enclosing transaction; any failure rolls back all items.
   * @param changes - Unique logical-ID/value/expected changes; expected=0 creates and positive expected performs exact CAS.
   * @typeParam T - JSON payload type read or persisted by this session operation.
   * @returns Next-revision envelopes in input order; any failure must reject the enclosing transaction.
   * @throws Rejects expired session, invalid IDs/revisions/limits, document/payload errors, duplicate/create or CAS conflict and provider failures as applicable.
   
   * @example
   * ```typescript
   * import type { AtomicRepository, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function createPair(repository: AtomicRepository, principal: PluginPrincipal) {
   *   return repository.run(principal, async session => {
   *     if (!session.putMany) throw new Error("Batch writes not supported");
   *     return session.putMany([{ id: "examples/first", value: { title: "First" }, expected: 0 }, { id: "examples/second", value: { title: "Second" }, expected: 0 }]);
   *   });
   * }
   * ```
   */
  putMany?<T>(changes: { 
    /**
     * Unique logical record key within this batch and tenant namespace.
     */
    id: string; 
    /**
     * JSON payload to validate against configured policy/document contracts.
     */
    value: T; 
    /**
     * Expected safe CAS revision; 0 creates, positive values replace exactly that revision.
     */
    expected: number }[]): Promise<AtomicRow<T>[]>
  /**
   * Performs a bounded scoped keyset read inside the active repository transaction.
   * 
   * Empty prefix reads the repository's own tenant/namespace, never another tenant.
   * @param prefix - Logical prefix; empty stays within this repository tenant/namespace.
   * @param after - Optional exclusive logical ID; defaults to the start of the prefix range.
   * @param limit - Integer page size 1–101; defaults to 100.
   * @typeParam T - JSON payload type read or persisted by this session operation.
   * @returns Envelopes in stable logical-ID order within the prefix.
   * @throws Rejects expired session, invalid IDs/revisions/limits, document/payload errors, duplicate/create or CAS conflict and provider failures as applicable.
   
   * @example
   * ```typescript
   * import type { AtomicRepository, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function firstPage(repository: AtomicRepository, principal: PluginPrincipal) {
   *   return repository.run(principal, session => session.list<{ title: string }>("examples/", "", 20));
   * }
   * ```
   */
  list<T>(prefix: string, after?: string, limit?: number): Promise<AtomicRow<T>[]>
  /**
   * Performs one create-or-CAS write inside the active repository transaction.
   * 
   * expected=0 creates; otherwise atomically replaces exactly the expected revision.
   * @param id - Logical row ID.
   * @param value - JSON payload admitted by configured limits/contracts.
   * @param expected - Safe integer expected revision from 0 to MAX_SAFE_INTEGER-1; 0 creates, otherwise exact CAS.
   * @typeParam T - JSON payload type read or persisted by this session operation.
   * @returns A cloned-payload envelope with revision expected+1.
   * @throws Rejects expired session, invalid IDs/revisions/limits, document/payload errors, duplicate/create or CAS conflict and provider failures as applicable.
   
   * @example
   * ```typescript
   * import type { AtomicRepository, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function createTitle(repository: AtomicRepository, principal: PluginPrincipal, id: string, title: string) {
   *   return repository.run(principal, session => session.put(id, { title }, 0));
   * }
   * ```
   */
  put<T>(id: string, value: T, expected: number): Promise<AtomicRow<T>>
}
/**
 * Host-admitted transactional entrypoint that scopes all session operations to one verified principal.
 * 
 * @see createAtomicRepository for canonical host integration.
 */
export interface AtomicRepository {
  /**
   * Runs work in one verified tenant transaction whose session expires when work settles.
   * @param principal - Verified tenant/user principal; repository structure checks do not prove live permission.
   * @param work - Async domain work; never let session or joined SQL capabilities escape its lifetime.
   * @typeParam T - Value resolved by the transaction/connection callback.
   * @returns The callback result after successful commit; work/commit failure rejects and triggers rollback.
   * @throws Rejects propagated host persistence, validation or callback failures.
   
   * @example
   * ```typescript
   * import type { AtomicRepository, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function updateTitle(repository: AtomicRepository, principal: PluginPrincipal, id: string, title: string) {
   *   return repository.run(principal, async session => {
   *     const current = await session.get<{ title: string }>(id);
   *     if (!current) throw new Error("Record unavailable");
   *     return session.put(id, { title }, current.revision);
   *   });
   * }
   * ```
   */
  run<T>(principal: PluginPrincipal, work: (session: AtomicSession) => Promise<T>): Promise<T>
}
/**
 * Connection-bound SQL operations sharing the enclosing commit/rollback boundary.
 * 
 * @see createAtomicRepository for canonical host integration.
 */
export interface AtomicSqlConnection {
  /**
   * Executes one trusted SQL statement on the exact connection owning the enclosing transaction.
   * @param sql - Trusted parameterized SQL with tenant/namespace predicates.
   * @param binds - Positional bind values in placeholder order.
   * @returns Optional query rows and an accurate affected-row count.
   * @throws Rejects propagated host persistence, validation or callback failures.
   
   * @example
   * ```typescript
   * import type { AtomicSqlDriver, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function queryJoined(driver: AtomicSqlDriver, principal: PluginPrincipal, trustedTenantSql: string, bindings: unknown[]) {
   *   return driver.transaction(principal, async connection => {
   *     return (await connection.execute(trustedTenantSql, bindings)).rows ?? [];
   *   });
   * }
   * ```
   */
  execute(sql: string, binds: unknown[]): Promise<{ 
    /**
     * Optional object rows from SELECT execution on this connection.
     */
    rows?: Record<string, unknown>[]; 
    /**
     * Accurate affected-row count for scalar execution or one count per ordered batch bind row.
     */
    affectedRows: number }>
  /**
   * Optionally executes ordered bind batches on the same transaction connection.
   * @param sql - Trusted parameterized DML.
   * @param binds - Ordered positional bind rows.
   * @returns An affectedRows count for every bind row in input order; missing/wrong counts must fail CAS.
   * @throws Rejects propagated host persistence, validation or callback failures.
   
   * @example
   * ```typescript
   * import type { AtomicSqlDriver, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function batchReviewed(driver: AtomicSqlDriver, principal: PluginPrincipal, trustedTenantDml: string, binds: unknown[][]) {
   *   return driver.transaction(principal, async connection => {
   *     if (!connection.executeMany) throw new Error("Batch DML not supported");
   *     return (await connection.executeMany(trustedTenantDml, binds)).affectedRows;
   *   });
   * }
   * ```
   */
  executeMany?(sql: string, binds: unknown[][]): Promise<{ 
    /**
     * Accurate affected-row count for scalar execution or one count per ordered batch bind row.
     */
    affectedRows: number[] }>
}
/**
 * Provider transaction boundary required for envelope CAS, domain writes and durable journal atomicity.
 * 
 * @see createAtomicRepository for canonical host integration.
 */
export interface AtomicSqlDriver {
  /**
   * SQL placeholder/driver dialect selected by trusted host configuration.
   */
  dialect: 'sqlite' | 'oracle' | 'postgres'
  /**
   * Acquires one transaction connection, commits success and rolls back rejection.
   * 
   * Same connection for every statement; commits on success, rolls back on rejection.
   * @param principal - Verified tenant/user principal used for host session admission.
   * @param work - Async work on the same connection for every domain/CAS/audit statement.
   * @typeParam T - Value resolved by the transaction/connection callback.
   * @returns The callback result after commit; all joined writes roll back on failure.
   * @throws Rejects propagated host persistence, validation or callback failures.
   
   * @example
   * ```typescript
   * import type { AtomicSqlDriver, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function readJoined(driver: AtomicSqlDriver, principal: PluginPrincipal, trustedTenantSql: string, bindings: unknown[]) {
   *   return driver.transaction(principal, async connection => {
   *     const result = await connection.execute(trustedTenantSql, bindings);
   *     return result.rows ?? [];
   *   });
   * }
   * ```
   */
  transaction<T>(principal: PluginPrincipal, work: (connection: AtomicSqlConnection) => Promise<T>): Promise<T>
}
/**
 * Expose SQL execution on the exact active transaction that owns envelope CAS and receipts.
 * @param session - Currently active repository session carrying a trusted SQL capability binding.
 * @param principal - Verified principal matching both tenant and user of the joined transaction.
 * @returns The bound driver dialect and an execute(tenantId, sql, binds) method using the existing connection.
 * @throws Throws for malformed/mismatched principals, missing/expired transaction bindings or a foreign execute tenant; driver failures propagate.
 * @remarks Never retain or use the executor after the parent transaction callback returns. It does not open another transaction or authorize arbitrary SQL.
 * @example
 * import { joinedAtomicSqlExecutor, type AtomicRepository, type PluginPrincipal } from '@alneas/eaos-server/plugin-data'
 * export function queryJoined(repository: AtomicRepository, principal: PluginPrincipal, statement: string, binds: unknown[]) {
 *  // The host supplies trusted SQL and verifies resource permission before entry.
 *  return repository.run(principal, session => joinedAtomicSqlExecutor(session, principal).execute(principal.tenantId, statement, binds))
 * }
 */
export function joinedAtomicSqlExecutor(session: AtomicSession, principal: PluginPrincipal) {
 assertPrincipal(principal)
 const binding = joinedConnections.get(session)
 if (!binding || binding.principal.tenantId !== principal.tenantId || binding.principal.userId !== principal.userId) throw new Error('Live joined SQL transaction required')
 return {
  dialect: binding.dialect,
/**
 * Executes trusted SQL on this session's still-active joined connection.
 * @param tenantId - Must match the verified tenant bound to the original session.
 * @param sql - Trusted parameterized SQL with explicit tenant predicates.
 * @param binds - Positional bind values in placeholder order.
 * @returns Query rows and affected-row metadata from the existing transaction.
 * @throws Rejects expired/mismatched bindings, foreign tenant or underlying SQL failure.
 * @see joinedAtomicSqlExecutor for scoped usage that does not retain this capability.
 */
async execute(tenantId: string, sql: string, binds: unknown[]) {
   if (joinedConnections.get(session) !== binding || tenantId !== binding.principal.tenantId) throw new Error('Joined SQL transaction expired or tenant differs')
   return binding.connection.execute(sql, binds)
  },
 }
}
/**
 * Compute the canonical JSON SHA-256 used by atomic commands and scoped cursors.
 * @param value - Canonical-JSON-compatible value to hash.
 * @returns Lowercase hexadecimal SHA-256.
 * @throws Canonical serialization rejects unsupported or invalid values.
 * @remarks A hash binds content; it is not a signature or external trust anchor.
 * @example
 * import { atomicHash } from '@alneas/eaos-server/plugin-data'
 * const hash = atomicHash({ id: 'example' })
 */
export function atomicHash(value: unknown): string {
 return canonicalJsonHash(value)
}
/**
 * Replay or atomically record one principal/operation-scoped command result in an existing transaction.
 * @param tx - Live tenant-scoped atomic session enclosing the actual domain work.
 * @param p - Verified principal whose user ID scopes the command receipt.
 * @param operation - Trusted operation name included in the receipt key.
 * @param input - Complete command input with a commandId of 1–80 letters/digits/underscore/hyphen.
 * @param work - Async domain callback run only for a new command; must remain inside the same transaction.
 * @typeParam T - JSON-serializable domain result stored and returned by the command receipt.
 * @returns The existing identical receipt result or the newly computed result.
 * @throws Rejects malformed command IDs, input reuse with a different hash, CAS/audit failures and propagated work errors.
 * @remarks Caller performs live resource authorization before replay as well as execution. Domain writes, receipt and audit share the existing transaction; irreversible external effects must be durably queued, not performed inside work.
 * @example
 * import { atomicCommand, type AtomicRepository, type AtomicSession, type PluginPrincipal } from '@alneas/eaos-server/plugin-data'
 * export function command<T>(repository: AtomicRepository, principal: PluginPrincipal, input: { commandId: string }, work: (session: AtomicSession) => Promise<T>) {
 *  // The host performs live resource admission before replay or new execution.
 *  return repository.run(principal, session => atomicCommand(session, principal, 'example-operation', input, () => work(session)))
 * }
 */
export async function atomicCommand<T>(tx: AtomicSession, p: PluginPrincipal, operation: string, input: { 
  /**
   * Stable nonempty 1–80 character command ID scoped by actor and operation; identical full input replays the stored result.
   */
  commandId: string }, work: () => Promise<T>): Promise<T> {
 if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.commandId)) throw new PluginError(400, 'Command ID required')
 const key = `command/${atomicHash([p.userId, operation, input.commandId])}`, hash = atomicHash(input)
 const old = await tx.get<{ hash: string; result: T }>(key)
 if (old) { if (old.value.hash !== hash) throw new PluginError(409, 'Command ID reused with different input'); return old.value.result }
 const result = await work()
 await tx.put(key, { hash, result }, 0)
 await appendAtomicAudit(tx,p,operation,input,result,key)
 return result
}
/**
 * Encode an exclusive record position bound to the canonical hash of its query scope.
 * @param scope - Tenant/user/operation/filter scope defined by the caller.
 * @param after - Exclusive logical record ID to resume after.
 * @returns Base64url cursor containing the scope hash and position.
 * @throws Unsupported canonical scope values or JSON serialization failures propagate.
 * @remarks Encoding is not encryption or a signature; the reader validates scope and record-key grammar.
 * @example
 * import { recordCursor } from '@alneas/eaos-server/plugin-data'
 * const cursor = recordCursor(['example-tenant', 'list'], 'record-1')
 */
export function recordCursor(scope: unknown, after: string): string { return Buffer.from(JSON.stringify({ scope: atomicHash(scope), after })).toString('base64url') }
/**
 * Decode a cursor only when its scope hash and logical record key match the current query.
 * @param scope - Current tenant/user/operation/filter scope.
 * @param cursor - Optional base64url cursor; omission returns the initial empty position.
 * @returns Validated exclusive record ID, or an empty string for no cursor.
 * @throws Throws PluginError 400 for invalid encoding/JSON, changed scope or invalid record keys.
 * @example
 * import { parseRecordCursor } from '@alneas/eaos-server/plugin-data'
 * const after = parseRecordCursor(['example-tenant', 'list'])
 */
export function parseRecordCursor(scope: unknown, cursor?: string): string {
 if (!cursor) return ''
 try { const value = JSON.parse(Buffer.from(cursor, 'base64url').toString()); if (value.scope !== atomicHash(scope) || typeof value.after !== 'string') throw new Error(); return idInput(value.after) } catch { throw new PluginError(400, 'Invalid scoped cursor') }
}
const idInput = (id: string) => { if (typeof id !== 'string' || !/^[A-Za-z0-9_.:/-]{1,240}$/.test(id)) throw new PluginError(400, 'Invalid record key'); return id }
/**
 * Canonical namespace, JSON payload policy and optional document contracts for the atomic envelope table.
 * 
 *
 * Plugin-owned table; tenant cannot be selected through individual row operations.
 * @see createAtomicRepository for canonical host integration.
 */
export interface AtomicRepositoryOptions {
  /**
   * Optional trusted logical namespace encoded into physical IDs for a shared table.
   */
  namespace?: string;
  /**
   * Declared payload/object/history limits; does not configure or authorize a provider.
   */
  storagePolicy?: PluginStoragePolicy;
  /**
   * Canonical closed payload contracts copied and enforced by the wrapper.
   */
  documents?: readonly JsonDocumentContract[] }
/**
 * Create tenant/namespace-scoped CAS sessions on a trusted transactional SQL driver.
 * @param table - Trusted lowercase table identifier for envelope persistence.
 * @param driver - Driver that commits the callback result or rolls back all statements on rejection.
 * @param options - Optional namespace, payload policy and canonical document contracts.
 * @returns Repository whose run callback receives a temporary session valid only until the callback settles.
 * @throws Rejects invalid table/driver/namespace/document bindings; operations reject expired sessions, invalid IDs/revisions/payloads, duplicate keys and CAS conflicts.
 * @remarks Does not create tables. Driver transaction atomicity, connection cleanup and live authorization remain host-owned. Batch writes use the same transaction; session capabilities expire in finally. list supports limits 1–101; getMany preserves input order and missing nulls.
 * @example
 * import { createAtomicRepository } from '@alneas/eaos-server/plugin-data'
 * export function repository(driver: Parameters<typeof createAtomicRepository>[1]) { return createAtomicRepository('example_records', driver) }
 */
export function createAtomicRepository(table: string, driver: AtomicSqlDriver, options: AtomicRepositoryOptions = {}): AtomicRepository {
 if (!/^[a-z][a-z0-9_]{0,62}$/.test(table) || !driver?.transaction) throw new Error('Trusted table and transaction driver required')
 const prefix = options.namespace ? `${options.namespace}:` : ''
 const storagePolicy = resolvePluginStoragePolicy(options.storagePolicy)
 const documents = options.documents && structuredClone(options.documents)
 if (documents?.some(d => d.table !== table || d.namespace !== options.namespace)) throw Error('JSON document storage binding differs')
 const validateDocument = documents && createRecordDocumentValidator(documents)
 if (prefix && !/^[a-z][a-z0-9_]{0,62}:$/.test(prefix)) throw new Error('Invalid plugin storage namespace')
 const physicalId = (id: string) => { if (prefix && id.length + prefix.length > 256) throw new PluginError(400, 'Record id is too long for the shared plugin table'); return `${prefix}${id}` }
 const logicalId = (id: string) => prefix ? (id.startsWith(prefix) ? id.slice(prefix.length) : null) : id
 const bind = (n: number) => driver.dialect === 'oracle' ? `:${n}` : driver.dialect === 'postgres' ? `$${n}` : '?'
 const decode = <T>(tenant: string, row: Record<string, unknown>): AtomicRow<T> => { const id = logicalId(String(row.id ?? row.ID)); if (id === null || !id) throw new Error('Record belongs to another plugin storage namespace'); const record = { id, revision: Number(row.revision ?? row.REVISION), value: JSON.parse(String(row.payload ?? row.PAYLOAD)) }; validateDocument?.(tenant, record); return record }
 return { async run(principal, work) {
  assertPrincipal(principal)
  const p = structuredClone(principal)
  return driver.transaction(p, async conn => {
   let active = true
   const check = () => { if (!active) throw new Error('Transaction session expired') }
   const session: AtomicSession = {
    async get<T>(id: string) { check(); idInput(id); const r = await conn.execute(`SELECT id,revision,payload FROM ${table} WHERE tenant_id=${bind(1)} AND id=${bind(2)}`, [p.tenantId, physicalId(id)]); return r.rows?.[0] ? decode<T>(p.tenantId, r.rows[0]) : null },
    async getMany<T>(ids: string[]) {
     check(); ids.forEach(idInput)
     const found = new Map<string, AtomicRow<T>>()
     const unique = [...new Set(ids)]
     for (let offset = 0; offset < unique.length; offset += 200) {
      const batch = unique.slice(offset, offset + 200)
      const r = await conn.execute(`SELECT id,revision,payload FROM ${table} WHERE tenant_id=${bind(1)} AND id IN (${batch.map((_,i)=>bind(i+2)).join(',')})`, [p.tenantId,...batch.map(physicalId)])
      for (const raw of r.rows ?? []) { const row = decode<T>(p.tenantId, raw); found.set(row.id,row) }
     }
     return ids.map(id=>found.get(id) ?? null)
    },
    async putMany<T>(changes: {id:string;value:T;expected:number}[]) {
     check()
     if(new Set(changes.map(c=>c.id)).size!==changes.length)throw new PluginError(400,'Duplicate batch record key')
     const prepared=changes.map(c=>{idInput(c.id);if(!Number.isSafeInteger(c.expected)||c.expected<0||c.expected>=Number.MAX_SAFE_INTEGER)throw new PluginError(400,'Invalid revision');validateDocument?.(p.tenantId,{id:c.id,revision:c.expected+1,value:c.value});return {...c,payload:storagePayload(storagePolicy,c.value)}})
     if(!conn.executeMany){const result:AtomicRow<T>[]=[];for(const c of prepared)result.push(await session.put(c.id,c.value,c.expected));return result}
     try {
      for(const inserting of [true,false]){
       const group=prepared.filter(c=>(c.expected===0)===inserting)
       const sql=inserting?`INSERT INTO ${table}(tenant_id,id,revision,payload) VALUES(${bind(1)},${bind(2)},1,${bind(3)})`:`UPDATE ${table} SET revision=${bind(1)},payload=${bind(2)} WHERE tenant_id=${bind(3)} AND id=${bind(4)} AND revision=${bind(5)}`
       for(let offset=0;offset<group.length;offset+=100){const batch=group.slice(offset,offset+100),result=await conn.executeMany(sql,batch.map(c=>inserting?[p.tenantId,physicalId(c.id),c.payload]:[c.expected+1,c.payload,p.tenantId,physicalId(c.id),c.expected]));if(result.affectedRows.length!==batch.length||result.affectedRows.some(n=>n!==1))throw new PluginError(409,'Record revision changed')}
      }
     }catch(e:any){if(['SQLITE_CONSTRAINT_PRIMARYKEY','SQLITE_CONSTRAINT_UNIQUE','23505','ORA-00001'].includes(e?.code)||e?.errorNum===1)throw new PluginError(409,'Record already exists');throw e}
     return prepared.map(c=>({id:c.id,revision:c.expected+1,value:structuredClone(c.value)}))
    },
    async list<T>(prefix: string, after = '', limit = 100) {
     check(); if (prefix !== '') idInput(prefix)
     if (after) idInput(after)
     if (!Number.isInteger(limit) || limit < 1 || limit > 101) throw new PluginError(400, 'Invalid page limit')
     const tail = driver.dialect === 'oracle' ? `FETCH FIRST ${limit} ROWS ONLY` : `LIMIT ${limit}`
     // Range bounds avoid treating '_' as a LIKE wildcard.
     const physicalPrefix = physicalId(prefix), physicalAfter = after ? physicalId(after) : `${physicalPrefix} `
     const r = await conn.execute(`SELECT id,revision,payload FROM ${table} WHERE tenant_id=${bind(1)} AND id>=${bind(2)} AND id<${bind(3)} AND id>${bind(4)} ORDER BY id ${tail}`, [p.tenantId, physicalPrefix, `${physicalPrefix}\uffff`, physicalAfter])
     return (r.rows ?? []).map(row => decode<T>(p.tenantId, row))
    },
    async put<T>(id: string, value: T, expected: number) {
     check(); idInput(id)
     if (!Number.isSafeInteger(expected) || expected < 0 || expected >= Number.MAX_SAFE_INTEGER) throw new PluginError(400, 'Invalid revision')
     validateDocument?.(p.tenantId, {id, revision: expected + 1, value})
     const payload = storagePayload(storagePolicy, value)
     try {
      const r = expected === 0
       ? await conn.execute(`INSERT INTO ${table}(tenant_id,id,revision,payload) VALUES(${bind(1)},${bind(2)},1,${bind(3)})`, [p.tenantId, physicalId(id), payload])
       : await conn.execute(`UPDATE ${table} SET revision=${bind(1)},payload=${bind(2)} WHERE tenant_id=${bind(3)} AND id=${bind(4)} AND revision=${bind(5)}`, [expected + 1, payload, p.tenantId, physicalId(id), expected])
      if (r.affectedRows !== 1) throw new PluginError(409, 'Record revision changed')
     } catch (e: any) {
      if (['SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE', '23505', 'ORA-00001'].includes(e?.code) || e?.errorNum === 1) throw new PluginError(409, 'Record already exists')
      throw e
     }
     return { id, revision: expected + 1, value: structuredClone(value) }
    },
   }
   joinedConnections.set(session, {connection:conn,principal:p,dialect:driver.dialect})
   try { return await work(session) } finally { active = false; joinedConnections.delete(session) }
  })
 } }
}

/**
 * Adapt one active atomic session to the standard record-store boundary for exactly one tenant.
 * @param session - Live session obtained inside repository.run.
 * @param principal - Verified principal defining the only admitted tenant.
 * @typeParam T - JSON payload shape retained by the adapted store.
 * @returns A read/list/listPage/create/replace store backed by that same session.
 * @throws Malformed principals throw immediately; foreign tenant, invalid revision transitions or expired/CAS session failures reject operations.
 * @remarks Does not begin or commit a transaction and does not expose deletion. Replacement conflicts reject rather than returning false.
 * @example
 * import { createAtomicRecordStore, type AtomicRepository, type PluginPrincipal } from '@alneas/eaos-server/plugin-data'
 * export function readRecord<T>(repository: AtomicRepository, principal: PluginPrincipal, id: string) {
 *  return repository.run(principal, session => createAtomicRecordStore<T>(session, principal).read(principal.tenantId, id))
 * }
 */
export function createAtomicRecordStore<T>(session: AtomicSession, principal: PluginPrincipal): PluginRecordStore<T> {
 assertPrincipal(principal)
 const tenantId = principal.tenantId
 const scope = (requested: string) => { if (requested !== tenantId) throw new PluginError(403, 'Atomic record tenant differs') }
 return {
  read: async (requested, id) => { scope(requested); return session.get<T>(id) },
  list: async (requested, limit) => { scope(requested); return session.list<T>('', '', limit) },
  listPage: async (requested, limit, after = '') => { scope(requested); return session.list<T>('', after, limit) },
  create: async (requested, record) => { scope(requested); if (record.revision !== 1) throw new PluginError(400, 'Invalid initial record revision'); await session.put(record.id, record.value, 0) },
  replace: async (requested, record, expected) => { scope(requested); if (record.revision !== expected + 1) throw new PluginError(400, 'Invalid next record revision'); await session.put(record.id, record.value, expected); return true },
 }
}

/**
 * Resolve manifest storage metadata to an atomic repository with canonical document enforcement.
 * @param manifest - Trusted schema with shared-storage binding or exactly one owned table.
 * @param driver - Trusted transactional SQL driver.
 * @param catalog - Required Data Contract catalog when shared storage is declared.
 * @returns Atomic repository for the manifest-selected table/namespace.
 * @throws Rejects absent/mismatched catalogs, ambiguous owned tables or invalid repository bindings.
 * @remarks Does not install/enable storage contracts; host lifecycle and admission are separate.
 * @example
 * import { createPluginAtomicRepository } from '@alneas/eaos-server/plugin-data'
 * export function repository(manifest: Parameters<typeof createPluginAtomicRepository>[0], driver: Parameters<typeof createPluginAtomicRepository>[1], catalog: Parameters<typeof createPluginAtomicRepository>[2]) { return createPluginAtomicRepository(manifest, driver, catalog) }
 */
export function createPluginAtomicRepository(manifest: Pick<PluginManifest, 'schema'>, driver: AtomicSqlDriver, catalog?: DataContractCatalog): AtomicRepository {
 const storage = manifest.schema.storage
 if (storage) { if (!catalog) throw Error('Contract-backed record storage requires a trusted schema catalog'); const documents = recordDocuments(catalog, storage); return createAtomicRepository(storage.table, driver, { namespace: storage.namespace, storagePolicy: manifest.schema.storagePolicy, ...(documents?.length ? { documents } : {}) }) }
 if (manifest.schema.ownedTables.length !== 1) throw new Error('Plugin manifest must declare one storage table or shared storage metadata')
 return createAtomicRepository(manifest.schema.ownedTables[0]!, driver, { storagePolicy: manifest.schema.storagePolicy })
}

/**
 * Structural synchronous SQLite database API; lifecycle and physical migrations remain host-owned.
 * 
 *
 * Structural Bun SQLite connection. The host owns the database and migration application.
 * @see createSqliteAtomicDriver for canonical host integration.
 */
export interface SqliteAtomicDatabase {
  /**
   * Executes trusted SQLite control SQL on the host-owned connection.
   * @param sql - Trusted transaction/control SQL text.
   * @returns The native database execution result.
   * @throws SQLite control failures throw synchronously.
   
   * @example
   * ```typescript
   * import type { SqliteAtomicDatabase } from '@alneas/eaos-server/plugin-data';
   * export function enforceForeignKeys(db: SqliteAtomicDatabase) {
   *   db.exec("PRAGMA foreign_keys = ON");
   * }
   * ```
   */
  exec(sql: string): unknown
  /**
   * Prepares trusted parameterized SQLite SQL on the host-owned connection.
   * @param sql - Trusted SQL text with explicit tenant predicates.
   * @returns A statement exposing synchronous all/run methods.
   * @throws Preparation errors throw synchronously.
   
   * @example
   * ```typescript
   * import type { SqliteAtomicDatabase } from '@alneas/eaos-server/plugin-data';
   * export function tenantProjection(db: SqliteAtomicDatabase, tenantId: string) {
   *   return db.query("SELECT ? AS tenant_id").all(tenantId);
   * }
   * ```
   */
  query(sql: string): { 
    /**
     * Synchronously execute the prepared query with positional values and return all rows.
     * @param values - Positional prepared-statement values.
     * @returns All prepared-query rows in provider order.
     * @throws Provider execution/binding errors throw synchronously.
     
     * @example
     * ```typescript
     * import type { SqliteAtomicDatabase } from '@alneas/eaos-server/plugin-data';
     * export function projectedRows(db: SqliteAtomicDatabase, tenantId: string) {
     *   const statement = db.query("SELECT ? AS tenant_id");
     *   return statement.all(tenantId);
     * }
     * ```
     */
    all(...values: any[]): unknown[]; 
    /**
     * Synchronously execute the prepared DML with positional values and return its change count.
     * @param values - Positional prepared-statement values.
     * @returns Native DML change-count metadata.
     * @throws Provider execution/binding errors throw synchronously.
     
     * @example
     * ```typescript
     * import type { SqliteAtomicDatabase } from '@alneas/eaos-server/plugin-data';
     * export function executeReviewed(db: SqliteAtomicDatabase, trustedTenantDml: string, bindings: unknown[]) {
     *   return db.query(trustedTenantDml).run(...bindings).changes;
     * }
     * ```
     */
    run(...values: any[]): { 
      /**
       * Number of rows affected by this prepared DML execution.
       */
      changes: number } }
}
/**
 * Serialize BEGIN IMMEDIATE transactions on a host-owned SQLite connection.
 * @param db - Structural SQLite database whose schema and connection lifetime are owned by the host.
 * @returns SQLite transaction driver with one connection-local promise queue.
 * @throws BEGIN/statement/COMMIT/ROLLBACK errors and callback failures reject; a rollback failure can replace the original error.
 * @remarks Queueing is per driver instance, not cross-process coordination. Do not nest repository transactions on the same connection; close the database only after all operations finish.
 * @example
 * import { createSqliteAtomicDriver } from '@alneas/eaos-server/plugin-data'
 * export function driver(db: Parameters<typeof createSqliteAtomicDriver>[0]) { return createSqliteAtomicDriver(db) }
 */
export function createSqliteAtomicDriver(db: SqliteAtomicDatabase): AtomicSqlDriver {
 let tail: Promise<unknown> = Promise.resolve()
 return { dialect: 'sqlite', transaction<T>(_p: PluginPrincipal, work: (conn: AtomicSqlConnection) => Promise<T>) {
  const next = tail.then(async () => {
   db.exec('BEGIN IMMEDIATE')
   try {
    const result = await work({ async execute(sql, binds) { const q = db.query(sql); return /^SELECT\b/i.test(sql) ? { rows: q.all(...binds) as Record<string, unknown>[], affectedRows: 0 } : { affectedRows: q.run(...binds).changes } } })
    db.exec('COMMIT'); return result
   } catch (e) { db.exec('ROLLBACK'); throw e }
  })
  tail = next.catch(() => undefined); return next
 } }
}

/**
 * Host Oracle connection subset used with autocommit disabled and explicit commit/rollback.
 * 
 * @see createOracleAtomicDriver for canonical host integration.
 */
export interface OracleAtomicConnection {
  /**
   * Executes one parameterized Oracle statement without autocommit.
   * @param sql - Trusted parameterized SQL.
   * @param binds - Ordered bind values, including explicit CLOB bindings for large payloads.
   * @param options - Provider options requiring autoCommit=false and object row format, with optional per-column fetch types.
   * @returns Optional object rows and rowsAffected count.
   * @throws Rejects Oracle execution/binding failures.
   
   * @example
   * ```typescript
   * import type { OracleAtomicHost, OracleAtomicConnection } from '@alneas/eaos-server/plugin-data';
   * export async function queryTenant(host: OracleAtomicHost, tenantId: string, trustedTenantSql: string, binds: unknown[], options: Parameters<OracleAtomicConnection["execute"]>[2]) {
   *   return host.withTenantConnection("PLUGIN_RECORDS", async connection => {
   *     return (await connection.execute(trustedTenantSql, binds, options)).rows ?? [];
   *   }, { tenantId });
   * }
   * ```
   */
  execute(sql: string, binds: unknown[], options: { 
    /**
     * Must be false so the host transaction explicitly commits or rolls back all joined work.
     */
    autoCommit: false; 
    /**
     * Actual Oracle object-row output constant supplied by the installed driver.
     */
    outFormat: number; 
    /**
     * Optional column-name to explicit fetch-type settings, including PAYLOAD string extraction.
     */
    fetchInfo?: Record<string, { 
      /**
       * Actual installed Oracle provider type constant; no global conversion settings are changed.
       */
      type: unknown }> }): Promise<{ 
    /**
     * Optional Oracle object rows returned by a query.
     */
    rows?: Record<string, unknown>[]; 
    /**
     * Optional scalar DML affected-row count; adapter normalizes absence to 0.
     */
    rowsAffected?: number }>
  /**
   * Executes ordered Oracle bind batches without autocommit.
   * @param sql - Trusted parameterized DML.
   * @param binds - Ordered positional bind rows.
   * @param options - Provider options requiring autoCommit=false and dmlRowCounts=true.
   * @returns Per-bind-row DML counts; adapters reject missing/invalid lengths or counts.
   * @throws Rejects Oracle batch/binding failures.
   
   * @example
   * ```typescript
   * import type { OracleAtomicHost } from '@alneas/eaos-server/plugin-data';
   * export async function batchReviewed(host: OracleAtomicHost, tenantId: string, trustedTenantDml: string, binds: unknown[][]) {
   *   return host.withTenantConnection("PLUGIN_RECORDS", async connection => {
   *     if (!connection.executeMany) throw new Error("Batch DML not supported");
   *     try {
   *       const result = await connection.executeMany(trustedTenantDml, binds, { autoCommit: false, dmlRowCounts: true });
   *       await connection.commit();
   *       return result.dmlRowCounts;
   *     } catch (error) { await connection.rollback(); throw error; }
   *   }, { tenantId });
   * }
   * ```
   */
  executeMany?(sql: string, binds: unknown[][], options: { 
    /**
     * Must be false so the host transaction explicitly commits or rolls back all joined work.
     */
    autoCommit: false; 
    /**
     * Requested per-row batch counts (true in options), or returned per-bind-row counts in the result.
     */
    dmlRowCounts: true }): Promise<{ 
    /**
     * Requested per-row batch counts (true in options), or returned per-bind-row counts in the result.
     */
    dmlRowCounts?: number[] }>
  /**
   * Explicitly commits the current Oracle transaction.
   * @returns Resolves without a value after provider commit completes.
   * @throws Rejects provider commit failure.
   
   * @example
   * ```typescript
   * import type { OracleAtomicConnection } from '@alneas/eaos-server/plugin-data';
   * export async function commitOwned(connection: OracleAtomicConnection) {
   *   // Only the owner of this transaction chooses its completion outcome.
   *   await connection.commit();
   * }
   * ```
   */
  commit(): Promise<void>;
  /**
   * Explicitly rolls back the current Oracle transaction.
   * @returns Resolves without a value after provider rollback completes.
   * @throws Rejects provider rollback failure.
   
   * @example
   * ```typescript
   * import type { OracleAtomicConnection } from '@alneas/eaos-server/plugin-data';
   * export async function rollbackOwned(connection: OracleAtomicConnection) {
   *   // Only the owner of this transaction chooses its completion outcome.
   *   await connection.rollback();
   * }
   * ```
   */
  rollback(): Promise<void>
}
/**
 * Trusted tenant Oracle connection acquisition and cleanup boundary.
 * 
 * @see createOracleAtomicDriver for canonical host integration.
 */
export interface OracleAtomicHost {
  /**
   * Acquires a verified tenant Oracle connection and cleans up its host session after work.
   * @param domain - Trusted connection domain; this adapter uses PLUGIN_RECORDS.
   * @param callback - Async work receiving the single admitted connection.
   * @param context - Verified tenant/user session context; must not come from raw request authority.
   * @typeParam T - Value resolved by the transaction/connection callback.
   * @returns The callback result after host session cleanup and connection release.
   * @throws Rejects acquisition, admission, callback or cleanup failures.
   
   * @example
   * ```typescript
   * import type { OracleAtomicHost } from '@alneas/eaos-server/plugin-data';
   * export async function inspectTenant(host: OracleAtomicHost, tenantId: string, userId: string, inspect: (connection: Parameters<Parameters<OracleAtomicHost["withTenantConnection"]>[1]>[0]) => Promise<unknown>) {
   *   return host.withTenantConnection("PLUGIN_RECORDS", inspect, { tenantId, userId });
   * }
   * ```
   */
  withTenantConnection<T>(domain: string, callback: (connection: OracleAtomicConnection) => Promise<T>, context: { 
    /**
     * Verified concrete tenant admitted by the host session boundary.
     */
    tenantId: string; 
    /**
     * Optional verified actor ID attached to the Oracle session.
     */
    userId?: string }): Promise<T>
}
/**
 * Run atomic envelope SQL on a host-provided tenant Oracle connection with explicit commit/rollback.
 * @param host - Trusted connection provider admitting PLUGIN_RECORDS operations for the verified tenant/user.
 * @param types - Actual Oracle object-format/string/CLOB constants; no global provider settings are changed.
 * @returns Oracle transaction driver with optional batch execution and scalar fallback for large strings.
 * @throws Connection/statement/commit/rollback errors and invalid batch row counts reject; rollback failures may replace the original failure.
 * @remarks Host owns session authorization, tenant cleanup and connection release. Strings over 4000 characters use explicit CLOB bindings; no production connection is opened at construction.
 * @example
 * import { createOracleAtomicDriver } from '@alneas/eaos-server/plugin-data'
 * export function driver(host: Parameters<typeof createOracleAtomicDriver>[0], types: Parameters<typeof createOracleAtomicDriver>[1]) { return createOracleAtomicDriver(host, types) }
 */
export function createOracleAtomicDriver(host: OracleAtomicHost, types: { 
  /**
   * Actual installed Oracle object-row output format constant.
   */
  objectFormat: number; 
  /**
   * Actual Oracle string fetch type for JSON PAYLOAD extraction.
   */
  stringType: unknown; 
  /**
   * Actual Oracle CLOB type used for strings longer than 4000 characters.
   */
  clobType: unknown }): AtomicSqlDriver {
 return { dialect: 'oracle', transaction: (p, work) => host.withTenantConnection('PLUGIN_RECORDS', async conn => {
  try {
   const execute: AtomicSqlConnection['execute'] = async (sql, binds) => {
    const r = await conn.execute(sql, binds.map(value => typeof value === 'string' && value.length > 4000 ? { val: value, type: types.clobType } : value), { autoCommit: false, outFormat: types.objectFormat, ...(/^SELECT\b/i.test(sql) ? { fetchInfo: { PAYLOAD: { type: types.stringType } } } : {}) })
    return { rows: r.rows, affectedRows: r.rowsAffected ?? 0 }
   }
   const result = await work({ execute, ...(conn.executeMany ? { async executeMany(sql: string, binds: unknown[][]) {
    // Large JSON uses the established scalar CLOB bindings instead of inferred batch string types.
    if (binds.some(row => row.some(value => typeof value === 'string' && value.length > 4000))) {
     const affectedRows: number[] = []
     for (const row of binds) affectedRows.push((await execute(sql, row)).affectedRows)
     return { affectedRows }
    }
    const result = await conn.executeMany!(sql, binds, { autoCommit: false, dmlRowCounts: true })
    if (!Array.isArray(result.dmlRowCounts) || result.dmlRowCounts.length !== binds.length || result.dmlRowCounts.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('Oracle batch did not return valid row counts')
    return { affectedRows: result.dmlRowCounts }
   } } : {}) })
   await conn.commit(); return result
  } catch (e) { await conn.rollback(); throw e }
 }, { tenantId: p.tenantId, userId: p.userId }) }
}
