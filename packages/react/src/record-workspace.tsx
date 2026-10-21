import { Button, Input } from '@alneas/appkit-react/tools/ui'
import * as React from 'react'
import {CoreWorkspaceHelp} from './user-guide'
import { DataTable } from '@alneas/appkit-react/tools/data-table'
import { EnhancedDetailPage } from '@alneas/appkit-react/tools/form'
import type { JSONSchema } from '@alneas/appkit-react/tools/schema'
import { createWorkspaceReactBindings, createWorkspaceSession, type WorkspaceClient, type WorkspaceSnapshot } from './index'

type Schema = { properties?: Readonly<Record<string, any>>; required?: readonly string[]; [key: string]: any }
/**
 * Plugin command form schema and selected-record/preview behavior.
 *
 * @see RecordWorkspace for a complete host integration example.
 */
export interface RecordWorkspaceCommand {
/**
 * Host command operation name.
 */
  operation: string;
/**
 * Button and form heading text.
 */
  label: string;
/**
 * Canonical command input schema used to derive the form.
 */
  schema: Schema;
/**
 * Require a selected record and include its ID/revision when true; defaults to false.
 */
  record?: boolean;
/**
 * Show command response as a preview instead of treating it as a normal mutation; defaults to false.
 */
  preview?: boolean;
/**
 * Optional plugin-owned form defaults for this command.
 */
  initialValues?: Record<string, unknown> }
/**
 * Authorized reference catalog declaration and ordered label projection.
 *
 * @see RecordWorkspace for a complete host integration example.
 */
export interface RecordWorkspaceReference {
 /**
 * Foreign-key field receiving the selected record ID.
 */
  field: string;
/**
 * Reference selector label.
 */
  title: string;
/**
 * Catalog owner and expected response recordId.
 */
  pluginId: string;
/**
 * Host operation used to read the authorized catalog.
 */
  listOperation: string;
/**
 * Response data property containing the candidate array.
 */
  listKey: string;
/**
 * Ordered string fields used to form labels; empty labels fall back to record ID.
 */
  displayFields: readonly string[]
 /**
 * Optional child catalogs resolving foreign-key display fields; nested loading requires referenceClient.
 *
 * @remarks
 * Related labels, resolved through separately authorized catalogs (for example a room's property).
 */
 references?: readonly RecordWorkspaceReference[]
}
/**
 * Tenant-scoped reference record paired with its authorized presentation label.
 *
 * @see RecordWorkspace for a complete host integration example.
 */
export interface RecordReferenceCandidate {
/**
 * Tenant-validated original candidate record.
 */
  record: ScopedUiRecord;
/**
 * Composed authorized catalog display text; does not replace command IDs.
 */
  label: string }
/**
 * Optional plugin help, reference transports and record/ready notifications.
 *
 * @see RecordWorkspace for a complete host integration example.
 */
export interface RecordWorkspaceProps {
 /**
 * Optional help content; undefined uses Core guide and null hides it.
 *
 * @remarks
 * Plugin-supplied guide; defaults to the generic Core guide. null deliberately hides it.
 */
 help?:React.ReactNode
 /**
 * Host resolver returning a separately authorized transport per reference catalog.
 *
 * @remarks
 * Authenticated host transport; the plugin declares the allowed reference catalogs.
 */
 referenceClient?: (reference: RecordWorkspaceReference) => WorkspaceClient<unknown>
 /**
 * Notifies the plugin when the selected record changes or clears.
 */
  onRecordChange?: (record: ScopedUiRecord | null) => void
 /**
 * Newer authorized result for the currently selected record; foreign or nonnewer results are not adopted.
 *
 * @remarks
 * Newer authorized response from a plugin-owned operation, for the already selected record only.
 */
 recordOverride?: ScopedUiRecord | null
 /**
 * Optional callback after the initial list load; may asynchronously load auxiliary plugin views.
 *
 * @remarks
 * Load plugin-owned auxiliary views after the shared initial list request has completed.
 */
 onReady?: (snapshot: WorkspaceSnapshot<unknown>) => void | Promise<void>
}
/**
 * Plugin-owned record operations, schemas, columns and workflow affordances.
 *
 * @see RecordWorkspace for a complete host integration example.
 */
export interface RecordWorkspaceDefinition {
 /**
 * Plugin workspace/resource identifier.
 */
  id: string;
/**
 * Workspace heading.
 */
  title: string;
/**
 * Snapshot payload property containing the record list.
 */
  listKey: string;
/**
 * Host list/get/create/update command names.
 */
  operations: {
/**
 * Host list operation used for initial loading and pagination.
 */
  list: string;
/**
 * Host single-record operation used for selection.
 */
  get: string;
/**
 * Host create operation used by the new-record form.
 */
  create: string;
/**
 * Host optimistic update operation used by the edit form.
 */
  update: string }
 /**
 * Canonical command schemas indexed by operation name.
 */
  schemas: Readonly<Record<string, Schema>>
 /**
 * Ordered table columns with headers and optional value(record) presentation callbacks.
 */
  columns: readonly {
/**
 * Record property key projected by this table column.
 */
  accessorKey: string;
/**
 * Public table column heading.
 */
  header: string;
/**
 * Optional presentation callback receiving a scoped record and returning the displayed cell value.
 */
  value?: (record: ScopedUiRecord) => unknown }[]
 /**
 * Optional plugin workflow/preview forms.
 */
  commands?: readonly RecordWorkspaceCommand[]
 /**
 * Fields excluded from generic edits because plugin commands own them.
 *
 * @remarks
 * Fields changed exclusively through the plugin's workflow commands.
 */
 workflowFields?: readonly string[]
 /**
 * Fields omitted from generic detail rendering.
 *
 * @remarks
 * Fields presented by a plugin-owned detail component instead of the generic description list.
 */
 hiddenDetailFields?: readonly string[]
 /**
 * Optional UI edit predicate; absence permits the edit affordance, while server permission is always required.
 *
 * @remarks
 * UI affordance only. The server must independently enforce edit permissions and state.
 */
 canEdit?: (record: ScopedUiRecord) => boolean
 /**
 * Optional authorized foreign-key catalogs used by forms and display labels.
 */
  references?: readonly RecordWorkspaceReference[]
}
const bindings = createWorkspaceReactBindings<unknown>({ responseScope: 'operation-resource' })
/**
 * Provides record workspace transports with independent latest-response channels per operation/resource.
 * @param props - WorkspaceProviderProps for the verified tenant/resource/session and stable host client.
 * @returns Children once the scoped session is ready; otherwise loading/unavailable status content.
 *
 * @remarks
 * See createWorkspaceReactBindings. Scope changes/unmount close the UI session; API authorization remains host-owned.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { RecordWorkspace, RecordWorkspaceProvider, type RecordWorkspaceDefinition } from '@alneas/eaos-react/record-workspace';
 * import type { WorkspaceClient } from '@alneas/eaos-react';
 * export function Records({tenantId, sessionKey, client, definition}: {tenantId: string; sessionKey: string; client: WorkspaceClient<unknown>; definition: RecordWorkspaceDefinition}) { return <RecordWorkspaceProvider tenantId={tenantId} recordId={definition.id} sessionKey={sessionKey} client={client}><RecordWorkspace definition={definition}/></RecordWorkspaceProvider>; }
 * ```
 */
export const RecordWorkspaceProvider = bindings.WorkspaceProvider
/**
 * Reads the scoped transport from the nearest RecordWorkspaceProvider.
 * @returns The session-guarded client, or null outside a ready provider.
 *
 * @remarks
 * React hook; see RecordWorkspace for provider setup.
 *
 * @example
 * ```typescript
 * import { useRecordWorkspaceClient } from '@alneas/eaos-react/record-workspace';
 * export function useRecordReload() { const client = useRecordWorkspaceClient(); return () => client?.load(); }
 * ```
 */
export const useRecordWorkspaceClient = bindings.useClient
/**
 * UI record with verified tenant, nonempty ID and positive optimistic revision.
 *
 * @see RecordWorkspace for a complete host integration example.
 */
export interface ScopedUiRecord {
/**
 * Verified tenant owning this record.
 */
  tenantId: string;
/**
 * Nonempty resource ID.
 */
  id: string;
/**
 * Positive safe integer used for optimistic concurrency.
 */
  revision: number;
/**
 * Additional plugin-owned record fields; do not derive authorization from them.
 */
 [key: string]: unknown }
/**
 * Checks that a UI record belongs to the expected tenant and has a usable ID and positive revision.
 * @param value - Untrusted record response.
 * @param tenantId - Verified tenant ID expected on the record.
 * @returns The original record object without cloning or validating domain fields.
 * @throws Error for missing/foreign tenant, empty ID or nonpositive/noninteger revision.
 *
 * @example
 * ```typescript
 * import { scopedUiRecord } from '@alneas/eaos-react/record-workspace';
 * const record = scopedUiRecord({ tenantId: 'sample', id: 'one', revision: 1 }, 'sample');
 * ```
 */
export function scopedUiRecord(value: unknown, tenantId: string): ScopedUiRecord {
 const record = value as ScopedUiRecord
 if (!record || record.tenantId !== tenantId || typeof record.id !== 'string' || !record.id || !Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error('取得したレコードの範囲を確認できません。')
 return record
}
/**
 * Complete authorized candidates, rather than silently limiting a relation search to the first page.
 */
async function readRecordReference(reference: RecordWorkspaceReference, tenantId: string, source: WorkspaceClient<unknown>, signal?: AbortSignal): Promise<ScopedUiRecord[]> {
 const session = createWorkspaceSession(tenantId, reference.pluginId, source)
 const close = () => session.close()
 signal?.addEventListener('abort', close, { once: true })
 try {
  if (signal?.aborted) throw new Error('Session expired')
  const records: ScopedUiRecord[] = [], ids = new Set<string>(), cursors = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < 100; page++) {
   const snapshot = await session.client.execute(reference.listOperation, { limit: 100, ...(cursor ? { cursor } : {}) })
   const data = snapshot.data as any, items = data?.[reference.listKey]
   if (!Array.isArray(items) || items.length > 100) throw new Error('関連候補の応答を確認できません。')
   for (const value of items) {
    const record = scopedUiRecord(value, tenantId)
    if (ids.has(record.id)) throw new Error('関連候補が重複しています。再読込してください。')
    ids.add(record.id); records.push(record)
   }
   if (data.nextCursor === undefined || data.nextCursor === null) {
    if (data.mayHaveMore) throw new Error('関連候補の続きが取得できません。')
    return records
   }
   if (typeof data.nextCursor !== 'string' || !data.nextCursor || cursors.has(data.nextCursor)) throw new Error('関連候補のページを確認できません。')
   cursors.add(data.nextCursor); cursor = data.nextCursor
  }
  throw new Error('関連候補が取得上限を超えています。ホスト側の検索接続が必要です。')
 } finally { signal?.removeEventListener('abort', close); session.close() }
}
/**
 * Loads complete tenant-scoped reference candidates and recursively resolves labels from authorized catalogs.
 * @param reference - Catalog operation, list key and display fields.
 * @param tenantId - Verified tenant ID for all returned records.
 * @param source - Authorized catalog transport; recordId must equal reference.pluginId.
 * @param signal - Optional cancellation signal invalidating the session.
 * @param referenceClient - Required for nested catalogs; returns independently authorized transports.
 * @returns Candidate records and composed display labels, including all pages or an empty array.
 * @throws Rejects foreign/malformed responses, missing nested adapters, pagination/depth limits, cancellation or propagated transport failures.
 *
 * @remarks
 * At most 100 pages of 100 records per catalog and four nested reference levels are accepted. Sessions close after loading; pending transport requests are not cancelled. Duplicate IDs/cursors and uncertain truncation fail instead of returning incomplete choices.
 *
 * @example
 * ```typescript
 * import { loadRecordReference, type RecordWorkspaceReference } from '@alneas/eaos-react/record-workspace';
 * import type { WorkspaceClient } from '@alneas/eaos-react';
 * export function loadChoices(tenantId: string, source: WorkspaceClient<unknown>) {
 *  const reference: RecordWorkspaceReference = { field: 'reportId', title: 'Report', pluginId: 'reports', listOperation: 'list', listKey: 'reports', displayFields: ['title'] };
 *  return loadRecordReference(reference, tenantId, source);
 * }
 * ```
 */
export async function loadRecordReference(reference: RecordWorkspaceReference, tenantId: string, source: WorkspaceClient<unknown>, signal?: AbortSignal, referenceClient?: RecordWorkspaceProps['referenceClient']): Promise<RecordReferenceCandidate[]> {
 const visit = async (definition: RecordWorkspaceReference, client: WorkspaceClient<unknown>, depth: number): Promise<RecordReferenceCandidate[]> => {
  if (depth > 4) throw new Error('関連候補の参照が深すぎます。')
  const records = await readRecordReference(definition, tenantId, client, signal)
  const related = Object.fromEntries(await Promise.all((definition.references ?? []).map(async child => {
   if (!referenceClient) throw new Error('関連名称の接続が必要です。')
   const candidates = await visit(child, referenceClient(child), depth + 1)
   return [child.field, new Map(candidates.map(candidate => [candidate.record.id, candidate.label]))] as const
  })))
  if (signal?.aborted) throw new Error('Session expired')
  return records.map(record => ({ record, label: recordReferenceLabel(definition, record, related) }))
 }
 return visit(reference, source, 0)
}
/**
 * Composes a reference label from nonblank string display fields and optional authorized related labels.
 * @param reference - Ordered displayFields used to label the record.
 * @param record - Tenant-scoped candidate; scope must already be checked.
 * @param related - Optional field-to-ID/label maps; defaults to no substitutions.
 * @returns Trimmed string parts joined by /, or record.id when no usable strings exist.
 *
 * @example
 * ```typescript
 * import { recordReferenceLabel } from '@alneas/eaos-react/record-workspace';
 * const label = recordReferenceLabel({ field: 'reportId', title: 'Report', pluginId: 'reports', listOperation: 'list', listKey: 'reports', displayFields: ['title'] }, { tenantId: 'sample', id: 'one', revision: 1, title: 'Annual report' });
 * ```
 */
export function recordReferenceLabel(reference: RecordWorkspaceReference, record: ScopedUiRecord, related: Readonly<Record<string, ReadonlyMap<string, string>>> = {}): string {
 const parts = reference.displayFields.map(key => typeof record[key] === 'string' ? related[key]?.get(record[key]) ?? record[key] : record[key]).filter(value => typeof value === 'string' && value.trim()).map(value => String(value).trim())
 return parts.join(' / ') || record.id
}
/**
 * Projects a command schema into form fields without mutating the original schema.
 * @param schema - Canonical command schema.
 * @param excluded - Field keys removed from properties and required; defaults to none.
 * @returns A shallow schema copy with retained properties and corresponding required entries.
 *
 * @example
 * ```typescript
 * import { recordFormSchema } from '@alneas/eaos-react/record-workspace';
 * const form = recordFormSchema({ type: 'object', properties: { title: { type: 'string' }, revision: { type: 'integer' } }, required: ['title', 'revision'] }, ['revision']);
 * ```
 *
 * @remarks
 * Derive a presentation schema without changing the server's command contract.
 */
export function recordFormSchema(schema: Schema, excluded: readonly string[] = []): JSONSchema {
 const properties = Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([key]) => !excluded.includes(key)))
 return { ...schema, properties, required: (schema.required ?? []).filter(key => key in properties) } as JSONSchema
}
/**
 * Selects schema-declared form values and omits optional blanks incompatible with their field constraints.
 * @param schema - Form schema whose properties define accepted keys.
 * @param values - Typed form values; values are not coerced.
 * @returns A new object excluding undeclared/undefined values and invalid optional empty numeric, enum, patterned or minLength fields.
 * @throws Invalid regular-expression patterns in schema properties may throw.
 *
 * @remarks
 * Does not perform full JSON Schema validation. Required blank values remain for server validation.
 *
 * @example
 * ```typescript
 * import { recordFormValues } from '@alneas/eaos-react/record-workspace';
 * const values = recordFormValues({ properties: { title: { type: 'string' }, amount: { type: 'number' } } }, { title: 'Report', amount: '', unknown: true });
 * ```
 */
export function recordFormValues(schema: Schema, values: Record<string, unknown>): Record<string, unknown> {
 const required = new Set(schema.required ?? [])
 return Object.fromEntries(Object.keys(schema.properties ?? {}).flatMap(key => {
  const value = values[key]
  const field = schema.properties?.[key]
  const types = Array.isArray(field?.type) ? field.type : [field?.type]
  if (value === undefined || (!required.has(key) && value === '' && ((field?.minLength ?? 0) > 0 || field?.enum || (typeof field?.pattern === 'string' && !new RegExp(field.pattern).test('')) || types.includes('number') || types.includes('integer')))) return []
  return [[key, value]]
 }))
}

/**
 * Renders a scoped record list/detail editor and plugin-owned commands using declared schemas.
 *
 * A host-bound record editor. Domain schemas, commands and labels belong to each plugin.
 * @param props - RecordWorkspaceProps plus the required RecordWorkspaceDefinition; host supplies admitted references, callbacks and optional help.
 * @returns The record workspace UI or a connection-required paragraph while no scoped client is available.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization. Mount under RecordWorkspaceProvider. References are loaded through separately authorized catalogs. Client changes/unmount suppress obsolete replies. Failed writes clear selection because outcomes may be uncertain; UI edit predicates do not enforce server permissions.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { RecordWorkspace, RecordWorkspaceProvider, type RecordWorkspaceDefinition } from '@alneas/eaos-react/record-workspace';
 * import type { WorkspaceClient } from '@alneas/eaos-react';
 * export function Records({tenantId, sessionKey, client, definition}: {tenantId: string; sessionKey: string; client: WorkspaceClient<unknown>; definition: RecordWorkspaceDefinition}) { return <RecordWorkspaceProvider tenantId={tenantId} recordId={definition.id} sessionKey={sessionKey} client={client}><RecordWorkspace definition={definition}/></RecordWorkspaceProvider>; }
 * ```
 */
export function RecordWorkspace({ definition, referenceClient, onRecordChange, onReady, recordOverride, help }: RecordWorkspaceProps & {
/**
 * Plugin-owned workspace schema, labels and operation declarations.
 */
  definition: RecordWorkspaceDefinition }) {
 const client = bindings.useClient()
 const [snapshot, setSnapshot] = React.useState<WorkspaceSnapshot<unknown> | null>(null)
 const [selected, setSelected] = React.useState<ScopedUiRecord | null>(null)
 const [form, setForm] = React.useState<'create' | 'edit' | RecordWorkspaceCommand | null>(null)
 const [filter, setFilter] = React.useState<Record<string, unknown>>({ limit: 100 })
 const [query, setQuery] = React.useState('')
 const [busy, setBusy] = React.useState(false)
 const [error, setError] = React.useState<string | null>(null)
 const [notice, setNotice] = React.useState<string | null>(null)
 const [preview, setPreview] = React.useState<unknown>(null)
 const [references, setReferences] = React.useState<Record<string, RecordReferenceCandidate[]>>({})
 const [referenceError, setReferenceError] = React.useState<string | null>(null)
 const [referenceBusy, setReferenceBusy] = React.useState(false)
 const referenceController = React.useRef<AbortController | null>(null)
 const retry = React.useRef<{ key: string; commandId: string } | null>(null)
 const pending = React.useRef(false), generation = React.useRef(0)
 React.useEffect(() => { onRecordChange?.(selected) }, [selected, onRecordChange])
 React.useEffect(() => {
  if (!recordOverride || !selected || !snapshot || recordOverride === selected || recordOverride.id !== selected.id || recordOverride.tenantId !== snapshot.tenantId || recordOverride.tenantId !== selected.tenantId || !Number.isSafeInteger(recordOverride.revision) || recordOverride.revision <= selected.revision) return
  setSelected(recordOverride); setForm(null); setPreview(null); retry.current = null
  setSnapshot(old => {
   const data = old?.data as Record<string, unknown> | undefined, records = data?.[definition.listKey]
   return old && Array.isArray(records) ? { ...old, data: { ...data, [definition.listKey]: records.map(record => (record as ScopedUiRecord).id === recordOverride.id ? recordOverride : record) } } : old
  })
 }, [recordOverride, selected, snapshot, definition.listKey])
 const reloadReferences = async (tenantId: string) => {
  referenceController.current?.abort()
  const controller = new AbortController(); referenceController.current = controller
  setReferences({}); setReferenceError(null)
  if (!referenceClient || !definition.references?.length) { setReferenceBusy(false); return }
  setReferenceBusy(true)
  try {
   const entries = await Promise.all(definition.references.map(async reference => [reference.field, await loadRecordReference(reference, tenantId, referenceClient(reference), controller.signal, referenceClient)] as const))
   if (!controller.signal.aborted) setReferences(Object.fromEntries(entries))
  } catch (cause) { if (!controller.signal.aborted) setReferenceError(cause instanceof Error ? cause.message : String(cause)) }
  finally { if (!controller.signal.aborted) setReferenceBusy(false) }
 }
 React.useEffect(() => {
  const current = ++generation.current
  referenceController.current?.abort(); setReferences({}); setReferenceError(null); setReferenceBusy(false)
  retry.current = null; setFilter({ limit: 100 }); setQuery(''); setSnapshot(null); setSelected(null); setForm(null); setPreview(null); setError(null); setNotice(null)
  if (!client) return
  setBusy(true)
  void client.load().then(async result => { if (current === generation.current) { setSnapshot(result); await reloadReferences(result.tenantId); if (current === generation.current) await onReady?.(result) } }).catch(cause => { if (current === generation.current) setError(String(cause.message ?? cause)) }).finally(() => { if (current === generation.current) setBusy(false) })
  return () => { generation.current++; referenceController.current?.abort() }
 }, [client, definition.id, referenceClient])
 const run = async (work: () => Promise<void>) => {
  if (pending.current) return
  const current = generation.current
  pending.current = true; setBusy(true); setError(null); setNotice(null)
  try { await work() } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : String(cause)) }
  finally { pending.current = false; if (current === generation.current) setBusy(false) }
 }
 if (!client) return <p>認可済みの接続が必要です。</p>
 let records: ScopedUiRecord[] = [], invalid: string | null = null
 try {
  if (snapshot) {
   if (snapshot.recordId !== definition.id) throw new Error('画面の接続先が一致しません。')
   const items = (snapshot.data as any)?.[definition.listKey]
   if (!Array.isArray(items)) throw new Error('一覧を取得できませんでした。')
   records = items.map(item => scopedUiRecord(item, snapshot.tenantId))
  }
 } catch (cause) { invalid = (cause as Error).message }
 const refresh = async (nextFilter = filter) => { const result = await client.execute(definition.operations.list, nextFilter); setSnapshot(result); setSelected(null); setForm(null); setPreview(null) }
 const open = (id: string) => void run(async () => {
  const result = await client.execute(definition.operations.get, { id })
  const record = scopedUiRecord(result.data, result.tenantId)
  if (record.id !== id) throw new Error('取得したレコードが一致しません。')
  setSelected(record); setForm(null); setPreview(null)
 })
 let schema: JSONSchema | null = null, initial: Record<string, unknown> = {}
 if (form === 'create') schema = recordFormSchema(definition.schemas[definition.operations.create], ['commandId'])
 else if (form === 'edit') { schema = recordFormSchema(definition.schemas[definition.operations.update].properties!.patch, definition.workflowFields); initial = selected ?? {} }
 else if (form) { schema = recordFormSchema(form.schema, ['id', 'revision', 'commandId']); initial = form.initialValues ?? {} }
 const submit = (values: Record<string, unknown>) => void run(async () => {
  if (!schema || !form) return
  const input = recordFormValues(schema, values)
  const op = form === 'create' ? definition.operations.create : form === 'edit' ? definition.operations.update : form.operation
  const bound = form === 'edit' || (typeof form === 'object' && form.record)
  if (bound && !selected) throw new Error('対象レコードを選択してください。')
  const args = form === 'edit' ? { id: selected!.id, revision: selected!.revision, patch: input } : { ...input, ...(bound ? { id: selected!.id, revision: selected!.revision } : {}) }
  if (definition.schemas[op]?.properties?.commandId) { const key = JSON.stringify([op, args]); if (retry.current?.key !== key) retry.current = { key, commandId: crypto.randomUUID() }; Object.assign(args, { commandId: retry.current!.commandId }) }
  const result = await client.execute(op, args)
  retry.current = null
  if (typeof form === 'object' && form.preview) { setPreview(result.data); return }
  const saved = scopedUiRecord(result.data, result.tenantId)
  if (bound && saved.id !== selected!.id) throw new Error('保存結果の対象が一致しません。')
  setForm(null); setNotice('保存しました。')
  try { setSnapshot(await client.execute(definition.operations.list, filter)) }
  catch { setError('保存は完了しました。一覧を再取得できませんでした。再読込してください。') }
  setSelected(saved)
 })
 const serverSearch = !!definition.schemas[definition.operations.list]?.properties?.search
 const relations = Object.fromEntries((definition.references ?? []).filter(reference => references[reference.field]).map(reference => [reference.field, { displayField: 'displayName', valueField: 'id', data: references[reference.field].map(candidate => ({ id: candidate.record.id, displayName: candidate.label })), inputDisplay: 'both' as const, validateKey: true, searchFields: ['displayName', 'id'], searchTitle: reference.title }]))
 const displayValue = (field: string, value: unknown) => { const candidate = references[field]?.find(item => item.record.id === value); return candidate ? candidate.label : typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—') }
 const visible = records.filter(record => serverSearch || !query || definition.columns.some(column => String(record[column.accessorKey] ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase())))
 return <section aria-label={definition.title} style={{ padding: 24 }}>
  <h1 className="text-2xl font-semibold mb-4">{definition.title}</h1>
  {help===undefined?<CoreWorkspaceHelp/>:help}
  {error && <p role="alert">{error}</p>}{invalid && <p role="alert">{invalid}</p>}{notice && <p role="status">{notice}</p>}
  {referenceError && <p role="alert">関連候補を取得できませんでした。{referenceError} 再読込してください。</p>}
  <fieldset disabled={busy || !!invalid} style={{ border: 0, padding: 0 }}>
   <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
    <Button variant="outline" type="button" onClick={() => { setSelected(null); setForm('create'); setPreview(null) }}>新規登録</Button>
    <Button variant="outline" type="button" onClick={() => void run(async () => { await refresh(); if (snapshot) await reloadReferences(snapshot.tenantId) })}>再読込</Button>
    <label>{serverSearch ? '全件から検索' : '表示中の一覧を検索'} <Input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {serverSearch && <Button variant="outline" type="button" onClick={() => void run(async () => { const next = { ...filter, search: query }; await refresh(next); setFilter(next) })}>検索</Button>}
   </div>
   <details><summary>絞り込み</summary><EnhancedDetailPage relations={relations} schema={recordFormSchema(definition.schemas[definition.operations.list], ['cursor'])} mode="edit" values={filter} submitLabel="update" containerLayout={false} onSubmit={values => void run(async () => { const next = recordFormValues(recordFormSchema(definition.schemas[definition.operations.list], ['cursor']), values); await refresh(next); setFilter(next) })} /></details>
   <DataTable data={visible} columns={definition.columns.map(column => ({ ...column, ...(column.value ? { accessorFn: column.value } : {}), cell: ({ row }: any) => displayValue(column.accessorKey, column.value ? column.value(row.original) : row.original[column.accessorKey]) }))} rowIdField="id" onRowClick={id => open(String(id))} />
   {typeof (snapshot?.data as any)?.nextCursor === 'string' && <Button variant="outline" type="button" onClick={() => void run(() => refresh({ ...filter, cursor: (snapshot!.data as any).nextCursor }))}>次のページ</Button>}
   <p>{visible.length}件を表示{(snapshot?.data as any)?.mayHaveMore ? typeof (snapshot?.data as any)?.nextCursor === 'string' ? '。続きは次のページで確認できます。' : '。取得上限に達しています。絞り込みは取得範囲に適用されます。' : ''}</p>
   {selected && <section aria-label="詳細"><h2 className="text-xl font-semibold my-4">詳細</h2><dl className="grid grid-cols-2 gap-x-6 gap-y-2 my-4">{Object.entries(selected).filter(([key]) => !['tenantId', 'revision', 'workflow', ...(definition.hiddenDetailFields ?? [])].includes(key)).map(([key, value]) => <React.Fragment key={key}><dt>{definition.columns.find(column => column.accessorKey === key)?.header ?? definition.schemas[definition.operations.create].properties?.[key]?.title ?? key}</dt><dd>{displayValue(key, value)}</dd></React.Fragment>)}</dl>{(!definition.canEdit || definition.canEdit(selected)) && <Button variant="outline" type="button" onClick={() => setForm('edit')}>編集</Button>}</section>}
   <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{definition.commands?.filter(command => !command.record || selected).map(command => <Button variant="outline" type="button" key={command.operation} onClick={() => { setForm(command); setPreview(null) }}>{command.label}</Button>)}</div>
   {form && schema && <section aria-label="操作フォーム"><h2>{form === 'create' ? '新規登録' : form === 'edit' ? '編集' : form.label}</h2><fieldset disabled={referenceBusy || (!!referenceClient && !!referenceError && (definition.references ?? []).some(reference => schema!.properties?.[reference.field]))} style={{ border: 0, padding: 0 }}><EnhancedDetailPage relations={relations} key={`${typeof form === 'string' ? form : form.operation}:${selected?.id ?? ''}:${selected?.revision ?? ''}:${typeof form === 'object' ? JSON.stringify(form.initialValues ?? {}) : ''}`} schema={schema} values={initial} mode="edit" submitLabel={form === 'create' ? 'create' : 'update'} containerLayout={false} onSubmit={submit} onCancel={() => setForm(null)} /></fieldset></section>}
   {preview !== null && <section aria-label="試算結果"><h2>試算結果</h2><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(preview, null, 2)}</pre></section>}
  </fieldset>{busy && <p role="status">処理中…</p>}
 </section>
}

/**
 * Adds missing plugin field titles recursively through properties and items without replacing explicit titles.
 * @param schema - JSON-schema-like object to copy.
 * @param labels - Field-key to display-title map; absent labels fall back to the field key.
 * @returns A recursively copied properties/items tree preserving other schema metadata.
 *
 * @example
 * ```typescript
 * import { titleRecordSchema } from '@alneas/eaos-react/record-workspace';
 * const schema = titleRecordSchema({ type: 'object', properties: { title: { type: 'string' } } }, { title: 'Report title' });
 * ```
 *
 * @remarks
 * Add plugin-owned labels without mutating the command's canonical schema.
 */
export function titleRecordSchema(schema:any,labels:Readonly<Record<string,string>>):any {
 return {...schema,...(schema.properties?{properties:Object.fromEntries(Object.entries(schema.properties).map(([key,value])=>[key,{...titleRecordSchema(value,labels),title:(value as any).title??labels[key]??key}]))}:{}),...(schema.items?{items:titleRecordSchema(schema.items,labels)}:{})}
}
