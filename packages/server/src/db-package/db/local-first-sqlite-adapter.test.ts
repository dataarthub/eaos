import { describe, it, expect, beforeEach } from 'bun:test';
import { LocalFirstSqliteAdapter, SqliteDriver, SyncErrorEvent } from './local-first-sqlite-adapter';
import type { DataAccessAdapter } from '@alneas/appkit-core/data/types';

class MockSqliteDriver implements SqliteDriver {
  tables: {
    _sync_meta: any[];
    _outbox_queue: any[];
    projects: any[];
  } = {
    _sync_meta: [],
    _outbox_queue: [],
    projects: [],
  };

  async execute(sql: string, params: any[] = []): Promise<any> {
    if (sql.includes('INSERT INTO "projects"')) {
      const firstParen = sql.indexOf('(');
      const closeParen = sql.indexOf(')');
      const record: any = {};
      if (firstParen !== -1 && closeParen !== -1) {
        const cols = sql.slice(firstParen + 1, closeParen).split(',').map((c) => c.trim().replace(/"/g, ''));
        cols.forEach((c, idx) => {
          record[c] = params[idx];
        });
      }
      const existingIdx = this.tables.projects.findIndex((p) => p.id === record.id);
      if (existingIdx >= 0) {
        this.tables.projects[existingIdx] = { ...this.tables.projects[existingIdx], ...record };
      } else {
        this.tables.projects.push(record);
      }
    } else if (sql.includes('UPDATE "projects" SET')) {
      const id = params[params.length - 1];
      const target = this.tables.projects.find((p) => p.id === id);
      if (target) {
        target.name = params[0];
      }
    } else if (sql.includes('DELETE FROM "projects"')) {
      const id = params[0];
      this.tables.projects = this.tables.projects.filter((p) => p.id !== id);
    } else if (sql.includes('INSERT INTO _outbox_queue')) {
      this.tables._outbox_queue.push({
        id: params[0],
        table_name: params[1],
        record_id: params[2],
        operation: params[3],
        payload: params[4],
        previous_state: params[5],
        status: params[6],
        retry_count: params[7],
        created_at: params[8],
      });
    } else if (sql.includes('DELETE FROM _outbox_queue WHERE id = ?')) {
      const id = params[0];
      this.tables._outbox_queue = this.tables._outbox_queue.filter((q) => q.id !== id);
    } else if (sql.includes('UPDATE _outbox_queue SET status')) {
      const id = params[params.length - 1];
      const item = this.tables._outbox_queue.find((q) => q.id === id);
      if (item) item.status = params[0] || 'failed';
    }
    return true;
  }

  async select<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (sql.includes('FROM "projects"')) {
      if (sql.includes('WHERE "id" = ?')) {
        // Return cloned object so existing snapshot is not mutated by reference
        const found = this.tables.projects.find((p) => p.id === params[0]);
        return found ? [JSON.parse(JSON.stringify(found))] as any : [];
      }
      return JSON.parse(JSON.stringify(this.tables.projects));
    }
    if (sql.includes('FROM _outbox_queue')) {
      return this.tables._outbox_queue.filter((q) => q.status === 'pending') as any;
    }
    if (sql.includes('FROM _sync_meta')) {
      return this.tables._sync_meta as any;
    }
    return [];
  }
}

describe('LocalFirstSqliteAdapter', () => {
  let sqlite: MockSqliteDriver;
  let upstream: DataAccessAdapter;
  let syncErrors: SyncErrorEvent[] = [];

  beforeEach(() => {
    sqlite = new MockSqliteDriver();
    syncErrors = [];
    upstream = {
      find: async () => [],
      findOne: async () => null,
      create: async (_, data) => data,
      update: async (_, __, data) => data,
      delete: async () => true,
    } as any;
  });

  it('provides 0ms local read and write with outbox queue', async () => {
    const adapter = new LocalFirstSqliteAdapter({
      sqlite,
      upstream,
      syncIntervalMs: 0,
    });

    const created = await adapter.create('projects', { id: 'p1', name: 'Tokyo Project' });
    expect(created.name).toBe('Tokyo Project');
    expect(sqlite.tables.projects.length).toBe(1);

    // Give background outbox async task 50ms to finish
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sqlite.tables._outbox_queue.length).toBe(0);
  });

  it('rolls back local SQLite state when upstream permanently fails', async () => {
    upstream.update = async () => {
      throw new Error('ORA-01031: insufficient privileges');
    };

    const adapter = new LocalFirstSqliteAdapter({
      sqlite,
      upstream,
      syncIntervalMs: 0,
      autoSyncOnMutation: false,
      onSyncError: (event) => syncErrors.push(event),
    });

    // Seed initial record
    sqlite.tables.projects.push({ id: 'p1', name: 'Original Name' });

    // Update locally (optimistic)
    await adapter.update('projects', 'p1', { name: 'Unauthorized Name' });
    expect(sqlite.tables.projects[0].name).toBe('Unauthorized Name');

    // Run outbox processing directly to await failure & rollback
    await adapter.processOutbox();

    // Verification: previous state was restored (Rollback)
    expect(syncErrors.length).toBe(1);
    expect(syncErrors[0].rolledBack).toBe(true);
    expect(sqlite.tables.projects[0].name).toBe('Original Name');
  });

  it('pulls remote changes using Oracle ORA_ROWSCN cursor', async () => {
    let queriedFilter: any = null;
    upstream.find = async (_col, filter) => {
      queriedFilter = filter;
      return [
        { id: 'p10', name: 'Remote Project 1', ORA_ROWSCN: 154200 },
        { id: 'p11', name: 'Remote Project 2', ORA_ROWSCN: 154210 },
      ];
    };

    const adapter = new LocalFirstSqliteAdapter({
      sqlite,
      upstream,
      syncIntervalMs: 0,
    });

    // First pull: should pull all
    const pulledCount = await adapter.pullChanges('projects');
    expect(pulledCount).toBe(2);
    expect(sqlite.tables.projects.length).toBe(2);

    // Verify SCN filter on subsequent pull
    sqlite.tables._sync_meta.push({ table_name: 'projects', last_sync_scn: 154210 });
    await adapter.pullChanges('projects');
    expect(queriedFilter.ORA_ROWSCN.$gt).toBe(154210);
  });

  it('records user access frequency and adaptively syncs active tables', async () => {
    const syncedTables: string[] = [];
    upstream.find = async (col) => {
      syncedTables.push(col);
      return [];
    };

    const adapter = new LocalFirstSqliteAdapter({
      sqlite,
      upstream,
      syncIntervalMs: 0,
      essentialTables: ['projects'],
    });

    // Record read and write access
    await adapter.recordAccess('crm_leads', 'read');
    await adapter.recordAccess('crm_leads', 'write');

    const activeSynced = await adapter.syncActiveTables();
    expect(activeSynced).toContain('projects'); // Essential table
    expect(syncedTables).toContain('projects');
  });
});
