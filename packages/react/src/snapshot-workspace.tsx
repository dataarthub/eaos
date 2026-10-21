import * as React from 'react'
import { Button, Input, Card, CardContent } from '@alneas/appkit-react/tools/ui'
import { DataTable } from '@alneas/appkit-react/tools/data-table'
import {CoreWorkspaceHelp} from './user-guide'
import type {WorkspaceClient,WorkspaceSnapshot} from './index'

/**
 * Plugin-owned list/detail labels, actions and snapshot context conversion.
 *
 * @see SnapshotWorkspace for a complete host integration example.
 */
export interface SnapshotWorkspaceDefinition {
 /**
 * Workspace heading.
 */
  title:string
 /**
 * Snapshot collection keys mapped to navigation labels.
 */
  sections:Readonly<Record<string,string>>
 /**
 * Scalar record field captions.
 */
  labels:Readonly<Record<string,string>>
 /**
 * Host operation forms with ordered key/label/type/required field metadata.
 */
  actions:readonly {
/**
 * Host operation identifier.
 */
  operation:string;
/**
 * Human-readable field caption.
 */
  label:string;
/**
 * Ordered command input definitions.
 */
  fields:readonly {
/**
 * Command input property key.
 */
  key:string;
/**
 * Human-readable field caption.
 */
  label:string;
/**
 * Command field kind; supported special forms include collection selectors and numeric/boolean inputs.
 */
  type:string;
/**
 * Whether the generated command input is required; omitted defaults to true.
 */
  required?:boolean}[]}[]
 /**
 * Optional captions for array-valued detail fields.
 */
  arrayLabels?:Readonly<Record<string,string>>
 /**
 * Optional captions for nested item fields.
 */
  itemLabels?:Readonly<Record<string,string>>
 /**
 * Optional field keys rendered as nested details.
 */
  nestedDetails?:readonly string[]
 /**
 * Optional callback returning the collection key for a record.
 * @param record - Host callback input; see the containing contract for validation and scope requirements.
 * @returns Completes without a value after the requested side effect.
 *
 * @example
 * ```typescript
 * import type { SnapshotWorkspaceDefinition } from '@alneas/eaos-react/snapshot-workspace';
 * export function optionKey(definition: SnapshotWorkspaceDefinition, record: Record<string, unknown> & { id: string }) {
 *  return definition.collectionKey?.(record) ?? record.id;
 * }
 * ```
 */
collectionKey?(record:any):string
 /**
 * Optional callback returning the collection display label for a record.
 * @param record - Host callback input; see the containing contract for validation and scope requirements.
 * @returns Completes without a value after the requested side effect.
 *
 * @example
 * ```typescript
 * import type { SnapshotWorkspaceDefinition } from '@alneas/eaos-react/snapshot-workspace';
 * export function optionLabel(definition: SnapshotWorkspaceDefinition, record: Record<string, unknown> & { id: string; name?: string }) {
 *  return definition.collectionLabel?.(record) ?? record.name ?? record.id;
 * }
 * ```
 */
collectionLabel?(record:any):string
 /**
 * Optional synchronous conversion of operation input using current snapshot state.
 * @param operation - Host operation identifier.
 * @param input - Operation input validated and authorized by the host.
 * @param state - Host callback input; see the containing contract for validation and scope requirements.
 * @returns Completes without a value after the requested side effect.
 *
 * @example
 * ```typescript
 * import type { SnapshotWorkspaceDefinition } from '@alneas/eaos-react/snapshot-workspace';
 * export function snapshotInput(definition: SnapshotWorkspaceDefinition, operation: string, input: Record<string, unknown>, state: unknown) {
 *  return definition.prepare?.(operation, input, state) ?? input;
 * }
 * ```
 */
prepare?(operation:string,input:Record<string,unknown>,state:any):Record<string,unknown>
 /**
 * Optional callback adding operation-specific lock/scope input; its fields are spread after the snapshot revision.
 * @param operation - Host operation identifier.
 * @param state - Host callback input; see the containing contract for validation and scope requirements.
 * @returns Completes without a value after the requested side effect.
 *
 * @example
 * ```typescript
 * import type { SnapshotWorkspaceDefinition } from '@alneas/eaos-react/snapshot-workspace';
 * export function operationContext(definition: SnapshotWorkspaceDefinition, operation: string, state: unknown) {
 *  return definition.context?.(operation, state) ?? {};
 * }
 * ```
 */
context?(operation:string,state:any):Record<string,unknown>
}
/**
 * Renders snapshot lists, nested details and host-declared forms while discarding stale UI replies.
 *
 * Snapshot-oriented list/detail/forms. Business conversions, labels and lock context stay plugin-owned.
 * @param props - Authenticated client or null, plugin-owned definition and optional help; undefined help uses core guide and null hides it.
 * @returns A list/form workspace, connection alert when client is missing, and status/error content while requests settle.
 *
 * @remarks
 * Requires React, @alneas/appkit-react and the host application's Appkit React styling (@alneas/appkit-react/styles); the host owns authenticated transports and authorization. Client changes/unmount suppress obsolete replies without cancelling host writes. Commands include snapshot revision; a failure clears the visible snapshot because persistence may already have occurred.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { SnapshotWorkspace, type SnapshotWorkspaceDefinition } from '@alneas/eaos-react/snapshot-workspace';
 * import type { WorkspaceClient } from '@alneas/eaos-react';
 * export function Page({client, definition}: {client: WorkspaceClient<unknown>; definition: SnapshotWorkspaceDefinition}) { return <SnapshotWorkspace client={client} definition={definition}/>; }
 * ```
 */
export function SnapshotWorkspace({client,definition,help}:{
/**
 * Stable host transport carrying current authentication and authorization.
 */
  client:WorkspaceClient<any>|null;
/**
 * Plugin-owned workspace schema, labels and operation declarations.
 */
  definition:SnapshotWorkspaceDefinition;
/**
 * Optional help content; undefined uses core help and null hides help.
 */
  help?:React.ReactNode}) {
  const {title,sections,labels,actions}=definition
  const [snapshot, setSnapshot] = React.useState<WorkspaceSnapshot<any> | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [section, setSection] = React.useState(Object.keys(sections)[0])
  const [selected, setSelected] = React.useState<any>(null)
  const [version, refresh] = React.useReducer((n) => n + 1, 0)
  const generation=React.useRef(0), pending=React.useRef<number|null>(null), lastClient=React.useRef(client), snapshotClient=React.useRef<typeof client>(null)
  if(lastClient.current!==client){lastClient.current=client;generation.current++;pending.current=null}

  React.useEffect(() => {
    let active = true
    const currentGeneration=++generation.current
    pending.current=null
    snapshotClient.current=null
    setSnapshot(null)
    setSelected(null)
    setError(null)
    if (!client) return

    setBusy(true)
    void client
      .load()
      .then((s) => {
        if (active && currentGeneration===generation.current && lastClient.current===client) {snapshotClient.current=client;setSnapshot(s)}
      })
      .catch(() => {
        if (active && currentGeneration===generation.current && lastClient.current===client) setError('取得できません。権限と接続を確認してください。')
      })
      .finally(() => {
        if (active && currentGeneration===generation.current) setBusy(false)
      })

    return () => {
      active = false
      if(generation.current===currentGeneration)generation.current++
    }
  }, [client, version])

  if (!client) {
    return <p role="alert">ホストでWorkspaceProviderを接続してください。</p>
  }

  const run = async (operation: string, data: Record<string, unknown>) => {
    if (!snapshot || busy || pending.current!==null || snapshotClient.current!==client) return
    const currentGeneration=generation.current
    pending.current=currentGeneration
    setBusy(true)
    setError(null)
    const state = snapshot.data as any
    try {
      const next = await client.execute(operation, {
        ...data,
        revision: snapshot.revision,
        ...definition.context?.(operation,state),
      })
      if(currentGeneration===generation.current && lastClient.current===client){snapshotClient.current=client;setSnapshot(next);setSelected(null)}
    } catch {
      if(currentGeneration===generation.current){snapshotClient.current=null;setSnapshot(null);setSelected(null);setError('保存を確認できません。最新状態を再取得して入力・権限・処理状況を確認してください。')}
    } finally {
      if(pending.current===currentGeneration)pending.current=null
      if(currentGeneration===generation.current)setBusy(false)
    }
  }

  if (!snapshot || snapshotClient.current!==client) {
    return (
      <div>
        <p role={error ? 'alert' : 'status'}>{error ?? '読み込み中...'}</p>
        <Button disabled={busy} onClick={refresh}>
          再取得
        </Button>
      </div>
    )
  }

  const state = snapshot.data as any
  const rows: any[] = state[section] ?? []
  const keys = [
    ...new Set(
      rows.flatMap((row) =>
        Object.keys(row).filter((k) => labels[k] && (row[k] === null || typeof row[k] !== 'object'))
      )
    ),
  ]
  const columns = keys.map((key) => ({
    accessorKey: key,
    header: labels[key],
    cell: ({ row }: { row: { original: any } }) => String(row.original[key] ?? ''),
  }))

  return (
    <main className="p-4 space-y-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">{title}</h1>{help===undefined?<CoreWorkspaceHelp/>:help}
        <nav className="flex flex-wrap gap-2">
          {Object.entries(sections).map(([id, label]) => (
            <Button
              key={id}
              aria-pressed={section === id}
              onClick={() => {
                setSection(id)
                setSelected(null)
              }}
            >
              {label}
            </Button>
          ))}
          <Button disabled={busy} onClick={refresh}>
            再取得
          </Button>
        </nav>
      </header>

      {error && <p role="alert" className="text-destructive font-medium">{error}</p>}

      {/* データ一覧テーブル */}
      <section aria-label="データ一覧">
        {rows.length ? (
          <DataTable
            data={rows}
            columns={[
              ...columns,
              {
                id: 'detail',
                header: '詳細',
                cell: ({ row }: { row: { original: any } }) => (
                  <Button onClick={() => setSelected(row.original)}>詳細</Button>
                ),
              },
            ]}
          />
        ) : (
          <p>登録データはありません。</p>
        )}
      </section>

      {/* 詳細カード表示 */}
      {selected && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="text-lg font-semibold">詳細情報</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(selected)
                .filter(([key, value]) => labels[key] && (value === null || typeof value !== 'object'))
                .map(([key, value]) => (
                  <p key={key} className="text-sm">
                    <span className="font-medium text-muted-foreground">{labels[key]}:</span>{' '}
                    {String(value ?? '')}
                  </p>
                ))}
            </div>

            {definition.nestedDetails?.map(field => selected[field] && <dl key={field} className="space-y-1 text-sm">{Object.entries(selected[field]).map(([key,value]) => <div key={key} className="flex gap-2"><dt className="font-medium text-muted-foreground">{key}:</dt><dd>{typeof value==='object'?JSON.stringify(value):String(value)}</dd></div>)}</dl>)}

            {Object.entries(selected)
              .filter(([, value]) => Array.isArray(value))
              .map(([key, value]) => (
                <div key={key} className="space-y-1">
                  <h3 className="font-medium text-sm">
                    {definition.arrayLabels?.[key] ?? '関連情報'}
                  </h3>
                  {(value as any[]).map((item, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      {item !== null && typeof item === 'object'
                        ? Object.entries(item)
                            .filter(
                              ([k]) =>
                                labels[k] || definition.itemLabels?.[k]
                            )
                            .map(
                              ([k, v]) =>
                                (labels[k] ?? definition.itemLabels?.[k]) +
                                ': ' +
                                String(v)
                            )
                            .join(' / ')
                        : String(item)}
                    </p>
                  ))}
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {/* アクション・操作フォーム群 */}
      <section className="grid gap-4 md:grid-cols-2" aria-label="操作フォーム">
        {actions.map((action) => (
          <Card key={action.operation}>
            <CardContent className="p-4 space-y-3">
              <h2 className="text-base font-semibold">{action.label}</h2>
              <form
                key={String(snapshot.revision)}
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  const form = new FormData(event.currentTarget)
                  const data: Record<string, unknown> = {}
                  for (const field of action.fields) {
                    data[field.key] =
                      field.type === 'boolean'
                        ? form.has(field.key)
                        : field.type === 'number'
                          ? Number(form.get(field.key))
                          : String(form.get(field.key) ?? '')
                  }
                  void run(action.operation, (definition.prepare?.(action.operation, data, state) ?? data))
                }}
              >
                <fieldset disabled={busy} className="space-y-3">
                  {action.fields.map((field) => (
                    <label className="block text-sm space-y-1" key={field.key}>
                      <span className="font-medium text-muted-foreground">{field.label}</span>
                      {field.type.startsWith('@') ? (
                        <select
                          name={field.key}
                          required
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                        >
                          {(state[field.type.slice(1)] ?? []).map((r: any) => (
                            <option key={definition.collectionKey?.(r) ?? r.id} value={definition.collectionKey?.(r) ?? r.id}>
                              {definition.collectionLabel?.(r) ?? r.name ?? r.id}
                            </option>
                          ))}
                        </select>
                      ) : field.type.includes(':') ? (
                        <select
                          name={field.key}
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                        >
                          {field.type.split(',').map((pair) => {
                            const [value, label] = pair.split(':')
                            return (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            )
                          })}
                        </select>
                      ) : (
                        <Input
                          required={field.type !== 'boolean' && field.required !== false}
                          name={field.key}
                          type={field.type === 'boolean' ? 'checkbox' : field.type}
                          min={field.type === 'number' ? 0 : undefined}
                        />
                      )}
                    </label>
                  ))}
                  <Button type="submit" disabled={busy}>
                    {action.label}
                  </Button>
                </fieldset>
              </form>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  )
}
