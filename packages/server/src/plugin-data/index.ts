import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { DataContractCatalog, JsonDocumentContract } from '@alneas/eaos-server/lifecycle-engine'
import { createRecordDocumentValidator, recordDocuments } from './json-documents'
import { assertPayloadWithinPolicy, resolvePluginStoragePolicy, type McpToolDefinition, type PluginManifest, type PluginStoragePolicy } from '@alneas/eaos-core/plugin-sdk'
export { RecordCommandService, type CommandHost, type CommandState, type CommandContext, type CommandResponse } from './commands'
export * from './atomic'
export * from './audit'
export * from './outbox'
export * from './scoped-records'
export * from './composite'
export * from './json-documents'
/**
 * Bind a service under the trusted context symbol for copied static MCP tool definitions.
 * @param service - Host-created service instance used by each copied tool handler.
 * @param tools - Static tool definitions whose handlers consume the service context symbol.
 * @param key - Trusted symbol agreed by the binder and operation handler.
 * @typeParam TService - Concrete host-created service type retained in the symbol binding.
 * @returns New tool objects with wrappers that preserve other context fields and override the service symbol.
 * @remarks Does not resolve identity or grant permission. Tool execution still requires verified principal context and live host admission.
 * @example
 * import { createMcpToolBinder } from '@alneas/eaos-server/plugin-data'
 * export function bindTools<T>(service: T, tools: Parameters<typeof createMcpToolBinder>[1], key: symbol) { return createMcpToolBinder(service, tools, key) }
 */
export function createMcpToolBinder<TService>(service: TService, tools: readonly import('@alneas/eaos-core/plugin-sdk').McpToolDefinition[], key: symbol): import('@alneas/eaos-core/plugin-sdk').McpToolDefinition[] {
 return tools.map(tool => ({ ...tool, handler: (args, context) => tool.handler(args, { ...context, [key]: service }) }))
}
/**
 * Create a static operation handler that dispatches through a host-bound service instance.
 * @param operation - Trusted operation name selected by the manifest author.
 * @param key - Service-binding symbol used by createMcpToolBinder.
 * @typeParam TService - Host service exposing the principal-aware execute contract.
 * @returns An async handler accepting tool arguments and trusted principal/service context.
 * @throws The returned handler rejects when the service is absent or has no execute method; service failures propagate.
 * @remarks The incoming context must already contain a verified PluginPrincipal. This helper neither authenticates a request nor verifies live resource access.
 * @example
 * import { createMcpOperationHandler } from '@alneas/eaos-server/plugin-data'
 * const key = Symbol('service')
 * const handler = createMcpOperationHandler('list', key)
 */
export function createMcpOperationHandler<TService extends { 
  /**
   * Service operation dispatch contract; callers must supply host-verified principal context and perform live admission.
   * @param principal - Verified current tenant/user principal.
   * @param operation - Declared operation name.
   * @param input - Operation input to validate and authorize at the owning service boundary.
   * @returns The service operation result; authorization and validation stay owner-controlled.
   * @throws Rejects underlying service, authorization or persistence failures.
   */
  execute(principal: PluginPrincipal, operation: string, input: unknown): Promise<unknown> }>(operation: string, key: symbol) {
 return async (args: unknown, context?: Record<PropertyKey, unknown>) => { const service = context?.[key] as TService | undefined; if (!service || typeof service.execute !== 'function') throw new Error('Use createPlugin with verified principal'); return service.execute((context ?? {}) as unknown as PluginPrincipal, operation, args) }
}
/**
 * Structurally verified tenant/user identity supplied by a trusted host authentication boundary.
 * 
 * @see createPluginRouter for canonical host integration.
 */
export interface PluginPrincipal {
  /**
   * Tenant identity bound by the trusted principal; never selected as an authorization grant from request data.
   */
  tenantId: string;
  /**
   * Authenticated actor identity supplied by the host.
   */
  userId: string;
  /**
   * Current host-verified role names; structural validation alone does not grant permission.
   */
  roles: readonly string[] }
/**
 * Logical record identity, CAS revision and JSON payload envelope.
 * @typeParam T - Stored JSON payload shape; compile-time typing does not itself validate data.
 * 
 * @see createSqlRecordStore for canonical host integration.
 */
export interface PluginRecord<T> {
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
 * Host record persistence contract requiring tenant predicates and atomic revision-predicated writes.
 * 
 * Providers must enforce tenant keys and atomic compare-and-swap, never read/update without the revision predicate.
 * @typeParam T - Stored payload shape shared by all scoped persistence operations.
 * 
 * @see createSqlRecordStore for canonical host integration.
 */
export interface PluginRecordStore<T> {
  /**
   * Reads one record within the exact tenant and logical namespace.
   * @param tenantId - Verified tenant ID supplied by the host.
   * @param id - Logical record ID within this store.
   * @returns The matching envelope or null when absent.
   * @throws Rejects propagated host persistence, validation or callback failures.
   
   * @example
   * ```typescript
   * import type { PluginRecordStore, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function readTitle(store: PluginRecordStore<{ title: string }>, principal: PluginPrincipal, id: string) {
   *   const record = await store.read(principal.tenantId, id);
   *   return record?.value.title ?? null;
   * }
   * ```
   */
  read(tenantId: string, id: string): Promise<PluginRecord<T> | null>
  /**
   * Reads a bounded set of envelopes from one tenant and namespace.
   * @param tenantId - Verified tenant ID.
   * @param limit - Required provider-supported maximum row count; canonical SQL stores accept integers 1–100.
   * @returns Scoped envelopes, possibly empty; filtering this bounded set does not prove completeness.
   * @throws Rejects propagated host persistence, validation or callback failures.
   
   * @example
   * ```typescript
   * import type { PluginRecordStore, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function firstPage(store: PluginRecordStore<{ title: string }>, principal: PluginPrincipal) {
   *   return store.list(principal.tenantId, 20);
   * }
   * ```
   */
  list(tenantId: string, limit: number): Promise<PluginRecord<T>[]>
  /**
   * Reads a stable ID-ordered page after an optional exclusive logical record ID.
   * 
   * Optional stable ID keyset paging; after is an exclusive logical record ID.
   * @param tenantId - Verified tenant ID.
   * @param limit - Required bounded page size; canonical SQL stores accept 1–100.
   * @param after - Optional exclusive logical record ID; omitted starts the page.
   * @returns Scoped envelopes in increasing logical-ID order; fewer than limit indicates the end.
   * @throws Rejects propagated host persistence, validation or callback failures.
   
   * @example
   * ```typescript
   * import type { PluginRecordStore, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function nextPage(store: PluginRecordStore<{ title: string }>, principal: PluginPrincipal, after: string) {
   *   if (!store.listPage) throw new Error("Keyset paging not supported");
   *   return store.listPage(principal.tenantId, 20, after);
   * }
   * ```
   */
  listPage?(tenantId: string, limit: number, after?: string): Promise<PluginRecord<T>[]>
  /**
   * Creates a previously absent tenant record with its initial stored revision.
   * @param tenantId - Verified tenant ID owning the new record.
   * @param record - New logical envelope; canonical validated/atomic stores require revision 1.
   * @returns Resolves without a value after durable creation.
   * @throws Rejects duplicate identity, invalid document/payload/revision or persistence failure.
   
   * @example
   * ```typescript
   * import type { PluginRecordStore, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function createTitle(store: PluginRecordStore<{ title: string }>, principal: PluginPrincipal, id: string, title: string) {
   *   // Live create permission must be checked before persistence.
   *   await store.create(principal.tenantId, { id, revision: 1, value: { title } });
   * }
   * ```
   */
  create(tenantId: string, record: PluginRecord<T>): Promise<void>
  /**
   * Replaces a tenant record only when its stored revision matches the expected value.
   * @param tenantId - Verified tenant ID.
   * @param record - Next envelope whose revision must be expectedRevision+1.
   * @param expectedRevision - Positive previously observed CAS revision.
   * @returns True when one row is replaced; false for stale rows in plain SQL stores. Atomic adapters reject CAS conflicts instead of returning false.
   * @throws Rejects invalid revision/document/payload or provider failure; atomic adapters also reject stale CAS.
   
   * @example
   * ```typescript
   * import type { PluginRecordStore, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function replaceTitle(store: PluginRecordStore<{ title: string }>, principal: PluginPrincipal, id: string, expectedRevision: number, title: string) {
   *   return store.replace(principal.tenantId, { id, revision: expectedRevision + 1, value: { title } }, expectedRevision);
   * }
   * ```
   */
  replace(tenantId: string, record: PluginRecord<T>, expectedRevision: number): Promise<boolean>
  /**
   * Optionally deletes one scoped envelope with an optional revision predicate.
   * @param tenantId - Verified tenant ID.
   * @param id - Logical record ID.
   * @param expectedRevision - Optional expected CAS revision; omit only when unconditional scoped deletion is intended.
   * @returns Whether a row was deleted; immutable document wrappers reject instead.
   * @throws Rejects immutable document deletion or host persistence failure.
   
   * @example
   * ```typescript
   * import type { PluginRecordStore, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function deleteReviewed(store: PluginRecordStore<{ title: string }>, principal: PluginPrincipal, id: string, expectedRevision: number) {
   *   if (!store.delete) throw new Error("Deletion not supported");
   *   return store.delete(principal.tenantId, id, expectedRevision);
   * }
   * ```
   */
  delete?(tenantId: string, id: string, expectedRevision?: number): Promise<boolean>
}
/**
 * Carries an intentional sanitized plugin HTTP error status while preserving the caller-provided message.
 * 
 * @remarks
 * createPluginRouter returns this message/status to HTTP callers; exclude secrets, provider details and business payloads from messages.
 * 
 * @example
 * ```typescript
 * import { PluginError } from '@alneas/eaos-server/plugin-data';
 * const unavailable = new PluginError(404, 'Record unavailable');
 * ```
 */
export class PluginError extends Error {
  /**
   * Creates an intentional plugin failure with one supported client-facing HTTP status.
   * @param status - Supported bad-input/authentication/permission/missing/conflict/gone HTTP status.
   * @param message - Safe public error description exposed by createPluginRouter.
   * 
   * @example
   * ```typescript
   * import { PluginError } from '@alneas/eaos-server/plugin-data';
   * const denied = new PluginError(403, 'Record access denied');
   * ```
   */
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 410, message: string) { super(message) }
}
function storagePayload(policy: PluginStoragePolicy, value: unknown): string {
 try { return assertPayloadWithinPolicy(policy, value) } catch (error) {
  if (error instanceof Error && error.message === 'Storage policy payload limit exceeded') throw new PluginError(409, error.message)
  throw error
 }
}
/**
 * Check the structural presence of a nonblank tenant/user identity and string role list.
 * @param p - Principal from a trusted authentication resolver.
 * @returns No value; normal completion means the principal has the required shape.
 * @throws Throws PluginError 401 for malformed principal fields.
 * @remarks Shape validation is not authentication, membership verification or resource authorization.
 * @example
 * import { assertPrincipal } from '@alneas/eaos-server/plugin-data'
 * assertPrincipal({ tenantId: 'example-tenant', userId: 'example-user', roles: [] })
 */
export function assertPrincipal(p: PluginPrincipal): void {
 if (!p || typeof p.tenantId !== 'string' || !p.tenantId.trim() || typeof p.userId !== 'string' || !p.userId.trim() || !Array.isArray(p.roles) || p.roles.some(r => typeof r !== 'string')) throw new PluginError(401, 'Authenticated principal required')
}
/**
 * Hono variables carrying the principal resolved by the trusted plugin router.
 * 
 * @see createPluginRouter for canonical host integration.
 */
export type PluginHttpEnv = { 
  /**
   * Hono variables populated by the trusted principal resolver before operation routes run.
   */
  Variables: { 
    /**
     * Verified principal resolved for this request; still subject to current service authorization.
     */
    principal: PluginPrincipal } }
/**
 * Host-owned request-body bound for the shared authenticated plugin router.
 * 
 * @see createPluginRouter for canonical host integration.
 */
export interface PluginRouterOptions {
  /**
   * Request body size in bytes; defaults to 131072 and must be an integer from 1024 to 8388608.
   * 
   * Trusted host bound, never request-controlled. Default 128KiB.
   */ maxBodyBytes?:number }
/**
 * Create a bounded Hono router that resolves a verified principal for every request.
 * @param resolvePrincipal - Async host callback returning the authenticated principal or null; host owns current session validation.
 * @param options - Trusted body bound, default 128 KiB; accepted integer range is 1024 bytes through 8 MiB.
 * @returns A Hono router with body limits, scoped principal context and sanitized generic failure responses.
 * @throws Invalid body limits throw at construction. Request-time missing/malformed principals produce 401; unexpected failures become sanitized 500 responses.
 * @remarks Does not supply CSRF/Origin protection or per-resource authorization; compose those at the host/service boundary.
 * @example
 * import { createPluginRouter } from '@alneas/eaos-server/plugin-data'
 * export function routes(resolvePrincipal: Parameters<typeof createPluginRouter>[0]) { return createPluginRouter(resolvePrincipal) }
 */
export function createPluginRouter(resolvePrincipal: (c: Context) => Promise<PluginPrincipal | null>, options:PluginRouterOptions={}) {
 const maxSize=options.maxBodyBytes??128*1024
 if(!Number.isSafeInteger(maxSize)||maxSize<1024||maxSize>8*1024*1024)throw Error('Invalid plugin request body bound')
 const app = new Hono<PluginHttpEnv>()
 app.use('*', bodyLimit({ maxSize, onError: c => c.json({ error: 'Request body too large' }, 413) }))
 app.use('*', async (c, next) => { const p = await resolvePrincipal(c); if (!p) throw new PluginError(401, 'Unauthorized'); assertPrincipal(p); c.set('principal', p); await next() })
 app.onError((e, c) => c.json({ error: e instanceof PluginError ? e.message : 'Plugin operation failed' }, e instanceof PluginError ? e.status : 500))
 return app
}
type StandardPluginService = { 
  /**
   * Principal-aware operation dispatcher shared by HTTP and MCP; the concrete service owns schema checks and current resource permission.
   * @param principal - Verified current tenant/user principal.
   * @param operation - Declared operation name.
   * @param input - Operation input to validate and authorize at the owning service boundary.
   * @returns The service operation result; authorization and validation stay owner-controlled.
   * @throws Rejects underlying service, authorization or persistence failures.
   */
  execute(principal: PluginPrincipal, operation: string, input: Record<string, any>): Promise<unknown> }
/**
 * Compose a service-backed authenticated operation router and bound static MCP tools.
 * @param manifest - Plugin metadata whose capabilities remain subject to host admission.
 * @param ServiceClass - Trusted service constructor invoked once with options.
 * @param bindTools - Synchronous tool binder invoked with that same service instance.
 * @param options - Real store, authorization and other service configuration.
 * @param resolvePrincipal - Async trusted request-to-principal resolver; required.
 * @param configureRoutes - Optional synchronous callback adding routes using the same service instance.
 * @param routerOptions - Optional host-owned request body bound.
 * @typeParam TOptions - Host service configuration passed unchanged to the constructor.
 * @typeParam TService - Principal-aware service implementation shared by HTTP and MCP.
 * @returns Manifest fields plus createRoutes() and bound MCP definitions.
 * @throws Missing principal resolver or constructor/router/binder/configuration failures propagate.
 * @remarks Mounting the server does not activate tenants. HTTP and MCP hosts must enforce their current lifecycle/resource admission; static tool binding alone does not do that.
 * @example
 * import { createStandardPluginServer } from '@alneas/eaos-server/plugin-data'
 * export function bindServer(...args: Parameters<typeof createStandardPluginServer>) { return createStandardPluginServer(...args) }
 */
export function createStandardPluginServer<TOptions, TService extends StandardPluginService>(
 manifest: PluginManifest,
 ServiceClass: new (options: TOptions) => TService,
 bindTools: (service: TService) => McpToolDefinition[],
 options: TOptions,
 resolvePrincipal: (c: Context) => Promise<PluginPrincipal | null>,
 configureRoutes?: (routes: ReturnType<typeof createPluginRouter>, service: TService) => void,
 routerOptions?:PluginRouterOptions,
) {
 if (typeof resolvePrincipal !== 'function') throw new Error('Verified principal resolver required')
 const service = new ServiceClass(options), routes = createPluginRouter(resolvePrincipal,routerOptions)
 configureRoutes?.(routes, service)
 routes.post('/:operation', async c => c.json(await service.execute(c.get('principal'), c.req.param('operation'), await jsonBody(c))))
 return { ...manifest, createRoutes: () => routes, mcp: { tools: bindTools(service) } }
}
/**
 * Read a JSON object request body with explicit content-type and shape checks.
 * @param c - Hono request context, normally protected by the plugin router body limit.
 * @returns Parsed nonnull object payload; arrays and primitives are rejected.
 * @throws Rejects non-JSON content types and malformed/nonobject JSON with PluginError 400.
 * @remarks This helper does not enforce a body-size bound, tenant identity or operation schema on its own.
 * @example
 * import { jsonBody } from '@alneas/eaos-server/plugin-data'
 * export async function readRequest(c: Parameters<typeof jsonBody>[0]) { return jsonBody(c) }
 */
export async function jsonBody(c: Context): Promise<Record<string, any>> {
 if (!/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')) throw new PluginError(400, 'JSON body required')
 const value = await c.req.json().catch(() => null)
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PluginError(400, 'JSON object required')
 return value
}
/**
 * Reject top-level object keys not present in an explicit operation allowlist.
 * @param value - Object whose own enumerable string keys are inspected.
 * @param keys - Trusted allowed top-level key names.
 * @returns No value when all existing keys are allowed.
 * @throws Throws PluginError 400 when an unknown key is present.
 * @remarks Does not require listed keys to exist or validate nested fields.
 * @example
 * import { exactKeys } from '@alneas/eaos-server/plugin-data'
 * exactKeys({ title: 'Example' }, ['title'])
 */
export function exactKeys(value: object, keys: string[]): void { if (Object.keys(value).some(k => !keys.includes(k))) throw new PluginError(400, 'Unknown input field') }
/**
 * Validate bounded nonblank string input while preserving the original whitespace.
 * @param value - Untrusted value to validate.
 * @param name - Trusted field label used in the failure message.
 * @param max - Maximum JavaScript string length; defaults to 256.
 * @returns The original string without trimming.
 * @throws Throws PluginError 400 if input is not a string, trims to empty or exceeds max.
 * @example
 * import { textInput } from '@alneas/eaos-server/plugin-data'
 * const title = textInput('Example', 'title', 80)
 */
export function textInput(value: unknown, name: string, max = 256): string { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new PluginError(400, `Invalid ${name}`); return value }
/**
 * Require a positive safe-integer revision without coercing string inputs.
 * @param value - Untrusted revision value.
 * @returns The positive safe-integer revision.
 * @throws Throws PluginError 400 for nonintegers, numeric strings, zero, negatives or unsafe integers.
 * @example
 * import { revisionInput } from '@alneas/eaos-server/plugin-data'
 * const revision = revisionInput(1)
 */
export function revisionInput(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new PluginError(400, 'Revision required'); return Number(value) }
/**
 * Parameterized SQL transport whose host owns tenant session, transaction and provider binding behavior.
 * 
 * @see createSqlRecordStore for canonical host integration.
 */
export interface RecordSqlDriver {
  /**
   * SQL placeholder/driver dialect selected by trusted host configuration.
   */
  dialect: 'sqlite' | 'postgres' | 'oracle'
  /**
   * Executes trusted parameterized SQL through the host-selected tenant session or transport.
   * 
   * Bind arrays are positional. Host owns transaction/commit, Oracle CLOB bindings and authenticated tenant session.
   * @param tenantId - Verified tenant context for host routing/session setup; it is not an independent permission proof.
   * @param sql - Trusted SQL containing explicit tenant predicates; never untrusted SQL text.
   * @param bindings - Positional binds in SQL placeholder order; host handles Oracle CLOB/session details.
   * @returns Optional row data and affected-row count; CAS callers require accurate affectedRows.
   * @throws Rejects propagated host persistence, validation or callback failures.
   
   * @example
   * ```typescript
   * import type { RecordSqlDriver, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function queryTenant(driver: RecordSqlDriver, principal: PluginPrincipal, trustedSql: string, bindings: unknown[]) {
   *   // The host supplies dialect-correct SQL with explicit tenant predicates.
   *   const result = await driver.execute(principal.tenantId, trustedSql, bindings);
   *   return result.rows ?? [];
   * }
   * ```
   */
  execute(tenantId: string, sql: string, bindings: unknown[]): Promise<{ 
    /**
     * Optional SQL result rows using host provider object-column names.
     */
    rows?: Record<string, unknown>[]; 
    /**
     * Accurate DML row count; required by revision-predicated replace.
     */
    affectedRows?: number }>
}
/**
 * Manifest namespace, payload limits and optional canonical JSON document validation for SQL records.
 * 
 * @see createSqlRecordStore for canonical host integration.
 */
export interface SqlRecordStoreOptions {
  /**
   * Optional trusted logical namespace encoded into physical IDs for a shared table.
   * 
   * Logical namespace encoded into the trusted physical id for a shared foundation table.
   */
  namespace?: string
  /**
   * Declared payload/object/history limits; does not configure or authorize a provider.
   * 
   * Payload/object/history policy declared by the plugin manifest.
   */
  storagePolicy?: PluginStoragePolicy
  /**
   * Canonical closed payload contracts copied and enforced by the wrapper.
   */
  documents?: readonly JsonDocumentContract[]
}
function validateNamespace(namespace: string): string {
 if (!/^[a-z][a-z0-9_]{0,62}$/.test(namespace)) throw new Error('Invalid plugin storage namespace')
 return `${namespace}:`
}
/**
 * Bind JSON record persistence to a trusted table, namespace and host SQL driver.
 * @param table - Trusted lowercase table identifier, never a request-selected name.
 * @param driver - Tenant-aware SQL transport; host owns transactions, Oracle binding/session cleanup and current authorization.
 * @param options - Optional namespace, payload policy and canonical JSON document contracts.
 * @typeParam T - Stored JSON payload type; runtime shape is enforced only when canonical document contracts are supplied.
 * @returns A record store with tenant predicates, keyset reads and revision-predicated replace/delete operations.
 * @throws Rejects invalid table/namespace/document bindings. Operations propagate provider errors, reject invalid limits/revisions/payloads and map duplicate keys to PluginError 409.
 * @remarks Does not create/migrate tables or add a shared transaction around separate calls. Driver affected-row reporting is required for CAS correctness; hosts enforce live authorization.
 * @example
 * import { createSqlRecordStore } from '@alneas/eaos-server/plugin-data'
 * export function records(driver: Parameters<typeof createSqlRecordStore>[1]) { return createSqlRecordStore<{ title: string }>('example_records', driver) }
 */
export function createSqlRecordStore<T>(table: string, driver: RecordSqlDriver, options: SqlRecordStoreOptions = {}): PluginRecordStore<T> {
 if (!/^[a-z][a-z0-9_]{0,62}$/.test(table)) throw new Error('Invalid plugin table')
 const prefix = options.namespace ? validateNamespace(options.namespace) : ''
 const storagePolicy = resolvePluginStoragePolicy(options.storagePolicy)
 const documents = options.documents && structuredClone(options.documents)
 if (documents?.some(d => d.table !== table || d.namespace !== options.namespace)) throw Error('JSON document storage binding differs')
 const validateDocument = documents && createRecordDocumentValidator(documents)
 const physicalId = (id: string) => {
  if (prefix && id.length + prefix.length > 256) throw new PluginError(400, 'Record id is too long for the shared plugin table')
  return `${prefix}${id}`
 }
 const logicalId = (id: string) => prefix ? (id.startsWith(prefix) ? id.slice(prefix.length) : null) : id
 const bind = (i: number) => driver.dialect === 'postgres' ? `$${i}` : driver.dialect === 'oracle' ? `:${i}` : '?'
 const decode = (tenant: string, row: Record<string, unknown>): PluginRecord<T> => {
  const id = logicalId(String(row.id ?? row.ID))
  if (id === null || !id) throw new Error('Record belongs to another plugin storage namespace')
  const record = { id, revision: Number(row.revision ?? row.REVISION), value: JSON.parse(String(row.payload ?? row.PAYLOAD)) }
  validateDocument?.(tenant, record)
  return record
 }
 const listPage = async (tenant: string, limit: number, after = '') => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new PluginError(400, 'Limit must be between 1 and 100')
  if (after && (typeof after !== 'string' || !/^[A-Za-z0-9_.:/-]{1,240}$/.test(after))) throw new PluginError(400, 'Invalid page position')
  const bindings: unknown[] = [tenant], filters = [`tenant_id = ${bind(1)}`]
  if (prefix) { bindings.push(prefix, prefix.slice(0,-1)+';'); filters.push(`id >= ${bind(bindings.length-1)} AND id < ${bind(bindings.length)}`) }
  if (after) { bindings.push(physicalId(after)); filters.push(`id > ${bind(bindings.length)}`) }
  const tail = driver.dialect === 'oracle' ? `FETCH FIRST ${limit} ROWS ONLY` : `LIMIT ${limit}`
  return (await driver.execute(tenant, `SELECT id, revision, payload FROM ${table} WHERE ${filters.join(' AND ')} ORDER BY id ${tail}`, bindings)).rows?.map(row => decode(tenant, row)) ?? []
 }
 return {
  async read(tenant, id) { const result = await driver.execute(tenant, `SELECT id, revision, payload FROM ${table} WHERE tenant_id = ${bind(1)} AND id = ${bind(2)}`, [tenant, physicalId(id)]); return result.rows?.[0] ? decode(tenant, result.rows[0]) : null },
  list: (tenant,limit) => listPage(tenant,limit),
  listPage,
  async create(tenant, record) { if (validateDocument && record.revision !== 1) throw new PluginError(409, 'New record revision must be 1'); validateDocument?.(tenant, record); const payload = storagePayload(storagePolicy, record.value); try { await driver.execute(tenant, `INSERT INTO ${table} (tenant_id, id, revision, payload) VALUES (${bind(1)}, ${bind(2)}, ${bind(3)}, ${bind(4)})`, [tenant, physicalId(record.id), record.revision, payload]) } catch (error: any) { if (['SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE', '23505', 'ORA-00001'].includes(error?.code) || error?.errorNum === 1) throw new PluginError(409, 'Record already exists'); throw error } },
  async replace(tenant, record, expected) {
   if (!Number.isSafeInteger(expected) || expected < 1 || record.revision !== expected + 1) throw new Error('Invalid revision transition')
   validateDocument?.(tenant, record)
   const result = await driver.execute(tenant, `UPDATE ${table} SET revision = ${bind(1)}, payload = ${bind(2)} WHERE tenant_id = ${bind(3)} AND id = ${bind(4)} AND revision = ${bind(5)}`, [record.revision, storagePayload(storagePolicy, record.value), tenant, physicalId(record.id), expected])
   if (typeof result.affectedRows !== 'number') throw new Error('Record driver must report affectedRows')
   return result.affectedRows === 1
  },
  async delete(tenant, id, expected) {
   if (documents?.filter(d => id.startsWith(d.recordPrefix ?? '')).sort((a,b) => (b.recordPrefix ?? '').length - (a.recordPrefix ?? '').length)[0]?.immutable) throw new PluginError(409, 'Immutable document cannot be deleted')
   const hasRevision = typeof expected === 'number'
   const sql = hasRevision
    ? `DELETE FROM ${table} WHERE tenant_id = ${bind(1)} AND id = ${bind(2)} AND revision = ${bind(3)}`
    : `DELETE FROM ${table} WHERE tenant_id = ${bind(1)} AND id = ${bind(2)}`
   const bindings = hasRevision ? [tenant, physicalId(id), expected] : [tenant, physicalId(id)]
   const result = await driver.execute(tenant, sql, bindings)
   return (result.affectedRows ?? 0) >= 1
  },
 }
}

/**
 * Structural subset of the D1 prepared-statement API used by the record adapter.
 * 
 * @see createCloudflareD1Driver for canonical host integration.
 */
export interface CloudflareD1PreparedStatement {
  /**
   * Binds positional query values to a prepared Worker D1 statement.
   * @param values - Positional values in SQL placeholder order.
   * @returns The bound prepared statement used for all/run.
   * @throws Provider binding errors throw synchronously.
   
   * @example
   * ```typescript
   * import type { CloudflareD1Binding } from '@alneas/eaos-server/plugin-data';
   * export async function readProjection(db: CloudflareD1Binding, tenantId: string) {
   *   const statement = db.prepare("SELECT ? AS tenant_id").bind(tenantId);
   *   return (await statement.all<{ tenant_id: string }>()).results ?? [];
   * }
   * ```
   */
  bind(...values: unknown[]): CloudflareD1PreparedStatement
  /**
   * Executes a prepared D1 read and resolves its structural query result.
   * @typeParam T - Returned query row shape; defaults to a string-keyed unknown-value record.
   * @returns Optional typed results and provider change metadata.
   * @throws Rejects provider query failures.
   
   * @example
   * ```typescript
   * import type { CloudflareD1Binding } from '@alneas/eaos-server/plugin-data';
   * export async function projection(db: CloudflareD1Binding, tenantId: string) {
   *   const result = await db.prepare("SELECT ? AS tenant_id").bind(tenantId).all<{ tenant_id: string }>();
   *   return result.results ?? [];
   * }
   * ```
   */
  all<T = Record<string, unknown>>(): Promise<{ 
    /**
     * Optional query rows with the caller-selected row shape.
     */
    results?: T[]; 
    /**
     * Optional provider execution metadata.
     */
    meta?: { 
      /**
       * Optional provider affected-row count; record driver normalizes absence to 0.
       */
      changes?: number } }>
  /**
   * Executes a prepared D1 write and resolves provider change metadata.
   * @returns Optional meta.changes affected-row metadata.
   * @throws Rejects provider execution failures.
   
   * @example
   * ```typescript
   * import type { CloudflareD1Binding } from '@alneas/eaos-server/plugin-data';
   * export async function executeReviewed(db: CloudflareD1Binding, trustedTenantDml: string, bindings: unknown[]) {
   *   // Supply parameterized DML whose bindings include the authorized tenant.
   *   const result = await db.prepare(trustedTenantDml).bind(...bindings).run();
   *   return result.meta?.changes ?? 0;
   * }
   * ```
   */
  run(): Promise<{ 
    /**
     * Optional provider execution metadata.
     */
    meta?: { 
      /**
       * Optional provider affected-row count; record driver normalizes absence to 0.
       */
      changes?: number } }>
}

/**
 * Trusted Worker D1 binding supplied by the host runtime.
 * 
 * @see createCloudflareD1Driver for canonical host integration.
 */
export interface CloudflareD1Binding {
  /**
   * Prepares trusted parameterized SQL on the installed Worker D1 binding.
   * @param query - Trusted SQL text; caller must bind tenant predicates.
   * @returns A statement exposing bind/all/run.
   * @throws Provider preparation errors throw synchronously.
   
   * @example
   * ```typescript
   * import type { CloudflareD1Binding } from '@alneas/eaos-server/plugin-data';
   * export async function tenantProjection(db: CloudflareD1Binding, tenantId: string) {
   *   const statement = db.prepare("SELECT ? AS tenant_id");
   *   return (await statement.bind(tenantId).all()).results ?? [];
   * }
   * ```
   */
  prepare(query: string): CloudflareD1PreparedStatement
}

/**
 * Explicit Worker or HTTP transport configuration for the server-side D1 record driver.
 * 
 * @see createCloudflareD1Driver for canonical host integration.
 */
export interface CloudflareD1DriverOptions {
  /**
   * Optional trusted Worker D1 binding; takes precedence over HTTP credentials when valid.
   * 
   * Direct Cloudflare Workers D1 binding (`env.DB`), when running inside a Worker.
   */
  binding?: CloudflareD1Binding
  /**
   * Cloudflare account identity required by HTTP mode.
   * 
   * Cloudflare Account ID for remote D1 HTTP API access (e.g. from OCI server or CLI).
   */
  accountId?: string
  /**
   * Cloudflare D1 database identity required by HTTP mode.
   * 
   * Cloudflare D1 Database UUID for remote D1 HTTP API access.
   */
  databaseId?: string
  /**
   * Sensitive host API token required by HTTP mode; never expose to browser entries or docs examples.
   * 
   * Cloudflare API Token with D1:Edit permission for remote D1 HTTP API access.
   */
  apiToken?: string
  /**
   * Optional trusted fetch implementation; defaults to globalThis.fetch.
   * 
   * Optional custom fetch implementation for D1 HTTP API calls.
   */
  fetch?: typeof globalThis.fetch
  /**
   * Trusted HTTP API base; defaults to https://api.cloudflare.com/client/v4.
   * 
   * Optional Cloudflare API base URL override (defaults to `https://api.cloudflare.com/client/v4`).
   */
  apiBaseUrl?: string
  /**
   * Optional trusted table name; when supplied the first query runs CREATE TABLE IF NOT EXISTS. Omit when schema lifecycle is independently managed.
   * 
   * Optional table name (e.g. `'eaos_customer_records'`) to auto-create via `CREATE TABLE IF NOT EXISTS` on first query.
   */
  autoBootstrapTable?: string
}

function normalizeD1ConstraintError(error: unknown): never {
 const message = error instanceof Error ? error.message : String(error)
 if (/UNIQUE constraint failed|PRIMARY KEY constraint failed|SQLITE_CONSTRAINT/i.test(message)) {
  const constraintErr = new Error(message) as Error & { code: string }
  constraintErr.code = 'SQLITE_CONSTRAINT_PRIMARYKEY'
  throw constraintErr
 }
 throw error instanceof Error ? error : new Error(message)
}

/**
 * Create a SQLite-dialect record driver using a Worker D1 binding or the explicit Cloudflare HTTP query endpoint.
 * @param options - Trusted binding or complete account/database/token credentials; an available binding takes precedence over HTTP configuration.
 * @returns A RecordSqlDriver whose execute method uses the selected D1 transport.
 * @throws Rejects absent transport or invalid bootstrap table name; query/HTTP failures propagate and duplicate-key failures are normalized.
 * @remarks The execute tenantId is not an independent authorization boundary; SQL callers must bind tenant predicates. autoBootstrapTable optionally executes CREATE TABLE on the first query; omit it when schemas are managed separately. Credentials and custom fetch/base URL are trusted server configuration.
 * @example
 * import { createCloudflareD1Driver } from '@alneas/eaos-server/plugin-data'
 * export function d1(options: Parameters<typeof createCloudflareD1Driver>[0]) { return createCloudflareD1Driver(options) }
 */
export function createCloudflareD1Driver(options: CloudflareD1DriverOptions): RecordSqlDriver {
 const hasBinding = Boolean(options.binding && typeof options.binding.prepare === 'function')
 const hasHttp = Boolean(options.accountId?.trim() && options.databaseId?.trim() && options.apiToken?.trim())
 if (!hasBinding && !hasHttp) {
  throw new Error('Cloudflare D1 driver requires either a Worker D1 binding or accountId, databaseId, and apiToken')
 }
 const bootstrapTable = options.autoBootstrapTable
 if (bootstrapTable && !/^[a-z][a-z0-9_]{0,62}$/.test(bootstrapTable)) {
  throw new Error('Invalid D1 bootstrap table name')
 }
 const fetcher = options.fetch ?? globalThis.fetch
 const apiBase = (options.apiBaseUrl ?? 'https://api.cloudflare.com/client/v4').replace(/\/$/, '')
 let bootstrapped = !bootstrapTable

 const runRaw = async (sql: string, bindings: unknown[]): Promise<{ rows?: Record<string, unknown>[]; affectedRows?: number }> => {
  const isSelect = /^\s*SELECT\b/i.test(sql)
  try {
   if (hasBinding && options.binding) {
    const stmt = options.binding.prepare(sql).bind(...bindings)
    if (isSelect) {
     const res = await stmt.all<Record<string, unknown>>()
     return { rows: res.results ?? [], affectedRows: res.meta?.changes ?? 0 }
    }
    const res = await stmt.run()
    return { rows: [], affectedRows: res.meta?.changes ?? 0 }
   }
   const url = `${apiBase}/accounts/${encodeURIComponent(options.accountId!)}/d1/database/${encodeURIComponent(options.databaseId!)}/query`
   const response = await fetcher(url, {
    method: 'POST',
    headers: {
     'Authorization': `Bearer ${options.apiToken!}`,
     'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params: bindings }),
   })
   const body = (await response.json().catch(() => null)) as {
    success?: boolean
    errors?: Array<{ message?: string }>
    result?: Array<{ results?: Record<string, unknown>[]; meta?: { changes?: number } }>
   } | null
   if (!response.ok || !body?.success) {
    const errMsg = body?.errors?.map(e => e.message).filter(Boolean).join('; ') || `D1 HTTP query failed (${response.status})`
    return normalizeD1ConstraintError(new Error(errMsg))
   }
   const first = body.result?.[0]
   return {
    rows: first?.results ?? [],
    affectedRows: typeof first?.meta?.changes === 'number' ? first.meta.changes : 0,
   }
  } catch (error) {
   return normalizeD1ConstraintError(error)
  }
 }

 return {
  dialect: 'sqlite',
  async execute(_tenantId, sql, bindings) {
   if (!bootstrapped && bootstrapTable) {
    await runRaw(
     `CREATE TABLE IF NOT EXISTS ${bootstrapTable} (tenant_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (tenant_id, id))`,
     [],
    )
    bootstrapped = true
   }
   return runRaw(sql, bindings)
  },
 }
}

/**
 * Resolve a manifest-owned storage table and optional canonical namespace/document bindings.
 * @param manifest - Trusted plugin schema with one owned table or an explicit shared-storage binding.
 * @param driver - Host SQL transport used by the resulting store.
 * @param catalog - Required trusted Data Contract catalog for shared-storage bindings.
 * @typeParam T - Stored payload shape retained by the record store.
 * @returns The tenant-predicated record store for the declared table/namespace.
 * @throws Rejects absent catalog, invalid storage binding or a legacy declaration without exactly one owned table; store validation failures propagate.
 * @remarks Does not install schemas or activate a feature; migration and live authorization remain host responsibilities.
 * @example
 * import { createPluginRecordStore } from '@alneas/eaos-server/plugin-data'
 * export function pluginRecords(manifest: Parameters<typeof createPluginRecordStore>[0], driver: Parameters<typeof createPluginRecordStore>[1], catalog: Parameters<typeof createPluginRecordStore>[2]) { return createPluginRecordStore(manifest, driver, catalog) }
 */
export function createPluginRecordStore<T>(manifest: Pick<PluginManifest, 'schema'>, driver: RecordSqlDriver, catalog?: DataContractCatalog): PluginRecordStore<T> {
 const storage = manifest.schema.storage
 if (storage) { if (!catalog) throw Error('Contract-backed record storage requires a trusted schema catalog'); const documents = recordDocuments(catalog, storage); return createSqlRecordStore<T>(storage.table, driver, { namespace: storage.namespace, storagePolicy: manifest.schema.storagePolicy, ...(documents?.length ? { documents } : {}) }) }
 if (manifest.schema.ownedTables.length !== 1) throw new Error('Plugin manifest must declare one storage table or shared storage metadata')
 return createSqlRecordStore<T>(manifest.schema.ownedTables[0]!, driver, { storagePolicy: manifest.schema.storagePolicy })
}

export * from './annotations'

export { ArtifactDeliveryService, deliveryOperations, enqueueDeliverySchema, deliveryJobSchema, recoverDeliverySchema, type DeliveryPorts, type DeliveryJob, type DeliveryRequest, type DeliveryArtifact } from './delivery'
