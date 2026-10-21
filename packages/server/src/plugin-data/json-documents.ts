import { inheritAtomicSqlSession } from './atomic-context'
import { assertBusinessId } from '@alneas/eaos-core/plugin-sdk'
import { assertDataContractBinding, createJsonDocumentAssertion, type DataContractCatalog, type DataContractBinding, type JsonDocumentContract } from '@alneas/eaos-server/lifecycle-engine'
import { assertPrincipal, PluginError, type PluginPrincipal, type PluginRecord, type PluginRecordStore } from './index'
import type { AtomicRepository, AtomicSession } from './atomic'

/**
 * Apply canonical document validation to every existing host persistence path while retaining other host methods.
 * @param host - Host with optional record store, repository and/or transaction callback.
 * @param documents - Trusted canonical JSON document definitions.
 * @typeParam T - Stored JSON payload shape.
 * @typeParam H - Concrete host shape whose existing methods and persistence capabilities are retained.
 * @returns A proxy with wrapped persistence capabilities and other functions bound to the original host.
 * @throws Invalid document contracts throw during wrapper creation; subsequent validation and underlying host failures propagate.
 * @remarks Does not replace transaction ownership or live authorization. Inputs are copied for validation; unrelated host methods keep their original receiver.
 * @example
 * import { createValidatedRecordHost } from '@alneas/eaos-server/plugin-data'
 * export function validated<T>(host: Parameters<typeof createValidatedRecordHost<T, { store?: import('@alneas/eaos-server/plugin-data').PluginRecordStore<T> }>>[0], documents: Parameters<typeof createValidatedRecordHost>[1]) { return createValidatedRecordHost(host, documents) }
 */
export function createValidatedRecordHost<T, H extends {
 
  /**
   * Optional existing tenant/CAS store wrapped with canonical payload checks.
   */
  store?: PluginRecordStore<T>
 
  /**
   * Optional existing atomic repository wrapped without adding a second transaction.
   */
  repository?: AtomicRepository
 
  /**
   * Optional real aggregate transaction; its callback receives a validated connection-bound store.
   
   * @param principal - Verified current principal.
   * @param work - Async service work on the validated connection-bound store.
   * @typeParam R - Callback result resolved by the host transaction.
   * @returns The callback result after host commit; underlying transaction/rejection semantics are preserved.
   * @throws Callback failures propagate to the owning operation; transactional writes roll back when the host boundary rejects.
   */
  transaction?: <R>(principal: PluginPrincipal, work: (store: PluginRecordStore<T>) => Promise<R>) => Promise<R>
}>(host: H, documents: readonly JsonDocumentContract[]): H {
 const copy = { ...host }
 if (host.store) copy.store = createValidatedRecordStore(host.store, documents)
 if (host.repository) copy.repository = createValidatedAtomicRepository(host.repository, documents)
 if (host.transaction) {
  const transaction = host.transaction.bind(host)
  copy.transaction = (principal, work) => transaction(principal, store => work(createValidatedRecordStore(store, documents)))
 }
 return new Proxy(copy, { get(target, key, receiver) {
  if (key === 'store' || key === 'repository' || key === 'transaction') return Reflect.get(target, key, receiver)
  const value = Reflect.get(host, key, host)
  return typeof value === 'function' ? value.bind(host) : value
 } })
}

/**
 * Resolve canonical payload document contracts for one verified Data Contract table/namespace binding.
 * @param catalog - Trusted resolved Data Contract catalog.
 * @param binding - Contract identity, table, namespace and optional declared document IDs.
 * @returns All matching payload document contracts for the bound table/namespace, possibly empty.
 * @throws Rejects missing/mismatched bindings, a table without id/revision/payload envelope fields or unavailable/duplicate requested document IDs.
 * @remarks Validates requested document selection but returns every matching namespace document, not only the requested-ID subset.
 * @example
 * import { recordDocuments } from '@alneas/eaos-server/plugin-data'
 * export function documents(catalog: Parameters<typeof recordDocuments>[0], binding: Parameters<typeof recordDocuments>[1]) { return recordDocuments(catalog, binding) }
 */
export function recordDocuments(catalog: DataContractCatalog, binding: DataContractBinding & {
  /**
   * Optional explicit nonempty unique document IDs to verify against the bound namespace; all matching namespace documents are returned.
   */
  jsonDocuments?: readonly string[]}): JsonDocumentContract[] {
 assertDataContractBinding(catalog, binding)
 const columns = catalog.tables.find(t => t.name === binding.table)!.schema.properties as Record<string, unknown>
 if (!columns.id || !columns.revision || !columns.payload) throw Error('Record stores require an envelope table with id, revision and payload')
 const documents = catalog.contracts.find(c => c.id === binding.contractId)!.jsonDocuments?.filter(d => d.table === binding.table && d.column === 'payload' && d.namespace === binding.namespace) ?? []
 if (binding.jsonDocuments !== undefined && (!binding.jsonDocuments.length || new Set(binding.jsonDocuments).size !== binding.jsonDocuments.length || binding.jsonDocuments.some(id => !documents.some(d => d.id === id)))) throw Error('Declared JSON document contract is unavailable for this storage binding')
 return documents
}

/**
 * Compile closed payload schemas and route records by longest canonical prefix without coercion or remote loading.
 * @param documents - Nonempty trusted document list; each binds column payload to a closed object schema.
 * @returns A synchronous (tenantId, record) assertion that accepts only matching identity, revision, immutability and schema.
 * @throws Rejects absent/open/ambiguous contracts at construction; assertions reject invalid IDs/revisions, unmatched routes, immutable replacements, schema or embedded-tenant mismatch.
 * @remarks Does not write records or prove live authorization; document definitions are cloned before compilation.
 * @example
 * import { createRecordDocumentValidator } from '@alneas/eaos-server/plugin-data'
 * export function validator(documents: Parameters<typeof createRecordDocumentValidator>[0]) { return createRecordDocumentValidator(documents) }
 */
export function createRecordDocumentValidator(documents: readonly JsonDocumentContract[]) {
 if (!documents.length) throw Error('Record document contracts are required')
 const routes = documents.map(document => {
  const copy = structuredClone(document)
  if (copy.column !== 'payload' || copy.schema.type !== 'object' || copy.schema.additionalProperties !== false) throw Error('Closed payload document contract required')
  return { document: copy, validate: createJsonDocumentAssertion(copy) }
 }).sort((a, b) => (b.document.recordPrefix ?? '').length - (a.document.recordPrefix ?? '').length)
 const prefixes = new Set<string>()
 for (const route of routes) { const prefix = route.document.recordPrefix ?? ''; if (prefixes.has(prefix)) throw Error('Ambiguous record document route'); prefixes.add(prefix) }
 return (tenantId: string, record: PluginRecord<unknown>): void => {
  assertBusinessId(tenantId); assertBusinessId(record.id)
  if (!Number.isSafeInteger(record.revision) || record.revision < 1) throw new PluginError(409, 'Invalid record revision')
  const route = routes.find(r => record.id.startsWith(r.document.recordPrefix ?? ''))
  if (!route) throw new PluginError(409, 'Record document contract unavailable')
  if (route.document.immutable && record.revision !== 1) throw new PluginError(409, 'Immutable document cannot be replaced')
  try { route.validate(record.value) } catch { throw new PluginError(409, `Record differs from JSON contract ${route.document.id}@${route.document.version}`) }
  const value = record.value as Record<string, unknown>
  if (Object.hasOwn(value, 'tenantId') && value.tenantId !== tenantId) throw new PluginError(409, 'JSON document tenant differs')
 }
}

/**
 * Validate canonical documents on host-store reads and writes while retaining its transaction semantics.
 * @param store - Existing host record store with real tenant/CAS behavior.
 * @param documents - Trusted canonical payload contracts to clone and enforce.
 * @typeParam T - JSON payload shape retained by the wrapped store.
 * @returns A wrapped store retaining optional listPage/delete capabilities when supplied.
 * @throws Invalid contracts throw at creation; operations reject mismatched IDs, invalid revision transitions/payloads and immutable deletion, with underlying errors propagated.
 * @remarks Does not add a transaction or independent authorization. Host returned list rows must still be correctly tenant-scoped.
 * @example
 * import { createValidatedRecordStore } from '@alneas/eaos-server/plugin-data'
 * export function store<T>(store: Parameters<typeof createValidatedRecordStore<T>>[0], documents: Parameters<typeof createValidatedRecordStore>[1]) { return createValidatedRecordStore(store, documents) }
 */
export function createValidatedRecordStore<T>(store: PluginRecordStore<T>, documents: readonly JsonDocumentContract[]): PluginRecordStore<T> {
 const ownedDocuments = structuredClone(documents)
 const validate = createRecordDocumentValidator(ownedDocuments)
 const check = (tenant: string, row: PluginRecord<T>) => { validate(tenant, row); return row }
 return {
  async read(tenant, id) { const row = await store.read(tenant, id); if (row && row.id !== id) throw new PluginError(409, 'Record identity differs'); return row && check(tenant, row) },
  async list(tenant, limit) { return (await store.list(tenant, limit)).map(row => check(tenant, row)) },
  ...(store.listPage ? { async listPage(tenant: string, limit: number, after?: string) { return (await store.listPage!(tenant, limit, after)).map(row => check(tenant, row)) } } : {}),
  async create(tenant, row) { if (row.revision !== 1) throw new PluginError(409, 'New record revision must be 1'); validate(tenant, row); await store.create(tenant, row) },
  async replace(tenant, row, expected) { if (!Number.isSafeInteger(expected) || expected < 1 || row.revision !== expected + 1) throw new PluginError(409, 'Invalid revision transition'); validate(tenant, row); return store.replace(tenant, row, expected) },
  ...(store.delete ? { delete: async (tenant: string, id: string, expected?: number) => { const immutable = [...ownedDocuments].sort((a,b) => (b.recordPrefix ?? '').length - (a.recordPrefix ?? '').length).find(d => id.startsWith(d.recordPrefix ?? ''))?.immutable; if (immutable) throw new PluginError(409, 'Immutable document cannot be deleted'); return store.delete!(tenant, id, expected) } } : {}),
 }
}

/**
 * Validate canonical document payloads inside the host repository's existing commit boundary.
 * @param repository - Real tenant-scoped atomic repository.
 * @param documents - Trusted canonical payload contracts copied for validation.
 * @returns A repository with validating, expiring sessions and retained joined-SQL capability bindings.
 * @throws Invalid contracts throw; work rejects wrong IDs/revisions/scopes, invalid batch order/length, expired sessions or payload/underlying repository failures.
 * @remarks Does not open a second transaction or authorize operations. Wrapper capabilities expire after the work callback and are removed in finally.
 * @example
 * import { createValidatedAtomicRepository } from '@alneas/eaos-server/plugin-data'
 * export function repository(repository: Parameters<typeof createValidatedAtomicRepository>[0], documents: Parameters<typeof createValidatedAtomicRepository>[1]) { return createValidatedAtomicRepository(repository, documents) }
 */
export function createValidatedAtomicRepository(repository: AtomicRepository, documents: readonly JsonDocumentContract[]): AtomicRepository {
 const validate = createRecordDocumentValidator(structuredClone(documents))
 return { async run(principal, work) {
  assertPrincipal(principal)
  const p = structuredClone(principal)
  return repository.run(p, async source => {
   let active=true
   const check=()=>{if(!active)throw Error('Transaction session expired')}
   const read=<T>(row: PluginRecord<T> | null, id?:string) => {
    check()
    if(row){if(id!==undefined && row.id!==id)throw Error('Record identity differs');validate(p.tenantId,row)}
    return row
   }
   const preflight=<T>(id:string,value:T,expected:number) => {
    check()
    if(!Number.isSafeInteger(expected)||expected<0||expected>=Number.MAX_SAFE_INTEGER)throw Error('Invalid expected revision')
    const row={id,value:structuredClone(value),revision:expected+1}
    validate(p.tenantId,row)
    return row
   }
   const session:AtomicSession={
    async get<T>(id:string){check();return read(await source.get<T>(id),id)},
    async list<T>(prefix:string,after?:string,limit?:number){check();const rows=await source.list<T>(prefix,after,limit);return rows.map(row=>{if(!row.id.startsWith(prefix))throw Error('Record list scope differs');return read(row)!})},
    async put<T>(id:string,value:T,expected:number){const row=preflight(id,value,expected);const saved=read(await source.put(id,row.value,expected),id)!;if(saved.revision!==row.revision)throw Error('Saved revision differs');return saved},
    ...(source.getMany?{async getMany<T>(ids:string[]){check();const rows=await source.getMany!<T>(ids);if(rows.length!==ids.length)throw Error('Batch read length differs');return rows.map((row,i)=>read(row,ids[i]))}}:{}),
    ...(source.putMany?{async putMany<T>(changes:{id:string;value:T;expected:number}[]){
     check();if(new Set(changes.map(c=>c.id)).size!==changes.length)throw Error('Duplicate batch record key')
     const rows=changes.map(c=>preflight(c.id,c.value,c.expected))
     const saved=await source.putMany!(changes.map((c,i)=>({...c,value:rows[i].value})))
     if(saved.length!==rows.length)throw Error('Batch write length differs')
     return saved.map((row,i)=>{const result=read(row,rows[i].id)!;if(result.revision!==rows[i].revision)throw Error('Saved revision differs');return result})
    }}:{}),
   }
   const release=inheritAtomicSqlSession(source,session)
   try{return await work(session)}finally{active=false;release()}
  })
 } }
}
