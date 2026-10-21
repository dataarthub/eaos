import { resolveDataContracts, type DataContract } from '@alneas/eaos-core/contracts/data-contracts'
import type { PluginManifest } from '@alneas/eaos-core/plugin-sdk/types'

/**
 * Legacy table-schema input collected for migration text generation.
 * @see MigrationAggregator for a complete usage example.
 */
export interface SchemaSource {
  /** Plugin ID, or data:{contractId} for resolved data contracts. */
  pluginId: string
  /** Optional display label used in generated SQL comments. */
  pluginName?: string
  /** Optional extension ID appended to the source identifier. */
  extensionId?: string
  /** Sort order from the plugin manifest; defaults to 999 for plugin schemas. */
  migrationOrder?: number
  /** Legacy tables/columns schema; canonical x-db/$defs schemas require reviewed lifecycle migrations instead. */
  schemaJson: Record<string, any>
}

/**
 * Collects plugin schema sources and renders legacy PostgreSQL or Oracle DDL text.
 * @remarks Generation never executes SQL. Schema identifiers, defaults, and comments are interpolated from trusted schema inputs; review generated SQL before applying it. Canonical data-contract JSON Schema requires reviewed lifecycle migrations rather than these legacy converters.
 * @example
 * ```typescript
 * import { MigrationAggregator } from "@alneas/eaos-server/db/migration/aggregator";
 * const aggregator = new MigrationAggregator([]);
 * console.log(aggregator.generatePostgres([]));
 * ```
 */
export class MigrationAggregator {
  /**
   * Captures plugin manifests and available data contracts for later collection.
   * @param plugins - Manifests consulted on every collection call; the array is retained rather than cloned.
   * @param dataContracts - Available contracts used to resolve manifest requirements; defaults to none and is retained.
   */
  constructor(private plugins: PluginManifest[], private dataContracts: DataContract[] = []) {}

  /**
   * Collects resolved data contracts first, then plugin and extension schemas by migration order.
   * @param resolveSchema - Called with plugin ID and optional extension ID; returns a legacy schema or null to skip it. Plugin schemas declaring data contracts skip the plugin-level callback, but extensions are still resolved.
   * @returns Ordered schema sources; manifests with equal order retain their sort order and missing callback results are omitted.
   * @throws Propagates contract resolution or callback errors.
   * @example
   * ```typescript
   * import { MigrationAggregator } from "@alneas/eaos-server/db/migration/aggregator";
   * const aggregator = new MigrationAggregator([]);
   * console.log(aggregator.collectSchemas(() => null)); // []
   * ```
   */
  collectSchemas(
    resolveSchema: (pluginId: string, extensionId?: string) => Record<string, any> | null
  ): SchemaSource[] {
    const sources: SchemaSource[] = []
    const requirements: Record<string, string> = {}
    for (const plugin of this.plugins) {
      resolveDataContracts(this.dataContracts, plugin.schema.dataContracts ?? {})
      Object.assign(requirements, plugin.schema.dataContracts ?? {})
    }
    for (const contract of resolveDataContracts(this.dataContracts, requirements).contracts) sources.push({ pluginId: `data:${contract.id}`, pluginName: contract.description, schemaJson: contract.schema })
    const sorted = [...this.plugins].sort(
      (a, b) => (a.schema?.migrationOrder ?? 999) - (b.schema?.migrationOrder ?? 999)
    )

    for (const plugin of sorted) {
      const schemaJson = Object.keys(plugin.schema.dataContracts ?? {}).length ? null : resolveSchema(plugin.id)
      if (schemaJson) {
        sources.push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          migrationOrder: plugin.schema?.migrationOrder ?? 999,
          schemaJson,
        })
      }

      if (plugin.extensions) {
        for (const ext of plugin.extensions) {
          const extSchemaJson = resolveSchema(plugin.id, ext.id)
          if (extSchemaJson) {
            sources.push({
              pluginId: plugin.id,
              pluginName: plugin.name,
              extensionId: ext.id,
              migrationOrder: plugin.schema?.migrationOrder ?? 999,
              schemaJson: extSchemaJson,
            })
          }
        }
      }
    }
    return sources
  }

  /**
   * Renders PostgreSQL table DDL and tenant_id row-level-security policies as text.
   * @param sources - Trusted legacy schemas rendered in supplied order. Every table must declare tenant_id not explicitly nullable.
   * @param dbDriver - Label included in SQL comments only; defaults to postgres and does not change dialect.
   * @returns SQL text with a generated timestamp, CREATE TABLE IF NOT EXISTS, and tenant policies using app.current_tenant as UUID.
   * @throws For canonical x-db/$defs schemas or missing/nullable tenant_id columns.
   * @remarks The host must set app.current_tenant appropriately and review/apply SQL separately.
   * @example
   * ```typescript
   * import { MigrationAggregator } from "@alneas/eaos-server/db/migration/aggregator";
   * const aggregator = new MigrationAggregator([]);
   * console.log(aggregator.generatePostgres([]));
   * ```
   */
  generatePostgres(sources: SchemaSource[], dbDriver: string = 'postgres'): string {
    let sqlOutput = `-- Auto-generated Supabase / PostgreSQL DDL & RLS Policies\n`
    sqlOutput += `-- Driver: ${dbDriver}\n-- Generated at: ${new Date().toISOString()}\n\n`

    for (const source of sources) {
      const identifier = source.extensionId ? `${source.pluginId}:${source.extensionId}` : source.pluginId
      sqlOutput += `-- ==========================================\n`
      sqlOutput += `-- Plugin: ${source.pluginName || source.pluginId} (source: ${identifier})\n`
      sqlOutput += `-- Migration Order: ${source.migrationOrder ?? 999}\n`
      sqlOutput += `-- ==========================================\n\n`

      sqlOutput += this.convertJsonSchemaToPostgresSql(identifier, source.schemaJson)
    }

    return sqlOutput
  }

  /**
   * Renders legacy Oracle table DDL as text.
   * @param sources - Trusted legacy schemas rendered in supplied order; every table must declare tenant_id not explicitly nullable.
   * @returns SQL text with a generated timestamp and CREATE TABLE statements; no VPD policies or default clauses are emitted by this converter.
   * @throws For canonical x-db/$defs schemas or missing/nullable tenant_id columns.
   * @remarks Applying SQL and enforcing Oracle tenant isolation remain host responsibilities.
   * @example
   * ```typescript
   * import { MigrationAggregator } from "@alneas/eaos-server/db/migration/aggregator";
   * const aggregator = new MigrationAggregator([]);
   * console.log(aggregator.generateOracle([]));
   * ```
   */
  generateOracle(sources: SchemaSource[]): string {
    let sqlOutput = `-- Auto-generated Oracle ADB DDL & VPD Context Policies\n`
    sqlOutput += `-- Driver: ORACLE\n-- Generated at: ${new Date().toISOString()}\n\n`

    for (const source of sources) {
      const identifier = source.extensionId ? `${source.pluginId}:${source.extensionId}` : source.pluginId
      sqlOutput += `-- ==========================================\n`
      sqlOutput += `-- Plugin: ${source.pluginName || source.pluginId} (source: ${identifier})\n`
      sqlOutput += `-- Migration Order: ${source.migrationOrder ?? 999}\n`
      sqlOutput += `-- ==========================================\n\n`

      sqlOutput += this.convertJsonSchemaToOracleSql(identifier, source.schemaJson)
    }

    return sqlOutput
  }

  private convertJsonSchemaToPostgresSql(_identifier: string, schemaJson: any): string {
    let sql = ''
    if (schemaJson['x-db'] || schemaJson.$defs) throw new Error('Use the data contract reviewed lifecycle migrations for canonical JSON Schema')
    const tables = schemaJson.tables || {}

    for (const [tableName, tableDef] of Object.entries<any>(tables)) {
      sql += `CREATE TABLE IF NOT EXISTS ${tableName} (\n`
      const columnDefs: string[] = []
      const columns = tableDef.columns || {}
      assertTenantColumn(tableName, columns)

      for (const [colName, colDef] of Object.entries<any>(columns)) {
        let colType = 'TEXT'
        const rawType = (colDef.type || '').toUpperCase()

        if (rawType === 'UUID') colType = 'UUID'
        else if (rawType.includes('VARCHAR')) colType = 'VARCHAR(255)'
        else if (rawType.includes('NUMBER') || rawType.includes('DECIMAL')) colType = 'NUMERIC(18,2)'
        else if (rawType.includes('TIMESTAMP') || rawType.includes('DATE')) colType = 'TIMESTAMPTZ'
        else if (rawType.includes('INT')) colType = 'BIGINT'

        let line = `  ${colName} ${colType}`
        if (colDef.primaryKey) line += ' PRIMARY KEY'
        if (colDef.nullable === false) line += ' NOT NULL'
        if (colDef.default) line += ` DEFAULT ${colDef.default}`

        columnDefs.push(line)
      }

      sql += columnDefs.join(',\n') + '\n);\n\n'

      if (columns['tenant_id']) {
        sql += `-- Supabase Row Level Security (RLS) for ${tableName}\n`
        sql += `ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;\n`
        sql += `DROP POLICY IF EXISTS ${tableName}_tenant_isolation ON ${tableName};\n`
        sql += `CREATE POLICY ${tableName}_tenant_isolation ON ${tableName} FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);\n\n`
      }
    }

    return sql
  }

  private convertJsonSchemaToOracleSql(_identifier: string, schemaJson: any): string {
    let sql = ''
    if (schemaJson['x-db'] || schemaJson.$defs) throw new Error('Use the data contract reviewed lifecycle migrations for canonical JSON Schema')
    const tables = schemaJson.tables || {}

    for (const [tableName, tableDef] of Object.entries<any>(tables)) {
      sql += `CREATE TABLE ${tableName} (\n`
      const columnDefs: string[] = []
      const columns = tableDef.columns || {}
      assertTenantColumn(tableName, columns)

      for (const [colName, colDef] of Object.entries<any>(columns)) {
        let colType = 'VARCHAR2(255)'
        const rawType = (colDef.type || '').toUpperCase()

        if (rawType === 'UUID') colType = 'VARCHAR2(36)'
        else if (rawType.includes('VARCHAR')) colType = 'VARCHAR2(255)'
        else if (rawType.includes('NUMBER') || rawType.includes('DECIMAL')) colType = 'NUMBER(18,2)'
        else if (rawType.includes('TIMESTAMP') || rawType.includes('DATE')) colType = 'TIMESTAMP WITH TIME ZONE'
        else if (rawType.includes('INT')) colType = 'NUMBER(19)'

        let line = `  ${colName} ${colType}`
        if (colDef.primaryKey) line += ' PRIMARY KEY'
        if (colDef.nullable === false) line += ' NOT NULL'

        columnDefs.push(line)
      }

      sql += columnDefs.join(',\n') + '\n);\n\n'
    }

    return sql
  }
}

function assertTenantColumn(tableName: string, columns: Record<string, any>): void {
  const tenant = columns.tenant_id
  if (!tenant || tenant.nullable === true) throw new Error(`Schema table ${tableName} must declare a non-null tenant_id column`)
}
