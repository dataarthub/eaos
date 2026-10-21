import * as React from 'react'
import { Button, Input } from '@alneas/appkit-react/tools/ui'
import { createWorkspaceReactBindings, type WorkspaceSnapshot } from '@alneas/eaos-react'
import type { FieldDefinition } from './service'
import type { ObjectSchema } from './schema'
import UserHelp from './user-help'
/**
 * Resource definition, revision and merged canonical schema returned to the workspace.
 *
 * @see FieldCustomizationService for a complete host integration example.
 */
export interface FieldWorkspaceData extends FieldDefinition {
/**
 * Authorized resource identifier.
 */
  id: string;
/**
 * Persisted field-definition revision; 0 when no definition exists.
 */
  revision: number;
/**
 * Canonical base schema projected with stored field overrides.
 */
  schema: ObjectSchema }
const bindings = createWorkspaceReactBindings<FieldWorkspaceData>()
/**
 * Provides an isolated authenticated session for the plugin workspace.
 * @param props - WorkspaceProviderProps containing verified tenant/resource/session IDs, stable client and children.
 * @returns Children after the session is ready, otherwise loading/unavailable status content.
 *
 * @remarks
 * Closes old UI sessions on scope change/unmount. The host owns transport authentication and authorization; see FieldCustomizationPage for setup.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { FieldCustomizationPage, FieldCustomizationProvider } from '@alneas/eaos-plugins/field-customization/workspace';
 * export function Page(props: Omit<React.ComponentProps<typeof FieldCustomizationProvider>, 'children'>) { return <FieldCustomizationProvider {...props}><FieldCustomizationPage/></FieldCustomizationProvider>; }
 * ```
 */
export const FieldCustomizationProvider = bindings.WorkspaceProvider
/**
 * Renders per-resource field overrides with revision-aware save and refresh controls.
 *
 * Mount one provider per authorized resource; resource selection belongs to the host catalog.
 * @returns The workspace page with loading/error state, or an alert when the host provider is missing.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization. Mount inside FieldCustomizationProvider with a stable live-authenticated client. The host supplies load/write workspace operations for one authorized resource. Unmount/client changes ignore stale reads; save failures clear displayed state because the outcome may be uncertain.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { FieldCustomizationPage, FieldCustomizationProvider } from '@alneas/eaos-plugins/field-customization/workspace';
 * export function Page(props: Omit<React.ComponentProps<typeof FieldCustomizationProvider>, 'children'>) { return <FieldCustomizationProvider {...props}><FieldCustomizationPage/></FieldCustomizationProvider>; }
 * ```
 */
export function FieldCustomizationPage() {
 const client = bindings.useClient(), identity = React.useRef(client); identity.current = client
 const [snapshot,setSnapshot] = React.useState<WorkspaceSnapshot<FieldWorkspaceData> | null>(null)
 const [field,setField] = React.useState('')
 const [busy,setBusy] = React.useState(false), [error,setError] = React.useState<string | null>(null), [version,reload] = React.useReducer(n => n + 1,0)
 React.useEffect(() => { let active = true; setSnapshot(null); setError(null); setBusy(true); if (!client) { setBusy(false); return }; void client.load().then(value => { if (active) setSnapshot(value) }).catch(() => { if (active) setError('取得できません。対象と権限を確認してください。') }).finally(() => { if (active) setBusy(false) }); return () => { active = false } },[client,version])
 React.useEffect(() => { if (snapshot && !Object.hasOwn(snapshot.data.schema.properties ?? {}, field)) setField(Object.keys(snapshot.data.schema.properties ?? {})[0] ?? '') }, [snapshot,field])
 async function save(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault(); if (!client || !snapshot || busy) return
  const source = client, data = new FormData(event.currentTarget), field = String(data.get('field'))
  setBusy(true); setError(null)
  try {
   const existing = snapshot.data.fields[field] ?? {}
   const fields = { ...snapshot.data.fields, [field]: { ...existing, display_label: String(data.get('display_label')), placeholder: String(data.get('placeholder')), help_text: String(data.get('help_text')), is_hidden: data.has('is_hidden') } }
   const next = await source.execute('write', { revision: snapshot.data.revision, fields })
   if (identity.current === source) setSnapshot(next)
  } catch { if (identity.current === source) { setSnapshot(null); setError('保存を確認できません。最新状態を再取得してください。') } }
  finally { if (identity.current === source) setBusy(false) }
 }
 if (!client) return <p role="alert">ホストでFieldCustomizationProviderを接続してください。</p>
 return <main className="p-4 space-y-4"><h1 className="text-2xl font-bold">項目設定</h1><UserHelp/><Button disabled={busy} onClick={reload}>再取得</Button>{error && <p role="alert">{error}</p>}
  {snapshot && <><h2>{snapshot.data.id}</h2><form onSubmit={event => void save(event)} key={snapshot.revision+'/'+field}><fieldset disabled={busy} className="space-y-2">
   <label className="block">対象項目<select aria-label="対象項目" name="field" required value={field} onChange={event=>setField(event.target.value)}>{Object.entries(snapshot.data.schema.properties ?? {}).map(([key,value]) => <option key={key} value={key}>{String(value.title ?? key)}</option>)}</select></label>
   <label className="block">表示名<Input name="display_label" required maxLength={2000} defaultValue={snapshot.data.fields[field]?.display_label ?? String(snapshot.data.schema.properties?.[field]?.title ?? field)}/></label><label className="block">入力例<Input name="placeholder" maxLength={2000} defaultValue={snapshot.data.fields[field]?.placeholder ?? ''}/></label><label className="block">補足<Input name="help_text" maxLength={2000} defaultValue={snapshot.data.fields[field]?.help_text ?? ''}/></label><label><input type="checkbox" name="is_hidden" defaultChecked={snapshot.data.fields[field]?.is_hidden === true} disabled={snapshot.data.schema.required?.includes(field)}/>非表示</label><Button type="submit">項目設定を保存</Button>
  </fieldset></form><dl>{Object.entries(snapshot.data.fields).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value.display_label} / {value.placeholder} / {value.help_text}{value.is_hidden ? ' / 非表示' : ''}</dd></div>)}</dl></>}
 </main>
}
