/**
 * @fileoverview Local-First SQLite DataAccessAdapter with Adaptive Sync & WAL Lock Prevention
 *
 * Implements @alneas/appkit-core DataAccessAdapter interface.
 * - Reads/writes locally to SQLite before attempting remote delivery.
 * - Configures SQLite WAL mode, NORMAL synchronous, and busy_timeout to prevent DB locking.
 * - Records mutations in an outbox queue (_outbox_queue) with pre-change snapshots for attempted rollback after permanent delivery failure.
 * - Tracks user access frequency (_access_frequency) to adaptively sync frequently used collections.
 * - Pulls remote incremental changes from an ORA_ROWSCN-capable upstream within batch transactions.
 * - Handles window focus & network online lifecycle hooks for seamless just-in-time synchronization.
 *
 * @module db/local-first-sqlite-adapter
 */

import type {
  DataAccessAdapter,
  Filter,
  QueryOptions,
} from '@alneas/appkit-core/data/types';

/**
 * Host SQLite operations required by {@link LocalFirstSqliteAdapter}; execution and transaction ownership belong to the host.
 */
export interface SqliteDriver {
  /**
   * Executes SQLite SQL with positional bindings.
   * @param sql - SQL statement, including transaction control statements.
   * @param params - Positional values for question-mark placeholders; omitted for parameterless SQL.
   * @returns Driver-specific execution result, which the adapter does not inspect.
   * @throws Rejects on driver/database failure; callers determine rollback handling.
   
   * @example
   * ```typescript
   * import type { SqliteDriver } from "@alneas/eaos-server/db";
   * export async function inspectConnectedSqlite(driver: SqliteDriver) {
   *   // The host opens and closes the connection; this statement changes no records.
   *   return await driver.execute("SELECT 1 AS ready", []);
   * }
   * ```
   */
  execute(sql: string, params?: any[]): Promise<any>;
  /**
   * Selects SQLite rows using positional bindings.
   * @typeParam T - Row shape expected by the caller; the driver does not establish runtime validation.
   * @param sql - SELECT statement.
   * @param params - Positional values, or omitted for parameterless queries.
   * @returns Matching rows, or an empty array.
   * @throws Rejects on driver/database failure.
   
   * @example
   * ```typescript
   * import type { SqliteDriver } from "@alneas/eaos-server/db";
   * export async function selectConnectedSqlite(driver: SqliteDriver) {
   *   const rows = await driver.select<{ ready: number }>("SELECT 1 AS ready", []);
   *   return rows[0]?.ready; // The type argument does not perform runtime validation.
   * }
   * ```
   */
  select<T = any>(sql: string, params?: any[]): Promise<T[]>;
}

/**
 * Local outbox lifecycle status; successfully synchronized rows are removed by processOutbox.
 * @see LocalFirstSqliteAdapter.processOutbox.
 */
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

/**
 * Local mutation and rollback snapshot awaiting upstream synchronization.
 * @see LocalFirstSqliteAdapter.processOutbox.
 */
export interface OutboxItem {
  /** Outbox row identifier. */
  id: string;
  /** Target local/upstream table. */
  tableName: string;
  /** Mutation record identifier. */
  recordId: string;
  /** INSERT, UPDATE, or DELETE operation forwarded upstream. */
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  /** Mutation data; update retains only the supplied changes. */
  payload: Record<string, any>;
  /** Optional pre-mutation row used for rollback; null for inserts or missing snapshots. */
  previousState?: Record<string, any> | null;
  /** Persisted synchronization state. */
  status: SyncStatus;
  /** Optional most recent persisted error description. */
  errorMessage?: string;
  /** Number of recognized transient failures recorded so far. */
  retryCount: number;
  /** ISO creation timestamp used for batch ordering. */
  createdAt: string;
}

/**
 * Permanent synchronization failure notification emitted after local rollback handling.
 * @see LocalFirstSqliteAdapterOptions.onSyncError.
 */
export interface SyncErrorEvent {
  /** Outbox item whose permanent failure caused rollback handling. */
  item: OutboxItem;
  /** Underlying synchronization failure. */
  error: Error;
  /** True when rollback handling reached the callback; it is not a remote rollback guarantee. */
  rolledBack: boolean;
}

/**
 * Per-table local counters used to rank adaptive synchronization candidates.
 * @see LocalFirstSqliteAdapter.recordAccess.
 */
export interface AccessFrequencyRecord {
  /** Tracked collection identifier. */
  table_name: string;
  /** Accumulated read count. */
  read_count: number;
  /** Accumulated write count. */
  write_count: number;
  /** ISO timestamp of the most recently recorded access. */
  last_accessed_at: string;
}

/**
 * Host drivers, sync behavior, and cleanup-sensitive scheduling for {@link LocalFirstSqliteAdapter}.
 */
export interface LocalFirstSqliteAdapterOptions {
  /** SQLite driver instance */
  sqlite: SqliteDriver;
  /** Cloud upstream adapter (e.g. OracleOrdsAdapter / SupabaseAdapter) */
  upstream: DataAccessAdapter;
  /** Optional tenant_id default added only on create when neither tenant_id nor tenantId is supplied; this does not scope reads, updates, deletes, or upstream access. Host authorization remains required. */
  tenantId?: string;
  /** Essential master tables that are always synchronized (Tier 1) */
  essentialTables?: string[];
  /** Callback fired when an outbox sync fails permanently and triggers a rollback */
  onSyncError?: (event: SyncErrorEvent) => void;
  /** Outbox polling interval in milliseconds. Zero disables polling; other falsy values fall back to 5000. @defaultValue 5000 */
  syncIntervalMs?: number;
  /** Whether to immediately trigger background sync after local mutation (default: true) */
  autoSyncOnMutation?: boolean;
  /** Whether to attach window focus / online event listeners (default: true if in browser/tauri) */
  enableLifecycleSync?: boolean;
}

/**
 * Persists local mutations and an outbox, then synchronizes with a host-provided upstream adapter.
 * @remarks Call initSchema before use; it creates metadata only, so provision domain tables separately. Local mutation and outbox insertion are separate writes, so failure may leave an unqueued local change. No tenant authorization is implemented: tenantId is only a create default. Serialize transaction-sensitive operations on the host driver; processOutbox excludes overlapping calls on this instance only. Call destroy to remove timers/listeners; it does not cancel in-flight work or close either driver.
 * @example
 * ```typescript
 * import { LocalFirstSqliteAdapter, type LocalFirstSqliteAdapterOptions } from "@alneas/eaos-server/db/local-first-sqlite-adapter";
 * export async function example(options: LocalFirstSqliteAdapterOptions) {
 *   // The host supplies an initialized domain schema and authorized upstream adapter.
 *   const adapter = new LocalFirstSqliteAdapter({ ...options, syncIntervalMs: 0, enableLifecycleSync: false });
 *   try {
 *     await adapter.initSchema();
 *     return await adapter.find("records");
 *   } finally { adapter.destroy(); }
 * }
 * ```
 */
export class LocalFirstSqliteAdapter implements DataAccessAdapter {
  /** Optional create-time tenant_id fallback captured from options; not a read or mutation authorization filter. */
  readonly tenantId?: string;
  private sqlite: SqliteDriver;
  private upstream: DataAccessAdapter;
  private onSyncError?: (event: SyncErrorEvent) => void;
  private autoSyncOnMutation: boolean;
  private essentialTables: Set<string>;
  private syncTimer: any = null;
  private isSyncing = false;
  private cleanupListeners?: () => void;

  /**
   * Captures drivers and starts optional outbox polling and browser lifecycle listeners.
   * @param options - Host drivers and synchronization settings; see {@link LocalFirstSqliteAdapterOptions}.
   * @remarks The constructor performs no schema initialization. Timers/listeners start immediately unless disabled; call destroy when the instance is no longer needed.
   */
  constructor(options: LocalFirstSqliteAdapterOptions) {
    this.tenantId = options.tenantId;
    this.sqlite = options.sqlite;
    this.upstream = options.upstream;
    this.onSyncError = options.onSyncError;
    this.autoSyncOnMutation = options.autoSyncOnMutation !== false;
    this.essentialTables = new Set(options.essentialTables ?? []);

    if (options.syncIntervalMs !== 0) {
      const interval = options.syncIntervalMs || 5000;
      if (typeof setInterval !== 'undefined') {
        this.syncTimer = setInterval(() => this.processOutbox(), interval);
      }
    }

    if (options.enableLifecycleSync !== false && typeof window !== 'undefined') {
      this.attachLifecycleListeners();
    }
  }

  /**
   * Initializes SQLite synchronization metadata tables and attempts WAL, NORMAL, and 5000 ms busy-timeout pragmas.
   * @returns No value; resolves after metadata table creation. Pragma failures are deliberately ignored.
   * @throws Rejects metadata table creation failures; earlier tables may already exist.
   * @example
   * ```typescript
   * import { LocalFirstSqliteAdapter, type LocalFirstSqliteAdapterOptions } from "@alneas/eaos-server/db/local-first-sqlite-adapter";
   * export async function example(options: LocalFirstSqliteAdapterOptions) {
   *   // The host supplies an initialized domain schema and authorized upstream adapter.
   *   const adapter = new LocalFirstSqliteAdapter({ ...options, syncIntervalMs: 0, enableLifecycleSync: false });
   *   try {
   *     await adapter.initSchema();
   *     await adapter.initSchema();
   *   } finally { adapter.destroy(); }
   * }
   * ```
   */
  async initSchema(): Promise<void> {
    // 1. Anti-locking & Concurrency Optimization
    try {
      await this.sqlite.execute(`PRAGMA journal_mode = WAL;`);
      await this.sqlite.execute(`PRAGMA synchronous = NORMAL;`);
      await this.sqlite.execute(`PRAGMA busy_timeout = 5000;`);
    } catch {
      // Ignored if in-memory mock or non-file driver
    }

    // 2. Metadata Tables
    await this.sqlite.execute(`
      CREATE TABLE IF NOT EXISTS _sync_meta (
        table_name TEXT PRIMARY KEY,
        last_sync_scn INTEGER NOT NULL DEFAULT 0,
        last_sync_at TEXT NOT NULL
      );
    `);

    await this.sqlite.execute(`
      CREATE TABLE IF NOT EXISTS _outbox_queue (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL,
        previous_state TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);

    await this.sqlite.execute(`
      CREATE TABLE IF NOT EXISTS _access_frequency (
        table_name TEXT PRIMARY KEY,
        read_count INTEGER NOT NULL DEFAULT 0,
        write_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TEXT NOT NULL
      );
    `);
  }

  /**
   * Attaches window focus & network online hooks to trigger synchronization at user activity moments.
   */
  private attachLifecycleListeners(): void {
    const handleFocusOrOnline = () => {
      // 1. Flush any pending mutations
      this.processOutbox().catch(() => {});
      // 2. Sync frequently accessed & essential tables
      this.syncActiveTables().catch(() => {});
    };

    window.addEventListener('focus', handleFocusOrOnline);
    window.addEventListener('online', handleFocusOrOnline);

    this.cleanupListeners = () => {
      window.removeEventListener('focus', handleFocusOrOnline);
      window.removeEventListener('online', handleFocusOrOnline);
    };
  }

  /**
   * Increments a table read or write counter and records the current ISO timestamp.
   * @param collection - Table name recorded as a metadata value.
   * @param type - Counter to increment; read contributes weight 2 and write weight 5 in adaptive ranking.
   * @returns No value; resolves after the counter upsert.
   * @throws Rejects SQLite failures.
   * @example
   * ```typescript
   * import { LocalFirstSqliteAdapter, type LocalFirstSqliteAdapterOptions } from "@alneas/eaos-server/db/local-first-sqlite-adapter";
   * export async function example(options: LocalFirstSqliteAdapterOptions) {
   *   // The host supplies an initialized domain schema and authorized upstream adapter.
   *   const adapter = new LocalFirstSqliteAdapter({ ...options, syncIntervalMs: 0, enableLifecycleSync: false });
   *   try {
   *     await adapter.initSchema();
   *     await adapter.recordAccess("records", "read");
   *   } finally { adapter.destroy(); }
   * }
   * ```
   */
  async recordAccess(collection: string, type: 'read' | 'write'): Promise<void> {
    const now = new Date().toISOString();
    const readIncrement = type === 'read' ? 1 : 0;
    const writeIncrement = type === 'write' ? 1 : 0;

    await this.sqlite.execute(
      `INSERT INTO _access_frequency (table_name, read_count, write_count, last_accessed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(table_name) DO UPDATE SET
         read_count = _access_frequency.read_count + excluded.read_count,
         write_count = _access_frequency.write_count + excluded.write_count,
         last_accessed_at = excluded.last_accessed_at`,
      [collection, readIncrement, writeIncrement, now]
    );
  }

  /**
   * Pulls every essential table plus the highest weighted access-frequency tables sequentially.
   * @param limit - Maximum frequency-ranked tables selected in addition to essential tables; defaults to 8 and is passed to SQLite without additional validation.
   * @returns Names whose pullChanges calls completed, including tables with no new rows; failed tables are warned and omitted.
   * @throws Rejects the initial frequency query failure; individual pull failures are caught.
   * @example
   * ```typescript
   * import { LocalFirstSqliteAdapter, type LocalFirstSqliteAdapterOptions } from "@alneas/eaos-server/db/local-first-sqlite-adapter";
   * export async function example(options: LocalFirstSqliteAdapterOptions) {
   *   // The host supplies an initialized domain schema and authorized upstream adapter.
   *   const adapter = new LocalFirstSqliteAdapter({ ...options, syncIntervalMs: 0, enableLifecycleSync: false });
   *   try {
   *     await adapter.initSchema();
   *     return await adapter.syncActiveTables(8);
   *   } finally { adapter.destroy(); }
   * }
   * ```
   */
  async syncActiveTables(limit: number = 8): Promise<string[]> {
    // 1. Get top accessed tables from frequency tracker
    const frequent = await this.sqlite.select<{ table_name: string }>(
      `SELECT table_name FROM _access_frequency ORDER BY (read_count * 2 + write_count * 5) DESC LIMIT ?`,
      [limit]
    );

    const targetTables = new Set<string>(this.essentialTables);
    frequent.forEach((row) => targetTables.add(row.table_name));

    const synced: string[] = [];
    for (const table of targetTables) {
      try {
        await this.pullChanges(table);
        synced.push(table);
      } catch (err) {
        console.warn(`[LocalFirst] Failed to sync active table '${table}':`, err);
      }
    }

    return synced;
  }

  /**
   * Queries local SQLite rows and schedules a best-effort read-frequency update.
   * @typeParam T - Expected local row shape; no runtime schema validation is performed.
   * @param collection - Local table identifier, quoted by the adapter.
   * @param filter - AND-combined equality/null or $eq/$gt/$gte/$lt/$lte column conditions; other operator objects are rejected.
   * @param options - Supports sort, limit, and skip; limit/skip must be nonnegative safe integers. Projection and other options are ignored.
   * @returns Local rows, or an empty array; remote freshness is not implied.
   * @throws Rejects unsupported filters, invalid pagination, or SQLite query failures. Access-stat failures are ignored.
   * @example
   * ```typescript
   * import { LocalFirstSqliteAdapter, type LocalFirstSqliteAdapterOptions } from "@alneas/eaos-server/db/local-first-sqlite-adapter";
   * export async function example(options: LocalFirstSqliteAdapterOptions) {
   *   // The host supplies an initialized domain schema and authorized upstream adapter.
   *   const adapter = new LocalFirstSqliteAdapter({ ...options, syncIntervalMs: 0, enableLifecycleSync: false });
   *   try {
   *     await adapter.initSchema();
   *     return await adapter.find("records", { active: true }, { limit: 10 });
   *   } finally { adapter.destroy(); }
   * }
   * ```
   */
  async find<T = unknown>(collection: string, filter?: Filter, options?: QueryOptions): Promise<T[]> {
    this.recordAccess(collection, 'read').catch(() => {});
    const { sql, params } = this.buildSelectQuery(collection, filter, options);
    return await this.sqlite.select<T>(sql, params);
  }

  /**
   * Counts local rows matching a filter without pagination.
   * @param collection - Local table identifier, quoted by the adapter.
   * @param filter - Same supported AND-combined conditions as find.
   * @param options - Sort is retained; limit and skip are discarded. Other options are ignored.
   * @returns Numeric count, or zero if the driver returns no count row.
   * @throws Rejects unsupported filters or SQLite failures; access-stat failures are ignored.
   * @example
   * ```typescript
   * import { LocalFirstSqliteAdapter, type LocalFirstSqliteAdapterOptions } from "@alneas/eaos-server/db/local-first-sqlite-adapter";
   * export async function example(options: LocalFirstSqliteAdapterOptions) {
   *   // The host supplies an initialized domain schema and authorized upstream adapter.
   *   const adapter = new LocalFirstSqliteAdapter({ ...options, syncIntervalMs: 0, enableLifecycleSync: false });
   *   try {
   *     await adapter.initSchema();
   *     return await adapter.count("records");
   *   } finally { adapter.destroy(); }
   * }
   * ```
   */
  async count(collection: string, filter?: Filter, options?: QueryOptions): Promise<number> {
    this.recordAccess(collection, 'read').catch(() => {});
    const { sql, params } = this.buildSelectQuery(collection, filter, { ...options, limit: undefined, skip: undefined });
    const rows = await this.sqlite.select<{ total: number }>(`SELECT COUNT(*) AS total FROM (${sql})`, params);
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Queries a local row by its id column.
   * @typeParam T - Expected local row shape; no runtime validation is performed.
   * @param collection - Local table identifier.
   * @param id - ID value bound to an equality filter.
   * @param options - find options with limit overridden to 1; skip, if supplied, still applies.
   * @returns First matching row, or null.
   * @throws Rejects invalid pagination or SQLite query failures.
   * @example
   * ```typescript
   * import { LocalFirstSqliteAdapter, type LocalFirstSqliteAdapterOptions } from "@alneas/eaos-server/db/local-first-sqlite-adapter";
   * export async function example(options: LocalFirstSqliteAdapterOptions) {
   *   // The host supplies an initialized domain schema and authorized upstream adapter.
   *   const adapter = new LocalFirstSqliteAdapter({ ...options, syncIntervalMs: 0, enableLifecycleSync: false });
   *   try {
   *     await adapter.initSchema();
   *     return await adapter.findOne("records", "record-1");
   *   } finally { adapter.destroy(); }
   * }
   * ```
   */
  async findOne<T = unknown>(collection: string, id: string, options?: QueryOptions): Promise<T | null> {
    const rows = await this.find<T>(collection, { id: { $eq: id } }, { ...options, limit: 1 });
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Inserts a local record before separately enqueueing its upstream INSERT.
   * @typeParam T - Expected returned record shape; no runtime validation is performed.
   * @param collection - Provisioned local table identifier.
   * @param data - Column values; a truthy id is retained, otherwise an ID is generated. Missing tenant columns may receive the configured tenantId. Object values are JSON-encoded for local SQL.
   * @param _options - Accepted for DataAccessAdapter compatibility and ignored.
   * @returns The input record with its chosen ID and optional tenant default, before upstream acknowledgement.
   * @throws Rejects local SQL, serialization, or enqueue failure; a local insert may already have committed. Background outbox errors are ignored by this call.
   * @example
   * ```typescript
   * import { LocalFirstSqliteAdapter, type LocalFirstSqliteAdapterOptions } from "@alneas/eaos-server/db/local-first-sqlite-adapter";
   * export async function example(options: LocalFirstSqliteAdapterOptions) {
   *   // The host supplies an initialized domain schema and authorized upstream adapter.
   *   const adapter = new LocalFirstSqliteAdapter({ ...options, syncIntervalMs: 0, enableLifecycleSync: false });
   *   try {
   *     await adapter.initSchema();
   *     return await adapter.create("records", { title: "Example" });
   *   } finally { adapter.destroy(); }
   * }
   * ```
   */
  async create<T = unknown>(collection: string, data: Record<string, unknown>, _options?: QueryOptions): Promise<T> {
    this.recordAccess(collection, 'write').catch(() => {});

    const recordId = (data.id as string) || (typeof crypto !== 'undefined' ? crypto.randomUUID() : `rec_${Date.now()}`);
    const recordWithId: Record<string, any> = { ...data, id: recordId };
    if (this.tenantId && !recordWithId.tenant_id && !recordWithId.tenantId) {
      recordWithId.tenant_id = this.tenantId;
    }

    // 1. Write immediately to local SQLite
    await this.insertLocal(collection, recordWithId);

    // 2. Enqueue to Outbox
    await this.enqueueOutbox({
      id: typeof crypto !== 'undefined' ? crypto.randomUUID() : `out_${Date.now()}`,
      tableName: collection,
      recordId,
      operation: 'INSERT',
      payload: recordWithId,
      previousState: null,
      status: 'pending',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    });

    // Trigger immediate background sync
    if (this.autoSyncOnMutation) {
      this.processOutbox().catch(() => {});
    }

    return recordWithId as T;
  }

  /**
   * Snapshots a local row, updates its columns, and separately enqueues an upstream UPDATE.
   * @typeParam T - Expected returned merged record shape.
   * @param collection - Provisioned local table identifier.
   * @param id - Record ID bound in local SQL and used for upstream update.
   * @param data - Updated columns; local SQL excludes id but the payload is forwarded unchanged upstream. An empty update can cause a SQLite syntax failure.
   * @param _options - Accepted for DataAccessAdapter compatibility and ignored.
   * @returns Snapshot merged with data and the supplied id, even if no local row existed.
   * @throws Rejects snapshot, local SQL, serialization, or enqueue failures; local changes may already have committed.
   * @example
   * ```typescript
   * import { LocalFirstSqliteAdapter, type LocalFirstSqliteAdapterOptions } from "@alneas/eaos-server/db/local-first-sqlite-adapter";
   * export async function example(options: LocalFirstSqliteAdapterOptions) {
   *   // The host supplies an initialized domain schema and authorized upstream adapter.
   *   const adapter = new LocalFirstSqliteAdapter({ ...options, syncIntervalMs: 0, enableLifecycleSync: false });
   *   try {
   *     await adapter.initSchema();
   *     return await adapter.update("records", "record-1", { title: "Changed" });
   *   } finally { adapter.destroy(); }
   * }
   * ```
   */
  async update<T = unknown>(collection: string, id: string, data: Record<string, unknown>, _options?: QueryOptions): Promise<T> {
    this.recordAccess(collection, 'write').catch(() => {});

    // 1. Fetch current state as snapshot for rollback
    const existing = await this.findOne<Record<string, any>>(collection, id);

    // 2. Write immediately to local SQLite
    await this.updateLocal(collection, id, data);
    const updatedRecord = { ...(existing || {}), ...data, id };

    // 3. Enqueue to Outbox
    await this.enqueueOutbox({
      id: typeof crypto !== 'undefined' ? crypto.randomUUID() : `out_${Date.now()}`,
      tableName: collection,
      recordId: id,
      operation: 'UPDATE',
      payload: data,
      previousState: existing || null,
      status: 'pending',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    });

    // Trigger background sync
    if (this.autoSyncOnMutation) {
      this.processOutbox().catch(() => {});
    }

    return updatedRecord as T;
  }

  /**
   * Deletes a local row and separately enqueues upstream deletion with a rollback snapshot.
   * @typeParam T - Expected deleted record shape.
   * @param collection - Provisioned local table identifier.
   * @param id - Record ID used for local and upstream deletion.
   * @param _options - Accepted for DataAccessAdapter compatibility and ignored.
   * @returns The previous local record, or an object containing only id when absent.
   * @throws Rejects snapshot, local delete, or enqueue failures; local deletion may already have committed.
   * @example
   * ```typescript
   * import { LocalFirstSqliteAdapter, type LocalFirstSqliteAdapterOptions } from "@alneas/eaos-server/db/local-first-sqlite-adapter";
   * export async function example(options: LocalFirstSqliteAdapterOptions) {
   *   // The host supplies an initialized domain schema and authorized upstream adapter.
   *   const adapter = new LocalFirstSqliteAdapter({ ...options, syncIntervalMs: 0, enableLifecycleSync: false });
   *   try {
   *     await adapter.initSchema();
   *     return await adapter.delete("records", "record-1");
   *   } finally { adapter.destroy(); }
   * }
   * ```
   */
  async delete<T = unknown>(collection: string, id: string, _options?: QueryOptions): Promise<T> {
    this.recordAccess(collection, 'write').catch(() => {});
    const existing = await this.findOne<Record<string, any>>(collection, id);

    // 1. Delete from local SQLite
    await this.sqlite.execute(`DELETE FROM ${this.escapeId(collection)} WHERE id = ?`, [id]);

    // 2. Enqueue to Outbox
    await this.enqueueOutbox({
      id: typeof crypto !== 'undefined' ? crypto.randomUUID() : `out_${Date.now()}`,
      tableName: collection,
      recordId: id,
      operation: 'DELETE',
      payload: { id },
      previousState: existing || null,
      status: 'pending',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    });

    // Trigger background sync
    if (this.autoSyncOnMutation) {
      this.processOutbox().catch(() => {});
    }

    return (existing || { id }) as T;
  }

  /**
   * Pulls incremental remote changes from Oracle ADB using ORA_ROWSCN cursor within a batch transaction.
   *
   * @param collection - Provisioned local table whose upstream supports ORA_ROWSCN filtering, ordering, and projection.
   * @returns Number of remote rows upserted, or zero when no changes were returned.
   * @throws Rejects upstream or local SQL failures; an opened local transaction is rolled back best-effort on upsert/cursor failure.
   * @remarks Remote deletes are not discovered by this pull. No per-table synchronization lock prevents overlapping pulls or concurrent host transactions.
   * @example
   * ```typescript
   * import { LocalFirstSqliteAdapter, type LocalFirstSqliteAdapterOptions } from "@alneas/eaos-server/db/local-first-sqlite-adapter";
   * export async function example(options: LocalFirstSqliteAdapterOptions) {
   *   // The host supplies an initialized domain schema and authorized upstream adapter.
   *   const adapter = new LocalFirstSqliteAdapter({ ...options, syncIntervalMs: 0, enableLifecycleSync: false });
   *   try {
   *     await adapter.initSchema();
   *     return await adapter.pullChanges("records");
   *   } finally { adapter.destroy(); }
   * }
   * ```
   */
  async pullChanges(collection: string): Promise<number> {
    // 1. Get last synced SCN
    const meta = await this.sqlite.select<{ last_sync_scn: number }>(
      `SELECT last_sync_scn FROM _sync_meta WHERE table_name = ?`,
      [collection]
    );
    const lastScn = meta.length > 0 ? meta[0].last_sync_scn : 0;

    // 2. Query upstream with ORA_ROWSCN filter
    const filter = lastScn > 0 ? { ORA_ROWSCN: { $gt: lastScn } } : {};
    const remoteRecords = await this.upstream.find<Record<string, any>>(collection, filter, {
      sort: { ORA_ROWSCN: 1 },
      projection: ['*', 'ORA_ROWSCN'],
    });

    if (remoteRecords.length === 0) {
      return 0;
    }

    let maxScn = lastScn;

    // 3. Batch Transaction Upsert to avoid lock congestion
    await this.sqlite.execute(`BEGIN TRANSACTION;`);
    try {
      for (const record of remoteRecords) {
        const recordScn = Number(record.ORA_ROWSCN) || 0;
        if (recordScn > maxScn) {
          maxScn = recordScn;
        }
        await this.upsertLocal(collection, record);
      }

      // 4. Update sync meta cursor
      await this.sqlite.execute(
        `INSERT INTO _sync_meta (table_name, last_sync_scn, last_sync_at)
         VALUES (?, ?, ?)
         ON CONFLICT(table_name) DO UPDATE SET
           last_sync_scn = excluded.last_sync_scn,
           last_sync_at = excluded.last_sync_at`,
        [collection, maxScn, new Date().toISOString()]
      );

      await this.sqlite.execute(`COMMIT;`);
    } catch (txErr) {
      await this.sqlite.execute(`ROLLBACK;`).catch(() => {});
      throw txErr;
    }

    return remoteRecords.length;
  }

  /**
   * Background Outbox Worker:
   * Processes at most 20 pending mutations in creation order, pushes upstream, and attempts rollback for non-network failures.
   * @returns No value; resolves after one batch, or immediately if this instance already has a batch running.
   * @throws Rejects metadata reads, malformed persisted JSON, or error-handling SQL failures. Ordinary upstream failures are recorded or rolled back rather than rejected.
   * @remarks Recognized network failures return rows to pending and increment retry_count; no delay/backoff is applied here. Other failures attempt local snapshot rollback and mark failed; rollback/callback errors are logged. Remote success followed by local queue-delete failure may leave an uncertain delivery outcome. There is no cross-instance lease or deduplication.
   * @example
   * ```typescript
   * import { LocalFirstSqliteAdapter, type LocalFirstSqliteAdapterOptions } from "@alneas/eaos-server/db/local-first-sqlite-adapter";
   * export async function example(options: LocalFirstSqliteAdapterOptions) {
   *   // The host supplies an initialized domain schema and authorized upstream adapter.
   *   const adapter = new LocalFirstSqliteAdapter({ ...options, syncIntervalMs: 0, enableLifecycleSync: false });
   *   try {
   *     await adapter.initSchema();
   *     await adapter.processOutbox();
   *   } finally { adapter.destroy(); }
   * }
   * ```
   */
  async processOutbox(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      const pendingItems = await this.sqlite.select<any>(
        `SELECT * FROM _outbox_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 20`
      );

      for (const rawItem of pendingItems) {
        const item: OutboxItem = {
          id: rawItem.id,
          tableName: rawItem.table_name || rawItem.tableName,
          recordId: rawItem.record_id || rawItem.recordId,
          operation: rawItem.operation,
          payload: typeof rawItem.payload === 'string' ? JSON.parse(rawItem.payload) : rawItem.payload,
          previousState: rawItem.previous_state
            ? typeof rawItem.previous_state === 'string'
              ? JSON.parse(rawItem.previous_state)
              : rawItem.previous_state
            : null,
          status: rawItem.status,
          retryCount: rawItem.retry_count ?? rawItem.retryCount ?? 0,
          createdAt: rawItem.created_at || rawItem.createdAt,
        };

        try {
          await this.sqlite.execute(`UPDATE _outbox_queue SET status = 'syncing' WHERE id = ?`, [item.id]);

          // Push to Upstream Cloud DB (Oracle ADB / Supabase)
          if (item.operation === 'INSERT') {
            await this.upstream.create(item.tableName, item.payload);
          } else if (item.operation === 'UPDATE') {
            await this.upstream.update(item.tableName, item.recordId, item.payload);
          } else if (item.operation === 'DELETE') {
            await this.upstream.delete(item.tableName, item.recordId);
          }

          // Mark completed & clean up
          await this.sqlite.execute(`DELETE FROM _outbox_queue WHERE id = ?`, [item.id]);
        } catch (err: any) {
          const isNetworkError =
            err.name === 'AbortError' ||
            err.code === 'ECONNREFUSED' ||
            err.message?.includes('fetch failed') ||
            err.message?.includes('NetworkError');

          if (isNetworkError) {
            // Transient offline error: retry with backoff, DO NOT rollback
            await this.sqlite.execute(
              `UPDATE _outbox_queue SET status = 'pending', retry_count = retry_count + 1, error_message = ? WHERE id = ?`,
              [err.message, item.id]
            );
          } else {
            // Permanent error (business constraint / conflict / unauthorized)
            // Rollback local SQLite state using previousState snapshot!
            await this.rollbackItem(item, err);
          }
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Rolls back a failed mutation in local SQLite using its previousState snapshot.
   */
  private async rollbackItem(item: OutboxItem, error: Error): Promise<void> {
    console.error(`[LocalFirst] Rolling back ${item.tableName}:${item.recordId} due to error:`, error);

    try {
      if (item.operation === 'INSERT') {
        // Rollback insert: delete the inserted record
        await this.sqlite.execute(`DELETE FROM ${this.escapeId(item.tableName)} WHERE id = ?`, [item.recordId]);
      } else if (item.operation === 'UPDATE' || item.operation === 'DELETE') {
        // Rollback update/delete: restore previousState snapshot
        if (item.previousState) {
          await this.upsertLocal(item.tableName, item.previousState);
        }
      }

      await this.sqlite.execute(`UPDATE _outbox_queue SET status = 'failed', error_message = ? WHERE id = ?`, [
        error.message,
        item.id,
      ]);

      if (this.onSyncError) {
        this.onSyncError({
          item,
          error,
          rolledBack: true,
        });
      }
    } catch (rbErr) {
      console.error('[LocalFirst] Critical: Failed to rollback record:', rbErr);
    }
  }

  private async enqueueOutbox(item: OutboxItem): Promise<void> {
    await this.sqlite.execute(
      `INSERT INTO _outbox_queue (id, table_name, record_id, operation, payload, previous_state, status, retry_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.tableName,
        item.recordId,
        item.operation,
        JSON.stringify(item.payload),
        item.previousState ? JSON.stringify(item.previousState) : null,
        item.status,
        item.retryCount,
        item.createdAt,
      ]
    );
  }

  private async insertLocal(table: string, record: Record<string, any>): Promise<void> {
    const keys = Object.keys(record);
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((k) => (typeof record[k] === 'object' ? JSON.stringify(record[k]) : record[k]));
    const escapedKeys = keys.map((k) => this.escapeId(k)).join(', ');

    await this.sqlite.execute(
      `INSERT INTO ${this.escapeId(table)} (${escapedKeys}) VALUES (${placeholders})`,
      values
    );
  }

  private async updateLocal(table: string, id: string, data: Record<string, any>): Promise<void> {
    const keys = Object.keys(data).filter((k) => k !== 'id');
    const setClause = keys.map((k) => `${this.escapeId(k)} = ?`).join(', ');
    const values = keys.map((k) => (typeof data[k] === 'object' ? JSON.stringify(data[k]) : data[k]));

    await this.sqlite.execute(
      `UPDATE ${this.escapeId(table)} SET ${setClause} WHERE id = ?`,
      [...values, id]
    );
  }

  private async upsertLocal(table: string, record: Record<string, any>): Promise<void> {
    const keys = Object.keys(record);
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((k) => (typeof record[k] === 'object' ? JSON.stringify(record[k]) : record[k]));
    const escapedKeys = keys.map((k) => this.escapeId(k)).join(', ');

    const updateClauses = keys
      .filter((k) => k !== 'id')
      .map((k) => `${this.escapeId(k)} = excluded.${this.escapeId(k)}`)
      .join(', ');

    await this.sqlite.execute(
      `INSERT INTO ${this.escapeId(table)} (${escapedKeys}) VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${updateClauses}`,
      values
    );
  }

  private buildSelectQuery(table: string, filter?: Filter, options?: QueryOptions): { sql: string; params: any[] } {
    let sql = `SELECT * FROM ${this.escapeId(table)}`;
    const params: any[] = [];
    const whereParts: string[] = [];

    for (const value of [options?.limit, options?.skip]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid SQLite pagination');

    if (filter) {
      for (const [key, val] of Object.entries(filter)) {
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
          const opObj = val as Record<string, any>;
          if ('$eq' in opObj) {
            whereParts.push(`${this.escapeId(key)} = ?`);
            params.push(opObj.$eq);
          } else if ('$gt' in opObj) {
            whereParts.push(`${this.escapeId(key)} > ?`);
            params.push(opObj.$gt);
          } else if ('$gte' in opObj) {
            whereParts.push(`${this.escapeId(key)} >= ?`);
            params.push(opObj.$gte);
          } else if ('$lt' in opObj) {
            whereParts.push(`${this.escapeId(key)} < ?`);
            params.push(opObj.$lt);
          } else if ('$lte' in opObj) {
            whereParts.push(`${this.escapeId(key)} <= ?`);
            params.push(opObj.$lte);
          } else { throw new Error('Unsupported SQLite filter'); }
        } else if (val === null) {
          whereParts.push(`${this.escapeId(key)} IS NULL`);
        } else {
          whereParts.push(`${this.escapeId(key)} = ?`);
          params.push(val);
        }
      }
    }

    if (whereParts.length > 0) {
      sql += ` WHERE ${whereParts.join(' AND ')}`;
    }

    if (options?.sort) {
      const orderParts = Object.entries(options.sort).map(
        ([col, dir]) => `${this.escapeId(col)} ${dir === -1 ? 'DESC' : 'ASC'}`
      );
      sql += ` ORDER BY ${orderParts.join(', ')}`;
    }

    if (options?.limit !== undefined || options?.skip !== undefined) {
      sql += ` LIMIT ${options.limit ?? -1}`;
      if (options?.skip) {
        sql += ` OFFSET ${options.skip}`;
      }
    }

    return { sql, params };
  }

  private escapeId(id: string): string {
    return `"${id.replace(/"/g, '""')}"`;
  }

  /**
   * Stops this instance's polling timer and removes its browser focus/online listeners.
   * @returns No value; repeated calls are safe. In-flight synchronization continues and drivers remain open.
   * @example
   * ```typescript
   * import { LocalFirstSqliteAdapter, type LocalFirstSqliteAdapterOptions } from "@alneas/eaos-server/db/local-first-sqlite-adapter";
   * export async function example(options: LocalFirstSqliteAdapterOptions) {
   *   // The host supplies an initialized domain schema and authorized upstream adapter.
   *   const adapter = new LocalFirstSqliteAdapter({ ...options, syncIntervalMs: 0, enableLifecycleSync: false });
   *   try {
   *     await adapter.initSchema();
   *     adapter.destroy();
   *   } finally { adapter.destroy(); }
   * }
   * ```
   */
  destroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.cleanupListeners) {
      this.cleanupListeners();
      this.cleanupListeners = undefined;
    }
  }
}
