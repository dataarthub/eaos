import { valid } from 'semver'
import { createAjvValidator } from '@alneas/appkit-core/data/schema/core'
import { canonicalJson } from '@alneas/eaos-core/serialization'

/**
 * Logical contents, distinct from the physical string/JSONB/CLOB column schema.
 * @see {@link createJsonDocumentAssertion}
 */
export interface JsonDocumentContract {
 
 /** Unique lowercase dotted/hyphenated logical document identity within selected contracts. */
 id: string
 
 /** Valid semantic version of the logical JSON document contract. */
 version: string
 
/** Physical table name declared by the owning data contract. */
 table: string
 
/** Physical JSON-bearing column whose logical contents are constrained by this contract. */
 column: string
 /** Plugin owner of plugin_data.plugins.<namespace>, or record-store namespace. */
 namespace?: string
 /** Owned subtree in plugin_data. Runtime partial updates validate this subtree. */
 jsonPath?: string
 /** Logical record ID prefix; longest matching prefix wins. Empty means all IDs. */
 recordPrefix?: string
 
 /** JSON Schema defining owned table/document structure; schema declarations do not apply migrations by themselves. */
 schema: Record<string, unknown>
 /** Explicitly append-only documents may only be created at revision 1. */
 immutable?: boolean
 
  /** Optional positive safe-integer UTF-8 canonical JSON limit up to 4194304 bytes; defaults to 4 MiB. */
  maxBytes?: number
}

/**
 * Same logical contract for complete payload writes and owned plugin_data subtree updates.
 * @param document - Logical document contract; schema must be a closed object and optional maxBytes a positive safe integer up to 4 MiB.
 * @returns An assertion callback accepting unknown payload and returning no value when strict canonical JSON size and schema checks pass.
 * @throws Error for invalid schema/bounds, AJV schema compilation failures, non-JSON values, oversized payloads or schema mismatch.
 * @remarks Requires the app-core AJV peer and Node Buffer. Uses draft 2020-12 with coercion/defaults/property removal disabled; the contract is cloned before compilation. The returned callback throws on invalid payloads.
 * @example
 * ```typescript
 * import { createJsonDocumentAssertion } from "@alneas/eaos-core/contracts/json-documents";
 * const document = { id: "notes.body", version: "1.0.0", table: "notes", column: "payload", schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false } };
 * const assertDocument = createJsonDocumentAssertion(document);
 * assertDocument({ title: "hello" });
 * ```
 */
export function createJsonDocumentAssertion(document: JsonDocumentContract): (value: unknown) => void {
 const copy = structuredClone(document)
 if (copy.schema.type !== 'object' || copy.schema.additionalProperties !== false) throw Error('Closed JSON document schema required')
 if (copy.maxBytes !== undefined && (!Number.isSafeInteger(copy.maxBytes) || copy.maxBytes < 1 || copy.maxBytes > 4 * 1024 * 1024)) throw Error('Invalid JSON document byte limit')
 const engine = createAjvValidator({ draft: '2020-12', ajvOptions: { strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false } })
 const validate = engine.ajv.compile(copy.schema)
 return value => {
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > (copy.maxBytes ?? 4 * 1024 * 1024)) throw Error('JSON document exceeds contract byte limit')
  if (!validate(value)) throw Error(`JSON document differs from ${copy.id}@${copy.version}`)
 }
}

/**
 * Validate logical JSON document identities, ownership routes and physical column bindings.
 * @param documents - Unique document IDs and route tuples, closed object schemas, semver versions and optional ownership/size policies.
 * @param tables - Physical schema map whose properties contain every referenced document column.
 * @returns No value; completion confirms declaration compatibility, without compiling schemas or applying changes.
 * @throws Error for invalid/duplicate identity/routes, missing columns, invalid namespace/prefix/path, nonclosed schema or invalid byte/immutability policy.
 * @example
 * ```typescript
 * import { assertJsonDocumentContracts } from "@alneas/eaos-core/contracts/json-documents";
 * const document = { id: "notes.body", version: "1.0.0", table: "notes", column: "payload", schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false } };
 * assertJsonDocumentContracts([document], new Map([["notes", { properties: { payload: { type: "string" } } }]]));
 * ```
 */
export function assertJsonDocumentContracts(documents: readonly JsonDocumentContract[], tables: ReadonlyMap<string, Record<string, unknown>>): void {
 const ids = new Set<string>(), routes = new Set<string>()
 for (const document of documents) {
  const columns = tables.get(document.table)?.properties as Record<string, unknown> | undefined
  const route = JSON.stringify([document.table, document.column, document.namespace ?? '', document.jsonPath ?? '', document.recordPrefix ?? ''])
  if (!/^[a-z][a-z0-9.-]{0,100}$/.test(document.id) || !valid(document.version) || ids.has(document.id) || routes.has(route) || !columns?.[document.column]) throw Error(`Invalid JSON document contract: ${document.id}`)
  if (document.namespace !== undefined && !/^[a-z][a-zA-Z0-9_]{0,62}$/.test(document.namespace)) throw Error('Invalid JSON document namespace')
  if (document.recordPrefix !== undefined && (document.column !== 'payload' || document.recordPrefix.length > 240)) throw Error('Invalid JSON record prefix')
  if (document.jsonPath !== undefined && (document.column === 'payload' || !document.namespace || !(document.jsonPath === `$.plugins.${document.namespace}` || document.jsonPath.startsWith(`$.plugins.${document.namespace}.`)) || !/^\$\.plugins\.[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*$/.test(document.jsonPath))) throw Error('Invalid owned JSON path')
  if (!document.schema || document.schema.type !== 'object' || document.schema.additionalProperties !== false) throw Error(`JSON document requires a closed object schema: ${document.id}`)
  if (document.immutable !== undefined && typeof document.immutable !== 'boolean') throw Error('Invalid JSON immutability policy')
  if (document.maxBytes !== undefined && (!Number.isSafeInteger(document.maxBytes) || document.maxBytes < 1 || document.maxBytes > 4 * 1024 * 1024)) throw Error('Invalid JSON document byte limit')
  ids.add(document.id); routes.add(route)
 }
}
