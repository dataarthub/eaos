import { describe, expect, test } from 'bun:test'
import { MigrationAggregator } from './aggregator'

const source = (columns: Record<string, unknown>) => [{ pluginId: 'notes', schemaJson: { tables: { notes: { columns } } } }]

describe('migration schema tenant boundary', () => {
  test('generates Postgres RLS only for a required tenant_id column', () => {
    const sql = new MigrationAggregator([]).generatePostgres(source({ tenant_id: { type: 'VARCHAR', nullable: false }, id: { type: 'VARCHAR', primaryKey: true } }))
    expect(sql).toContain('tenant_id = NULLIF(current_setting')
  })

  test('rejects plugin tables without a non-null tenant_id', () => {
    expect(() => new MigrationAggregator([]).generatePostgres(source({ id: { type: 'VARCHAR' } }))).toThrow('tenant_id')
    expect(() => new MigrationAggregator([]).generateOracle(source({ tenant_id: { type: 'VARCHAR', nullable: true } }))).toThrow('tenant_id')
  })
})
