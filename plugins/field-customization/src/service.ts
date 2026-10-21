import { getPlatformNamespaceDocumentContracts as getNamespaceDocumentContracts } from '@alneas/eaos-core/contracts/platform-records'
import { createValidatedRecordHost } from '@alneas/eaos-server/plugin-data'
import { assertPrincipal, PluginError, exactKeys, textInput, type PluginPrincipal, type PluginRecordStore } from '@alneas/eaos-server/plugin-data'
import { applyFieldCustomizations, type FieldCustomization, type ObjectSchema } from './schema'
/**
 * Complete persisted override map for one host resource.
 *
 * @see FieldCustomizationService for a complete host integration example.
 */
export interface FieldDefinition {
/**
 * Complete resource override map; service writes replace this map rather than merging omitted keys.
 */
  fields: Record<string, FieldCustomization> }
/**
 * Tenant-isolated field storage with live resource authorization and base schema resolution.
 *
 * @see FieldCustomizationService for a complete host integration example.
 */
export interface FieldCustomizationOptions {
 /**
 * Tenant/resource-isolated durable definition storage with atomic compare-and-swap replace.
 */
  store: PluginRecordStore<FieldDefinition>
 /**
 * Live lifecycle, membership and resource permission check for read/write; false denies access.
 * @param principal - Verified tenant principal for this operation.
 * @param action - Requested plugin action to authorize against current state.
 * @param resource - Host-catalog resource identifier.
 * @returns True only when current host policy allows access; false denies access.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @remarks
 * Must check live lifecycle, membership and resource permission.
 *
 * @example
 * ```typescript
 * import type { FieldCustomizationOptions } from '@alneas/eaos-plugins/field-customization/service';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export function canReadFields(options: FieldCustomizationOptions, principal: PluginPrincipal, resource: string) {
 *  return options.authorize(principal, 'read', resource);
 * }
 * ```
 */
 authorize(principal: PluginPrincipal, action: 'read' | 'write', resource: string): Promise<boolean>
 /**
 * Resolve the current canonical object schema for an authorized resource; null makes the resource unavailable.
 * @param principal - Verified tenant principal for this operation.
 * @param resource - Host-catalog resource identifier.
 * @returns The canonical object schema, or null when unavailable.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @example
 * ```typescript
 * import type { FieldCustomizationOptions } from '@alneas/eaos-plugins/field-customization/service';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export function resolveCurrentSchema(options: FieldCustomizationOptions, principal: PluginPrincipal, resource: string) {
 *  return options.resolveSchema(principal, resource); // May resolve null when the resource is unavailable.
 * }
 * ```
 */
resolveSchema(principal: PluginPrincipal, resource: string): Promise<ObjectSchema | null>
}
/**
 * Reads and revision-checks tenant/resource field overrides without weakening base schema validation.
 *
 * @remarks
 * Server-side host supplies current resource authorization, canonical object schema resolution and durable isolated storage. A write can persist before a final authorization check rejects; reload current state before retrying.
 *
 * @example
 * ```typescript
 * import { FieldCustomizationService, type FieldCustomizationOptions } from '@alneas/eaos-plugins/field-customization/service';
 * export function connectFields(options: FieldCustomizationOptions) { return new FieldCustomizationService(options); }
 * ```
 */
export class FieldCustomizationService {
 /**
 * Wraps the host store with canonical field-customization document validation.
 * @param options - Tenant-isolated storage, live resource authorization and canonical object schema resolver.
 */
constructor(private readonly options: FieldCustomizationOptions) { this.options = createValidatedRecordHost(options, getNamespaceDocumentContracts('platform-records', 'field_customization'));}
 private async schema(p: PluginPrincipal, resource: string, action: 'read' | 'write') {
  assertPrincipal(p); textInput(resource, 'resource')
  if (!await this.options.authorize(p, action, resource)) throw new PluginError(403, 'Field customization access denied')
  const schema = await this.options.resolveSchema(p, resource)
  if (!schema || schema.type !== 'object' || !schema.properties) throw new PluginError(404, 'Resource unavailable')
  return schema
 }
 /**
 * Reads a resource definition and merges its overrides into the current canonical schema.
 * @param p - Verified tenant principal.
 * @param resource - Nonblank host-catalog resource ID.
 * @returns Resource ID, revision, fields and projected schema; absent definitions use revision 0 and empty fields.
 * @throws Rejects invalid principal/resource, denied/revoked access (403), unavailable object schema (404), and propagated host failures.
 *
 * @example
 * ```typescript
 * import { FieldCustomizationService } from '@alneas/eaos-plugins/field-customization/service';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export function readFields(service: FieldCustomizationService, principal: PluginPrincipal, resource: string) { return service.read(principal, resource); }
 * ```
 */
async read(p: PluginPrincipal, resource: string) {
  const base = await this.schema(p, resource, 'read'), record = await this.options.store.read(p.tenantId, resource)
  if (!await this.options.authorize(p, 'read', resource)) throw new PluginError(403, 'Field customization access revoked')
  return { id: resource, revision: record?.revision ?? 0, fields: record?.value.fields ?? {}, schema: applyFieldCustomizations(base, record?.value.fields ?? {}) }
 }
 /**
 * Replaces the complete field override map using resource-scoped optimistic concurrency.
 * @param p - Verified current tenant principal.
 * @param resource - Host-catalog resource ID.
 * @param input - Exactly revision (nonnegative integer, 0 for new definition) and fields (at most 100 overrides).
 * @returns The new definition revision, copied fields and projected schema.
 * @throws Rejects malformed/weakening overrides (400), denied/revoked access (403), unavailable schema (404), stale revision/CAS conflict (409), and host failures.
 *
 * @remarks
 * Omitted fields are removed. Existing required base fields cannot be hidden or weakened; new names use custom_ prefix and a supported scalar type. Text is limited to 2000 characters, order magnitude to 10000 and string enum choices to 100. Final authorization occurs after persistence, so a rejection may follow a committed write.
 *
 * @example
 * ```typescript
 * import { FieldCustomizationService } from '@alneas/eaos-plugins/field-customization/service';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export async function renameTitle(service: FieldCustomizationService, principal: PluginPrincipal, resource: string) {
 *  const current = await service.read(principal, resource);
 *  return service.write(principal, resource, { revision: current.revision, fields: { ...current.fields, title: { ...current.fields.title, display_label: 'Report title' } } });
 * }
 * ```
 */
async write(p: PluginPrincipal, resource: string, input: Record<string, unknown>) {
  exactKeys(input, ['revision', 'fields'])
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0) throw new PluginError(400, 'Revision required')
  const base = await this.schema(p, resource, 'write'), expected = Number(input.revision), fields = input.fields
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length > 100) throw new PluginError(400, 'Invalid fields')
  for (const [key, value] of Object.entries(fields)) {
   if (!/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) || !value || typeof value !== 'object' || Array.isArray(value)) throw new PluginError(400, 'Invalid field')
   exactKeys(value, ['display_label', 'placeholder', 'help_text', 'is_required', 'is_hidden', 'display_order', 'type', 'enum'])
   const f = value as FieldCustomization, existing = Object.hasOwn(base.properties!, key) ? base.properties![key] : undefined
   for (const name of ['display_label', 'placeholder', 'help_text'] as const) if (f[name] !== undefined && (typeof f[name] !== 'string' || f[name]!.length > 2000)) throw new PluginError(400, 'Invalid field text')
   for (const name of ['is_required', 'is_hidden'] as const) if (f[name] !== undefined && typeof f[name] !== 'boolean') throw new PluginError(400, 'Invalid field flag')
   if (f.display_order !== undefined && (!Number.isSafeInteger(f.display_order) || Math.abs(f.display_order) > 10000)) throw new PluginError(400, 'Invalid display order')
   if (existing) {
    if (f.type !== undefined || f.enum !== undefined || (base.required?.includes(key) && (f.is_required === false || f.is_hidden === true))) throw new PluginError(400, 'Cannot weaken or hide required base validation')
   } else {
    if (!/^custom_[a-z][a-z0-9_]{0,55}$/.test(key) || !['string', 'number', 'boolean'].includes(f.type ?? '')) throw new PluginError(400, 'Custom field requires a supported type and custom_ prefix')
    if (f.enum !== undefined && (f.type !== 'string' || !Array.isArray(f.enum) || !f.enum.length || f.enum.length > 100 || f.enum.some(v => typeof v !== 'string' || v.length > 2000))) throw new PluginError(400, 'Invalid field choices')
   }
  }
  const current = await this.options.store.read(p.tenantId, resource)
  if (!await this.options.authorize(p, 'write', resource)) throw new PluginError(403, 'Field customization access revoked')
  if ((current?.revision ?? 0) !== expected) throw new PluginError(409, 'Field definition changed')
  const record = { id: resource, revision: expected + 1, value: { fields: structuredClone(fields) as Record<string, FieldCustomization> } }
  if (current) { if (!await this.options.store.replace(p.tenantId, record, expected)) throw new PluginError(409, 'Field definition changed') }
  else await this.options.store.create(p.tenantId, record)
  if (!await this.options.authorize(p, 'write', resource)) throw new PluginError(403, 'Field customization access revoked')
  return { id: resource, revision: record.revision, fields: record.value.fields, schema: applyFieldCustomizations(base, record.value.fields) }
 }
}
