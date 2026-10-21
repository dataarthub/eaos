import { satisfies, valid, validRange } from 'semver'
import type { PluginMigration } from '../migration-types'
import { assertJsonDocumentContracts, type JsonDocumentContract } from './json-documents'
export * from './json-documents'

/**
 * A versioned storage contract has no routes, jobs, activation or infrastructure.
 * @see {@link resolveDataContracts}
 */
export interface DataContract {
  
  /** Unique lowercase data-contract identity; default migration identity is data- followed by this ID. */
  id: string
  
  /** Valid semantic version of the trusted data-contract release. */
  version: string
  
  /** Human-readable metadata describing the capability, workflow node or requirement to host users. */
  description: string
  
  /** JSON Schema defining owned table/document structure; schema declarations do not apply migrations by themselves. */
  schema: Record<string, unknown>
  
/** Ordered driver-specific migration declarations; collecting them does not execute SQL. */
  migrations: PluginMigration[]
  
  /** Declared prerequisites; shared data contracts use ID-to-semver ranges and plugin/skill metadata uses identity lists. */
  dependencies?: Record<string, string>
  /** Stable historical migration ledger identity; never grants plugin activation. */
  migrationIdentity?: string
  /** Canonical JSON contents and ownership; changing these requires a contract version bump. */
  jsonDocuments?: JsonDocumentContract[]
}
/**
 * Required semantic-version range and table ownership for a plugin namespace.
 * @see {@link resolveDataContracts}
 */
export interface DataContractBinding { 
/** Owning shared data-contract identity; not a plugin activation grant. */
  contractId: string; 
  /** Accepted semantic-version range for the owning data contract. */
  version: string; 
/** Physical table name declared by the owning data contract. */
  table: string; 
/** Logical provider/plugin namespace used to prevent ownership collisions. */
  namespace?: string }
/**
 * Selected dependency-ordered contracts and sorted table ownership metadata.
 * @see {@link resolveDataContracts}
 */
export interface DataContractCatalog {
  
  
  /** Selected contract releases in dependency-first order; references point to supplied trusted releases. */
  contracts: DataContract[]
  
  /** Owned physical table metadata in sorted name order after contract resolution. */
  tables: { 
  /** Physical table name declared by the owning data contract. */
  name: string; 
/** Owning shared data-contract identity; not a plugin activation grant. */
  contractId: string; 
  /** Selected owner contract release version for this table. */
  version: string; 
  /** JSON Schema defining owned table/document structure; schema declarations do not apply migrations by themselves. */
  schema: Record<string, unknown> }[]
}

/**
 * Extract tenant-scoped table definitions from a contract schema and its direct $defs.
 * @param schema - Root JSON schema plus optional direct $defs entries with x-db.tableName.
 * @returns A new insertion-ordered map of table names to the original schema definition objects.
 * @throws Error for invalid/duplicate table names, missing required tenant_id or no declared tables.
 * @remarks No SQL runs; definitions are not cloned.
 * @example
 * ```typescript
 * import { dataContractTables } from "@alneas/eaos-core/contracts/data-contracts";
 * const tables = dataContractTables({ type: "object", properties: { tenant_id: { type: "string" } }, required: ["tenant_id"], "x-db": { tableName: "notes" } });
 * console.log([...tables.keys()]); // ["notes"]
 * ```
 */
export function dataContractTables(schema: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>()
  const definitions = schema.$defs as Record<string, Record<string, unknown>> | undefined
  for (const definition of [schema, ...Object.values(definitions ?? {})]) {
    const name = (definition['x-db'] as { tableName?: string } | undefined)?.tableName
    if (!name) continue
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name) || result.has(name)) throw new Error(`Invalid or duplicate contract table: ${name}`)
    const properties = definition.properties as Record<string, unknown> | undefined
    if (!properties?.tenant_id || !(definition.required as string[] | undefined)?.includes('tenant_id')) throw new Error(`Contract table requires tenant_id: ${name}`)
    result.set(name, definition)
  }
  if (!result.size) throw new Error('Data contract must define a table')
  return result
}

/**
 * Compose only selected contracts; one trusted release per ID, no silent range fallback.
 * @param available - One trusted release per unique ID/migration identity. Every supplied release is structurally validated, even when not selected.
 * @param requirements - Contract ID to semver range; empty requirements select no releases. Prereleases are included during requirement resolution.
 * @returns A new catalog with dependency-first contracts and alphabetically sorted tables; contract/schema objects retain source references.
 * @throws Error for invalid/duplicate releases or migrations, unsatisfied ranges, dependency cycles, foreign-table DDL, invalid JSON contracts or conflicting ownership.
 * @remarks No SQL, activation or infrastructure changes occur. SQL ownership checks inspect recognized table DDL patterns and are not a general SQL security sandbox.
 * @example
 * ```typescript
 * import { resolveDataContracts } from "@alneas/eaos-core/contracts/data-contracts";
 * const contract = { id: "notes", version: "1.0.0", description: "Tenant notes", schema: { type: "object", properties: { tenant_id: { type: "string" } }, required: ["tenant_id"], "x-db": { tableName: "notes" } }, migrations: [] };
 * console.log(resolveDataContracts([contract], { notes: "^1.0.0" }).tables.map(table => table.name));
 * ```
 */
export function resolveDataContracts(available: readonly DataContract[], requirements: Record<string, string>): DataContractCatalog {
  const registered = new Map<string, DataContract>()
  const identities = new Set<string>()
  for (const contract of available) {
    const identity = contract.migrationIdentity ?? `data-${contract.id}`
    if (!/^[a-z][a-z0-9-]{0,100}$/.test(contract.id) || !valid(contract.version) || registered.has(contract.id) || !contract.description.trim() || identities.has(identity)) throw new Error(`Invalid or duplicate data contract: ${contract.id}`)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(identity)) throw new Error('Invalid data contract migration identity')
    const migrationIds = new Set<string>()
    for (const migration of contract.migrations) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(migration.id) || migrationIds.has(migration.id) || !['database', 'tenant'].includes(migration.scope) || !Object.keys(migration.sql).length) throw new Error(`Invalid data contract migration: ${contract.id}`)
      for (const statements of Object.values(migration.sql)) if (!Array.isArray(statements) || !statements.length || statements.some(statement => typeof statement !== 'string' || !statement.trim())) throw new Error('Invalid data contract migration SQL')
      migrationIds.add(migration.id)
    }
    identities.add(identity)
    const tables = dataContractTables(contract.schema)
    assertJsonDocumentContracts(contract.jsonDocuments ?? [], tables)
    for (const migration of contract.migrations) for (const statements of Object.values(migration.sql)) for (const statement of statements) {
      // Dumped PostgreSQL DDL is schema-qualified; Oracle metadata quotes its
      // uppercase physical identifiers. The schema remains host-owned.
      const identifier = '(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)'
      const tableDdl = new RegExp('\\b(?:CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?|ALTER\\s+TABLE\\s+(?:ONLY\\s+)?|DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?|TRUNCATE\\s+TABLE\\s+(?:ONLY\\s+)?)('+identifier+'(?:\\s*\\.\\s*'+identifier+')?)', 'gi')
      for (const match of statement.matchAll(tableDdl)) {
        const name = match[1].match(new RegExp(identifier, 'gi'))!.at(-1)!.replace(/^"|"$/g, '').replaceAll('""', '"').toLowerCase()
        if (!tables.has(name)) throw new Error(`Contract migration touches a foreign table: ${contract.id}:${name}`)
      }
    }
    registered.set(contract.id, contract)
  }
  const selected = new Map<string, DataContract>(), visiting = new Set<string>()
  const visit = (id: string, range: string) => {
    const contract = registered.get(id)
    if (!validRange(range) || !contract || !satisfies(contract.version, range, { includePrerelease: true })) throw new Error(`Unsatisfied data contract: ${id}@${range}`)
    if (visiting.has(id)) throw new Error('Data contract dependency cycle')
    if (selected.has(id)) return
    visiting.add(id)
    for (const [dependency, version] of Object.entries(contract.dependencies ?? {})) visit(dependency, version)
    visiting.delete(id); selected.set(id, contract)
  }
  for (const [id, range] of Object.entries(requirements).sort(([a], [b]) => a.localeCompare(b))) visit(id, range)
  const documentIds = new Set<string>()
  for (const contract of selected.values()) for (const document of contract.jsonDocuments ?? []) {
    if (documentIds.has(document.id)) throw Error(`JSON document has multiple owners: ${document.id}`)
    documentIds.add(document.id)
  }
  const tables: DataContractCatalog['tables'] = [], owners = new Map<string, string>()
  for (const contract of selected.values()) for (const [name, schema] of dataContractTables(contract.schema)) {
    if (owners.has(name)) throw new Error(`Table has multiple data contract owners: ${name}`)
    owners.set(name, contract.id)
    tables.push({ name, contractId: contract.id, version: contract.version, schema })
  }
  return { contracts: [...selected.values()], tables: tables.sort((a, b) => a.name.localeCompare(b.name)) }
}

/**
 * Require a binding to resolve to the named contract and one of its owned tables.
 * @param catalog - Previously resolved contract/table ownership catalog.
 * @param binding - Contract ID, semver range, owned table and optional lowercase namespace.
 * @returns No value; completion confirms version/table ownership compatibility.
 * @throws Error for unknown contract, incompatible/invalid range, foreign table or invalid namespace.
 * @remarks Does not grant data access or apply migrations.
 * @example
 * ```typescript
 * import { assertDataContractBinding } from "@alneas/eaos-core/contracts/data-contracts";
 * import { resolveDataContracts } from "@alneas/eaos-core/contracts/data-contracts";
 * const contract = { id: "notes", version: "1.0.0", description: "Tenant notes", schema: { type: "object", properties: { tenant_id: { type: "string" } }, required: ["tenant_id"], "x-db": { tableName: "notes" } }, migrations: [] };
 * const catalog = resolveDataContracts([contract], { notes: "^1.0.0" });
 * assertDataContractBinding(catalog, { contractId: "notes", version: "^1.0.0", table: "notes" });
 * ```
 */
export function assertDataContractBinding(catalog: DataContractCatalog, binding: DataContractBinding): void {
  const contract = catalog.contracts.find(c => c.id === binding.contractId)
  if (!contract || !validRange(binding.version) || !satisfies(contract.version, binding.version) || !catalog.tables.some(t => t.name === binding.table && t.contractId === binding.contractId)) throw new Error(`Invalid data contract binding: ${binding.contractId}:${binding.table}`)
  if (binding.namespace !== undefined && !/^[a-z][a-z0-9_]{0,62}$/.test(binding.namespace)) throw new Error('Invalid data contract namespace')
}

/**
 * Read-only migration inventory for offline tooling and isolated test bootstrap; never applies SQL.
 * @param releases - Plugin/release sources in desired order; each dependency set is checked.
 * @param available - Additional shared contract releases; defaults to empty. Conflicting definitions with the same ID are rejected.
 * @returns A new migration list with dependency-ordered shared migrations followed by source migrations; entries retain source references.
 * @throws Error for conflicting contracts or any resolveDataContracts validation/resolution failure.
 * @remarks Read-only inventory for offline tooling/test bootstrap; it does not prove that SQL has been applied.
 * @example
 * ```typescript
 * import { collectSchemaMigrations } from "@alneas/eaos-core/contracts/data-contracts";
 * console.log(collectSchemaMigrations([{ migrations: [] }])); // []
 * ```
 */
export function collectSchemaMigrations(releases: readonly SchemaMigrationSource[], available: readonly DataContract[] = []): PluginMigration[] {
  const contracts = new Map<string, DataContract>()
  for (const contract of [...available, ...releases.flatMap(p => p.schemaContracts ?? [])]) {
    const previous = contracts.get(contract.id)
    if (previous && JSON.stringify(previous) !== JSON.stringify(contract)) throw new Error(`Conflicting data contract definitions: ${contract.id}`)
    contracts.set(contract.id, contract)
  }
  const requirements: Record<string, string> = {}
  for (const release of releases) {
    resolveDataContracts([...contracts.values()], release.schemaDependencies ?? {})
    Object.assign(requirements, release.schemaDependencies ?? {})
  }
  return [...resolveDataContracts([...contracts.values()], requirements).contracts.flatMap(c => c.migrations), ...releases.flatMap(p => p.migrations)]
}

/**
 * Plugin migration list plus optional shared contract requirements and releases.
 * @see {@link resolveDataContracts}
 */
export interface SchemaMigrationSource { 
/** Ordered driver-specific migration declarations; collecting them does not execute SQL. */
  migrations: PluginMigration[]; 
/** Required data-contract IDs mapped to accepted semver ranges. */
  schemaDependencies?: Record<string,string>; 
/** Optional data-contract releases supplied alongside this migration source. */
  schemaContracts?: DataContract[] }
