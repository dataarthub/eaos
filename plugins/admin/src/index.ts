import { peerDependencies } from '../../package.json'
import {readAtomicAudit,verifyAtomicAudit,type AtomicRepository} from '@alneas/eaos-server/plugin-data'
import { manifest } from '../manifest'
import type { Context } from 'hono'
import type { PluginManifest } from '@alneas/eaos-core/plugin-sdk'
import type { LifecyclePlugin } from '@alneas/eaos-server/lifecycle-engine'
import { createPluginRouter, jsonBody, exactKeys, PluginError, type PluginPrincipal, type RecordSqlDriver } from '@alneas/eaos-server/plugin-data'
/**
 * Explicit trusted read-only table projection and optional existing command journal.
 *
 * @see createAdminRoutes for a complete host integration example.
 */
export interface AdminResource {
 /**
 * Optional existing host-owned AtomicRepository; no discovery or journal creation is performed.
 *
 * @remarks
 * Explicit host-owned existing command journal; no table discovery.
 */
 journal?:AtomicRepository
 /**
 * Optional canonical record namespace restricting key prefixes; lowercase identifier, maximum 63 characters.
 */
  recordNamespace?:string
 /**
 * Unique trusted resource identifier, maximum 63 SQL-safe identifier characters.
 */
  id: string;
/**
 * Public catalog caption.
 */
  label: string;
/**
 * Trusted SQL table identifier; no user-supplied table names.
 */
  table: string;
/**
 * SQL column constrained to the authenticated tenant on every query.
 */
  tenantColumn: string;
/**
 * Stable SQL key used for ordering and optional namespace prefix checks.
 */
  keyColumn: string
 /**
 * Nonempty allowlist of at most 100 unique case-insensitive column names, public captions and scalar types.
 *
 * @remarks
 * Only these columns can be selected or filtered. Do not expose credentials or internal control tables.
 */
 columns: {
/**
 * Allowlisted SQL column name; never expose credentials.
 */
  name: string;
/**
 * Public catalog caption.
 */
  label: string;
/**
 * Native text input type; defaults to text.
 */
  type: 'string' | 'number' | 'boolean' }[]
}
/**
 * Host capabilities for resource authorization, tenant-scoped SQL and durable audit.
 *
 * @see createAdminRoutes for a complete host integration example.
 */
export interface AdminOptions {
 /**
 * Explicit host resource catalog; cloned when routes are constructed.
 */
  resources: AdminResource[]
 /**
 * Live plugin activation, admin role and resource-permission check; must resolve true for access.
 * @param principal - Verified tenant principal for this operation.
 * @param resource - Host-catalog resource identifier.
 * @returns True only when current host policy allows access; false denies access.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @remarks
 * Must check current plugin activation, admin role AND resource permission.
 *
 * @example
 * ```typescript
 * import type { AdminOptions, AdminResource } from '@alneas/eaos-plugins/admin';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export function canInspect(options: AdminOptions, principal: PluginPrincipal, resource: AdminResource) {
 *  return options.authorize(principal, resource);
 * }
 * ```
 */
 authorize(principal: PluginPrincipal, resource: AdminResource): Promise<boolean>
 /**
 * Return a tenant-aware SQL driver; errors propagate to the request.
 * @param principal - Verified tenant principal for this operation.
 * @returns A tenant-aware SQL driver.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @example
 * ```typescript
 * import type { AdminOptions } from '@alneas/eaos-plugins/admin';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export function tenantDriver(options: AdminOptions, principal: PluginPrincipal) {
 *  return options.driver(principal); // Keep tenant predicates in all SQL executed through this driver.
 * }
 * ```
 */
driver(principal: PluginPrincipal): RecordSqlDriver
 /**
 * Persist a durable metadata-only audit receipt before returning data; failures deny the response, and record payloads must not be logged.
 * @param event - Message or error event delivered by the host worker.
 * @returns Resolves without a value after a durable receipt is written.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @remarks
 * Durable audit receipt required before returning data; no record payloads are logged.
 *
 * @example
 * ```typescript
 * import type { AdminOptions } from '@alneas/eaos-plugins/admin';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export async function recordInspection(options: AdminOptions, principal: PluginPrincipal, resourceId: string, count: number) {
 *  await options.audit({ principal, resourceId, operation: 'read', count });
 *  // Return protected results only after this durable acknowledgement and a fresh authorization check.
 * }
 * ```
 */
 audit(event: { 
    /**
     * Verified current tenant/user principal responsible for the admitted resource operation.
     */
    principal: PluginPrincipal; 
    /**
     * Explicit trusted admin resource catalog ID; never a request-selected SQL table name.
     */
    resourceId: string; 
    /**
     * Reported metadata-list, schema-inspection or data-read phase; audit is durably acknowledged before data is returned.
     */
    operation: 'list' | 'schema' | 'read'; 
    /**
     * Optional returned or verified row/event count; omitted for catalog and schema inspection.
     */
    count?: number }): Promise<void>
}
/**
 * Declares lifecycle compatibility and schema dependencies for host orchestration.
 *
 * @remarks
 * The host lifecycle engine owns installation and tenant admission; importing this value performs no migrations.
  * @example
 * import { lifecycle } from '@alneas/eaos-plugins/admin'
 * console.log(lifecycle.id, lifecycle.version)
 */
export const lifecycle: LifecyclePlugin = { id: manifest.id, version: manifest.version, framework: peerDependencies['@alneas/eaos-server'], migrations: [] }
const identifier = /^[A-Za-z][A-Za-z0-9_]{0,62}$/
/**
 * Creates a read-only admin router over an explicit resource catalog with repeated authorization and durable audit.
 * @param options - Live host persistence and authorization configuration; see AdminOptions.
 * @param resolvePrincipal - Resolves current authenticated principal per Hono request, or null to deny access.
 * @returns A Hono router ready to mount under the plugin API prefix.
 * @throws Construction rejects invalid host/schema bindings or malformed/duplicate resource catalog identifiers.
 *
 * @remarks
 * The host owns authentication, current tenant membership and plugin activation. Service errors become HTTP failures through the plugin router; adapter failures may propagate. Mutations can commit before a response failure; reload current state before retrying.
 *
 * @example
 * ```typescript
 * import { createAdminRoutes, type AdminOptions } from '@alneas/eaos-plugins/admin';
 * export function connectRoutes(options: AdminOptions, resolvePrincipal: Parameters<typeof createAdminRoutes>[1]) {
 *  return createAdminRoutes(options, resolvePrincipal);
 * }
 * ```
 */
export function createAdminRoutes(options: AdminOptions, resolvePrincipal: (c: Context) => Promise<PluginPrincipal | null>) {
 const resources = new Map<string, AdminResource>()
 for (const source of options.resources) {
  const {journal,...data}=source,resource:AdminResource={...structuredClone(data),...(journal?{journal}:{})}
  if (resource.recordNamespace!==undefined&&!/^[a-z][a-z0-9_]{0,62}$/.test(resource.recordNamespace))throw new Error('Invalid trusted record namespace')
  if (!identifier.test(resource.id) || resources.has(resource.id) || !resource.columns.length || resource.columns.length > 100 || ![resource.table, resource.tenantColumn, resource.keyColumn, ...resource.columns.map(c => c.name)].every(v => identifier.test(v)) || new Set(resource.columns.map(c => c.name.toUpperCase())).size !== resource.columns.length) throw new Error('Invalid admin resource catalog')
  resources.set(resource.id, resource)
 }
 const app = createPluginRouter(resolvePrincipal)
 const metadata = (resource: AdminResource) => ({ id: resource.id, label: resource.label, columns: resource.columns })
 const allowed = async (p: PluginPrincipal, resource: AdminResource) => {
  // A role from trusted identity is necessary, but never substitutes for live host authorization.
  if (!p.roles.some(role => ['admin','tenant_admin','super_admin'].includes(role.toLowerCase())) || !await options.authorize(p, resource)) throw new PluginError(403, 'Admin resource access denied')
 }
 const resolveResource = (id: string) => { const r = resources.get(id); if (!r) throw new PluginError(404, 'Resource not exposed'); return r }
 app.get('/resources', async c => {
  const principal = c.get('principal'), result = []
  for (const resource of resources.values()) {
   try { await allowed(principal, resource) } catch (e) { if (e instanceof PluginError && e.status === 403) continue; throw e }
   await options.audit({ principal, resourceId: resource.id, operation: 'list' }); await allowed(principal,resource); result.push(metadata(resource))
  }
  return c.json(result)
 })
 app.get('/resources/:id/schema', async c => {
  const principal = c.get('principal'), resource = resolveResource(c.req.param('id')); await allowed(principal, resource)
  await options.audit({ principal, resourceId: resource.id, operation: 'schema' }); await allowed(principal,resource); return c.json(metadata(resource))
 })
 app.post('/resources/:id/query', async c => {
  const principal = c.get('principal'), resource = resolveResource(c.req.param('id')); await allowed(principal, resource)
  const body = await jsonBody(c); exactKeys(body, ['limit', 'offset', 'filter', 'columns'])
  const limit = body.limit ?? 50, offset = body.offset ?? 0
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new PluginError(400, 'Invalid pagination')
  const permitted = resource.columns.map(c => c.name), columns = body.columns ?? permitted
  if (!Array.isArray(columns) || !columns.length || columns.length > permitted.length || columns.some(c => typeof c !== 'string' || !permitted.includes(c)) || new Set(columns).size !== columns.length) throw new PluginError(400, 'Column is not exposed')
  const filter = body.filter ?? {}
  if (!filter || typeof filter !== 'object' || Array.isArray(filter) || Object.keys(filter).length > 20) throw new PluginError(400, 'Invalid filter')
  const driver = options.driver(principal), bind = (i: number) => driver.dialect === 'postgres' ? `$${i}` : driver.dialect === 'oracle' ? `:${i}` : '?', quote = (v: string) => `"${v}"`
  const values: unknown[] = [principal.tenantId], predicates = [`${quote(resource.tenantColumn)} = ${bind(1)}`]
  if(resource.recordNamespace){values.push(resource.recordNamespace+':');predicates.push(`SUBSTR(${quote(resource.keyColumn)},1,${resource.recordNamespace.length+1}) = ${bind(values.length)}`)}
  for (const [key, value] of Object.entries(filter)) {
   if (!permitted.includes(key) || key.toUpperCase() === resource.tenantColumn.toUpperCase() || (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) || typeof value === 'number' && !Number.isFinite(value)) throw new PluginError(400, 'Filter is not allowed')
   if (value === null) predicates.push(`${quote(key)} IS NULL`)
   else { values.push(value); predicates.push(`${quote(key)} = ${bind(values.length)}`) }
  }
  const tail = driver.dialect === 'oracle' ? `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY` : `LIMIT ${limit} OFFSET ${offset}`
  const result = await driver.execute(principal.tenantId, `SELECT ${columns.map(quote).join(', ')} FROM ${quote(resource.table)} WHERE ${predicates.join(' AND ')} ORDER BY ${quote(resource.keyColumn)} ${tail}`, values)
  // Enforce the response projection even when a provider returns extra columns.
  const rows = (result.rows ?? []).slice(0, limit).map(row => Object.fromEntries(columns.map(name => [name, row[name] ?? row[name.toUpperCase()] ?? null])))
  await allowed(principal, resource)
  await options.audit({ principal, resourceId: resource.id, operation: 'read', count: rows.length });await allowed(principal,resource)
  return c.json({ rows, limit, offset })
 })
 app.post('/admin_journal_catalog',async c=>{const p=c.get('principal'),body=await jsonBody(c);exactKeys(body,[]);const result=[];for(const r of resources.values()){if(!r.journal)continue;try{await allowed(p,r)}catch(e){if(e instanceof PluginError&&e.status===403)continue;throw e}await options.audit({principal:p,resourceId:r.id,operation:'list'});await allowed(p,r);result.push({id:r.id,label:r.label})}return c.json({tenantId:p.tenantId,resources:result})})
 for(const operation of ['admin_journal_events','admin_journal_verify'])app.post('/'+operation,async c=>{const p=c.get('principal'),body=await jsonBody(c);exactKeys(body,operation.endsWith('events')?['resourceId','afterSequence','limit']:['resourceId']);if(typeof body.resourceId!=='string')throw new PluginError(400,'Named journal resource required');const r=resolveResource(body.resourceId);await allowed(p,r);if(!r.journal)throw new PluginError(409,'Existing journal not connected');const value=operation.endsWith('events')?await r.journal.run(p,tx=>readAtomicAudit(tx,p,body.afterSequence??0,body.limit??50)):await r.journal.run(p,tx=>verifyAtomicAudit(tx,p));await allowed(p,r);await options.audit({principal:p,resourceId:r.id,operation:'read',...('events' in value?{count:value.events.length}:{count:value.count})});await allowed(p,r);return c.json({tenantId:p.tenantId,resourceId:r.id,...value})})
 return app
}
/**
 * Binds static plugin metadata to the host-configured route factory.
 * @param options - Live host configuration; see AdminOptions.
 * @param resolvePrincipal - Current authenticated Hono principal resolver; null denies admission.
 * @returns A cloned PluginManifest with a createRoutes closure; no routes are instantiated until called.
 *
 * @remarks
 * Supplying a manifest does not activate a tenant or perform migrations. Host admission and live authorization remain mandatory.
 *
 * @example
 * ```typescript
 * import { createPlugin, type AdminOptions } from '@alneas/eaos-plugins/admin';
 * export function configure(options: AdminOptions, resolvePrincipal: Parameters<typeof createPlugin>[1]) { return createPlugin(options, resolvePrincipal); }
 * ```
 */
export function createPlugin(options: AdminOptions, resolvePrincipal: (c: Context) => Promise<PluginPrincipal | null>): PluginManifest {
 return { ...structuredClone(manifest), createRoutes: () => createAdminRoutes(options, resolvePrincipal) }
}
