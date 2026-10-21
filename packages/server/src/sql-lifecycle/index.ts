import { randomUUID } from 'node:crypto'
import { emptyLifecycleState, normalizeLifecycleState, type LifecycleStore, type LifecycleWriter, type LifecycleState, type Dialect } from '@alneas/eaos-server/lifecycle-engine'
/**
 * Privileged primary SQL connection used by {@link SqlLifecycleStore}; it is not a tenant data adapter.
 */
export interface ControlSqlDriver {
 /** SQL placeholder/schema dialect. */
 dialect: Dialect
 /** Outside an explicit withAtomicLock transaction, each write must commit before resolving. Reads must use the primary, never a lagging replica.
  * Bind arrays are positional; Oracle payloads must be bound/read as CLOB strings.
  * This is a privileged control DB connection, NOT a tenant data connection.
  * @param sql - Statement supplied by the lifecycle store.
  * @param bindings - Positional values, using the selected dialect placeholders.
  * @returns Optional rows and affectedRows; lock/update statements require affectedRows exactly reflecting the write count.
  * @throws Driver/database failures reject the store operation.
  
  * @example
  * ```typescript
  * import type { ControlSqlDriver } from "@alneas/eaos-server/sql-lifecycle";
  * export async function probePrimaryControlConnection(driver: ControlSqlDriver) {
  *   // Use a host-owned primary control connection, not a tenant adapter or replica.
  *   const sql = driver.dialect === "oracle" ? "SELECT 1 AS ready FROM dual" : "SELECT 1 AS ready";
  *   const result = await driver.execute(sql, []);
  *   return result.rows ?? [];
  * }
  * ```
  */
 execute(sql: string, bindings: unknown[]): Promise<{ 
  /** Optional primary-database result rows for read statements; column names and CLOB decoding follow the connected SQL driver contract. */
  rows?: Record<string, unknown>[]; 
  /** Optional exact write count; lifecycle lock/CAS/update paths require it and reject missing or unexpected counts rather than assuming success. */
  affectedRows?: number }>
}
/**
 * Provides explicit baseline CREATE TABLE statements for the shared lifecycle ledger in each dialect.
 * @remarks No SQL executes on import or construction. Review and apply the selected baseline separately before initialize.
 * @see SqlLifecycleStore for host driver requirements.
 */
export const controlSchemaSql: Record<Dialect, string[]> = {
 sqlite: ['CREATE TABLE eaos_lifecycle_state (control_id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, writer_token TEXT)'],
 postgres: ['CREATE TABLE eaos_lifecycle_state (control_id VARCHAR(128) PRIMARY KEY, revision BIGINT NOT NULL, payload TEXT NOT NULL, writer_token VARCHAR(36))'],
 oracle: ['CREATE TABLE eaos_lifecycle_state (control_id VARCHAR2(128) PRIMARY KEY, revision NUMBER(19) NOT NULL, payload CLOB NOT NULL CHECK (payload IS JSON), writer_token VARCHAR2(36))'],
}
function valid(state: LifecycleState): void {
 if (!state || state.format !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || ['backends', 'installations', 'activations', 'migrations', 'infrastructure', 'platform'].some(k => !(state as any)[k] || typeof (state as any)[k] !== 'object' || Array.isArray((state as any)[k]))) throw new Error('Corrupt lifecycle state')
}
/**
 * Persists lifecycle state with durable writer-token exclusion and revision-checked updates across hosts.
 * @remarks Apply reviewed controlSchemaSql before initialize. Host connections must read the primary and report affectedRows. Locks do not expire; a crashed writer requires operator reconciliation. Normal callback failures attempt token release; database outcomes can be uncertain if commit or cleanup fails. No connection is opened or disposed by this store.
 * @example
 * ```typescript
 * import { SqlLifecycleStore, type ControlSqlDriver } from "@alneas/eaos-server/sql-lifecycle";
 * export async function example(driver: ControlSqlDriver, controlId: string) {
 *   const store = new SqlLifecycleStore(driver, controlId);
 *   await store.initialize();
 *   return store.read();
 * }
 * ```
 */
export class SqlLifecycleStore implements LifecycleStore {
 /**
  * Captures a privileged host SQL driver and ledger identifier without executing SQL.
  * @param driver - Primary control-plane driver; connection lifecycle remains host-owned.
  * @param controlId - Alphanumeric-first scope ID containing letters/digits/underscore/hyphen, length 1–128.
  * @throws If controlId fails validation.
  */
 constructor(private readonly driver: ControlSqlDriver, private readonly controlId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(controlId)) throw new Error('Invalid control ID')
 }
 private b(i: number) { return this.driver.dialect === 'postgres' ? `$${i}` : this.driver.dialect === 'oracle' ? `:${i}` : '?' }
 private async row() {
  const result = await this.driver.execute(`SELECT revision, payload FROM eaos_lifecycle_state WHERE control_id = ${this.b(1)}`, [this.controlId])
  return result.rows?.[0]
 }
 private decode(row: Record<string, unknown>): LifecycleState {
  const state = normalizeLifecycleState(JSON.parse(String(row.payload ?? row.PAYLOAD)) as LifecycleState); valid(state)
  if (state.revision !== Number(row.revision ?? row.REVISION)) throw new Error('Lifecycle revision mismatch')
  return state
 }
 /**
 * Bootstraps an empty ledger row after reviewed schema application, preserving an existing valid ledger.
 * @returns No value; resolves after existing-state validation or insertion, including a recognized concurrent duplicate-insert race.
 * @throws Rejects schema/driver failures or corrupt existing state.
 * @example
 * ```typescript
 * import { SqlLifecycleStore, type ControlSqlDriver } from "@alneas/eaos-server/sql-lifecycle";
 * export async function example(driver: ControlSqlDriver, controlId: string) {
 *   const store = new SqlLifecycleStore(driver, controlId);
 *   await store.initialize();
 * }
 * ```
 */
 async initialize(): Promise<void> {
  const existing = await this.row(); if (existing) { this.decode(existing); return }
  try { await this.driver.execute(`INSERT INTO eaos_lifecycle_state (control_id, revision, payload, writer_token) VALUES (${this.b(1)}, ${this.b(2)}, ${this.b(3)}, NULL)`, [this.controlId, 0, JSON.stringify(emptyLifecycleState())]) }
  catch (error: any) {
   if (!['23505', 'SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE', 'ORA-00001'].includes(error?.code) && error?.errorNum !== 1) throw error
   await this.read()
  }
 }
 /**
  * Reads and validates the primary control ledger and its revision.
  * @returns Normalized lifecycle state decoded from the driver row.
  * @throws Rejects missing initialization, corrupt JSON/state, revision mismatch, or SQL failures.
  * @example
  * ```typescript
  * import { SqlLifecycleStore, type ControlSqlDriver } from "@alneas/eaos-server/sql-lifecycle";
  * export async function example(driver: ControlSqlDriver, controlId: string) {
  *   const store = new SqlLifecycleStore(driver, controlId);
  *   return store.read();
  * }
  * ```
  */
 async read() { const row = await this.row(); if (!row) throw new Error('Control store is not initialized'); return this.decode(row) }
 private async update(sql: string, bindings: unknown[]) {
  const result = await this.driver.execute(sql, bindings)
  if (typeof result.affectedRows !== 'number') throw new Error('Control driver must report affectedRows')
  return result.affectedRows === 1
 }
 /**
  * Runs lifecycle read/write work under a durably committed exclusive writer token.
  * @typeParam T - Callback result forwarded after lock cleanup.
  * @param fn - Receives a writer; each write must advance revision exactly once and is independently committed by the driver.
  * @returns The callback result after token release; writes made before callback failure are not rolled back by this method.
  * @throws Rejects locked/uninitialized state, invalid revision, lost lock, callback/driver failures, or cleanup failure; combined operation/cleanup errors use AggregateError.
  * @remarks No wait, expiry, or retry is supplied. Never nest locks. For atomic host records plus ledger updates use withAtomicLock instead.
  * @example
  * ```typescript
  * import { SqlLifecycleStore, type ControlSqlDriver } from "@alneas/eaos-server/sql-lifecycle";
  * export async function example(driver: ControlSqlDriver, controlId: string) {
  *   const store = new SqlLifecycleStore(driver, controlId);
  *   return store.withLock(async writer => writer.read());
  * }
  * ```
  */
 async withLock<T>(fn: (writer: LifecycleWriter) => Promise<T>): Promise<T> {
  return this.withLockedDriver(async operation => operation(this.driver), fn)
 }
 /** Hold a durably committed writer token while atomically committing lifecycle state and host records.
  * The host transaction must use one primary connection, commit before resolving, and roll back on rejection.
  * Transaction-scoped driver writes are deliberately uncommitted until the callback finishes.
  * Never use this for DDL, remote effects or nested locks; a crashed writer still requires reconciliation.
  * @typeParam T - Callback result forwarded after transaction completion and token cleanup.
  * @param transaction - Host transaction wrapper receiving a driver callback; use one primary connection, commit before resolving, and roll back on rejection.
  * @param fn - Receives a lifecycle writer and the same transaction driver; await all work and advance ledger revision exactly once per write.
  * @returns The callback result after the host transaction commits and the durable writer token is released.
  * @throws Rejects acquisition, revision/lock, callback, transaction, or cleanup failures; combined operation/cleanup failures use AggregateError.
  * @remarks The token is acquired outside the host transaction and is released separately. Transaction rollback and commit uncertainty depend on the host adapter; reconcile uncertain outcomes.
  * @example
  * ```typescript
  * import { SqlLifecycleStore, type ControlSqlDriver } from "@alneas/eaos-server/sql-lifecycle";
  * export async function example(driver: ControlSqlDriver, controlId: string, transaction: Parameters<SqlLifecycleStore["withAtomicLock"]>[0]) {
  *   const store = new SqlLifecycleStore(driver, controlId);
  *   // Supply a real single-primary-connection host transaction wrapper.
  *   return store.withAtomicLock(transaction, async writer => writer.read());
  * }
  * ```
  */
 async withAtomicLock<T>(transaction: <R>(fn: (driver: ControlSqlDriver) => Promise<R>) => Promise<R>, fn: (writer: LifecycleWriter, driver: ControlSqlDriver) => Promise<T>): Promise<T> {
  return this.withLockedDriver(transaction, fn)
 }
 private async withLockedDriver<T>(transaction: <R>(fn: (driver: ControlSqlDriver) => Promise<R>) => Promise<R>, fn: (writer: LifecycleWriter, driver: ControlSqlDriver) => Promise<T>): Promise<T> {
  const token = randomUUID()
  if (!await this.update(`UPDATE eaos_lifecycle_state SET writer_token = ${this.b(1)} WHERE control_id = ${this.b(2)} AND writer_token IS NULL`, [token, this.controlId])) throw new Error('Control writer is locked or uninitialized; reconcile crashed operations before recovery')
  let failure: unknown
  try {
   return await transaction(async driver => {
   const read = () => new SqlLifecycleStore(driver, this.controlId).read()
   let expected = (await read()).revision
   return await fn({ read, write: async state => {
    valid(state)
    if (state.revision !== expected + 1) throw new Error('Invalid lifecycle revision transition')
    const result = await driver.execute(`UPDATE eaos_lifecycle_state SET revision = ${this.b(1)}, payload = ${this.b(2)} WHERE control_id = ${this.b(3)} AND writer_token = ${this.b(4)} AND revision = ${this.b(5)}`, [state.revision, JSON.stringify(state), this.controlId, token, expected])
    if (result.affectedRows !== 1) throw new Error('Lifecycle writer lost its lock or revision')
    expected = state.revision
   } }, driver)
   })
  } catch (error) { failure = error; throw error }
  finally {
   /* eslint-disable no-unsafe-finally -- Cleanup failure must reject success; preserve both errors in AggregateError. */
   try {
    if (!await this.update(`UPDATE eaos_lifecycle_state SET writer_token = NULL WHERE control_id = ${this.b(1)} AND writer_token = ${this.b(2)}`, [this.controlId, token])) {
     // biome-ignore lint/correctness/noUnsafeFinally: Cleanup failure must reject success; the catch below preserves the original operation failure.
     throw new Error('Lifecycle lock release failed')
    }
   }
   // eslint-disable-next-line preserve-caught-error -- AggregateError.errors already retains the caught error and operation failure.
   catch (error) {
    if (failure) {
     // biome-ignore lint/correctness/noUnsafeFinally: Both operation and cleanup failures are retained in AggregateError.errors.
     throw new AggregateError([failure, error], 'Operation and lock cleanup failed; reconcile control state')
    }
    // biome-ignore lint/correctness/noUnsafeFinally: A cleanup failure must reject an otherwise successful operation.
    throw error
   }
   /* eslint-enable no-unsafe-finally */
  }
 }
}
