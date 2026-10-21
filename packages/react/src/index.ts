import { createContext, createElement, useContext, useSyncExternalStore, useEffect, useState, useRef, useMemo, type ReactNode } from 'react'
export * from './plugin-gate'
export * from './plugin-runtime'
/**
 * Verified host identity and enabled module IDs used for UI admission.
 *
 * @see createWorkspaceReactBindings for a complete host integration example.
 */
export interface TenantContext {
/**
 * Verified nonempty tenant identifier.
 */
  tenantId: string;
/**
 * Authenticated user ID; null represents missing identity and is rejected by the store when a context is loaded.
 */
  userId: string | null;
/**
 * Module IDs admitted by the host; copied and frozen by createTenantModuleStore.
 */
  enabledModules: readonly string[] }
/**
 * Immutable external-store state with fail-closed identity while loading or after failure.
 * @typeParam T - Host value shape carried by this contract.
 *
 * @see createWorkspaceReactBindings for a complete host integration example.
 */
export interface TenantSnapshot<T extends TenantContext> {
/**
 * Verified identity, or null while loading/unauthenticated/failed.
 */
  context: T | null;
/**
 * True while the newest context request is pending.
 */
  loading: boolean;
/**
 * Loader/validation error for the newest request, or null.
 */
  error: Error | null }
/**
 * Host-driven subscription and refresh contract for tenant module visibility.
 * @typeParam T - Host value shape carried by this contract.
 *
 * @see createWorkspaceReactBindings for a complete host integration example.
 */
export interface TenantModuleStore<T extends TenantContext> {
 /**
 * Register a synchronous snapshot-change listener; returns its unsubscribe callback.
 * @param listener - Synchronous snapshot listener called on each published state.
 * @returns An unsubscribe callback; call it during cleanup.
 *
 * @example
 * ```typescript
 * import type { TenantModuleStore, TenantContext, TenantSnapshot } from '@alneas/eaos-react';
 * export async function observeWhile(store: TenantModuleStore<TenantContext>, work: () => Promise<void>, changed: (snapshot: TenantSnapshot<TenantContext>) => void) {
 *  const unsubscribe = store.subscribe(() => changed(store.getSnapshot()));
 *  try { await work(); } finally { unsubscribe(); }
 * }
 * ```
 */
subscribe(listener: () => void): () => void
 /**
 * Return the current stable immutable snapshot.
 * @returns The current stable snapshot.
 *
 * @example
 * ```typescript
 * import type { TenantModuleStore, TenantContext } from '@alneas/eaos-react';
 * export function currentIdentity(store: TenantModuleStore<TenantContext>) {
 *  const snapshot = store.getSnapshot();
 *  return { context: snapshot.context, loading: snapshot.loading, error: snapshot.error };
 * }
 * ```
 */
getSnapshot(): TenantSnapshot<T>
 /**
 * Abort the previous request, clear identity while loading and publish only the latest result; errors become snapshot.error.
 * @returns Resolves without a value after publishing the latest context or error.
 *
 * @example
 * ```typescript
 * import type { TenantModuleStore, TenantContext } from '@alneas/eaos-react';
 * export async function reloadIdentity(store: TenantModuleStore<TenantContext>) {
 *  await store.refresh();
 *  return store.getSnapshot(); // Inspect error as well as context after completion.
 * }
 * ```
 */
refresh(): Promise<void>
 /**
 * Abort pending loading and publish a nonloading anonymous snapshot; no value is returned.
 * @returns Completes without a value after clearing identity.
 *
 * @example
 * ```typescript
 * import type { TenantModuleStore, TenantContext } from '@alneas/eaos-react';
 * export function onHostIdentityRemoved(store: TenantModuleStore<TenantContext>) {
 *  store.clear(); // Called by the host after logout or identity loss.
 * }
 * ```
 */
clear(): void
}
/**
 * Creates an external store that discards obsolete tenant replies and removes module access while identity is loading.
 *
 * Host supplies auth transport/events. Missing identity, fetch failure and stale responses never grant modules.
 * @typeParam T - Verified tenant context shape, extending the required tenant/user/module fields.
 * @param load - Host loader of verified identity and enabled module IDs; receives an abort signal when refreshed or cleared.
 * @returns A store initially loading with no identity; loader and context-validation failures become snapshot.error.
 *
 * @remarks
 * Call refresh initially and on host auth events; call clear immediately on logout. A refresh aborts the previous request. This store controls UI presentation; server authorization remains mandatory.
 *
 * @example
 * ```typescript
 * import { createTenantModuleStore, type TenantContext } from '@alneas/eaos-react';
 * export async function connectIdentity(load: (signal: AbortSignal) => Promise<TenantContext | null>) {
 *  const store = createTenantModuleStore(load);
 *  await store.refresh();
 *  return { store, disconnect: () => store.clear() };
 * }
 * ```
 */
export function createTenantModuleStore<T extends TenantContext>(load: (signal: AbortSignal) => Promise<T | null>): TenantModuleStore<T> {
 let snapshot: TenantSnapshot<T> = Object.freeze({ context: null, loading: true, error: null })
 let sequence = 0, controller: AbortController | undefined
 const listeners = new Set<() => void>()
 const publish = (next: TenantSnapshot<T>) => { snapshot = Object.freeze(next); for (const listener of listeners) listener() }
 return {
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  getSnapshot: () => snapshot,
  clear() { sequence++; controller?.abort(); publish({ context: null, loading: false, error: null }) },
  async refresh() {
   const current = ++sequence; controller?.abort(); const request = new AbortController(); controller = request
   publish({ context: null, loading: true, error: null })
   try {
    const value = await load(request.signal)
    if (current !== sequence) return
    if (value && (typeof value.tenantId !== 'string' || !value.tenantId || typeof value.userId !== 'string' || !value.userId || !Array.isArray(value.enabledModules) || value.enabledModules.some(k => typeof k !== 'string'))) throw new Error('Invalid authenticated tenant context')
    const context = value ? Object.freeze({ ...value, enabledModules: Object.freeze([...value.enabledModules]) }) as T : null
    publish({ context, loading: false, error: null })
   } catch (error) { if (current === sequence) publish({ context: null, loading: false, error: error instanceof Error ? error : new Error('Tenant context unavailable') }) }
  },
 }
}
const Context = createContext<TenantModuleStore<TenantContext> | null>(null)
/**
 * Makes a host-owned tenant module store available to descendant React hooks.
 * @typeParam T - Host tenant context supplied by the store.
 * @param props - Store and children; keep store identity stable across renders.
 * @returns A context provider rendering children without initiating a refresh.
 *
 * @remarks
 * Requires React. The host owns refreshing and clearing the store on authentication changes.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { TenantModuleProvider, type TenantModuleStore, type TenantContext } from '@alneas/eaos-react';
 * export function TenantRoot({store, children}: {store: TenantModuleStore<TenantContext>; children: React.ReactNode}) {
 *  return <TenantModuleProvider store={store}>{children}</TenantModuleProvider>;
 * }
 * ```
 */
export function TenantModuleProvider<T extends TenantContext>({ store, children }: {
/**
 * Host-owned external tenant store; keep its identity stable across renders.
 */
  store: TenantModuleStore<T>;
/**
 * React descendants rendered within this component.
 */
  children: ReactNode }) { return createElement(Context.Provider, { value: store }, children) }
/**
 * Subscribes to the nearest tenant store and derives module visibility from its current snapshot.
 * @typeParam T - Expected host context; defaults to TenantContext and does not validate extra fields.
 * @returns The current context/loading/error, a hasModule predicate and the store refresh function.
 * @throws Error when called outside TenantModuleProvider.
 *
 * @remarks
 * Use in a React component under TenantModuleProvider; visibility never grants API permission.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { useTenantModule } from '@alneas/eaos-react';
 * // Render within TenantModuleProvider connected to the authenticated host store.
 * export function ApprovalLink() {
 *  const state = useTenantModule();
 *  return state.hasModule('approval') ? <a href="/plugins/approval/workspace">Approvals</a> : null;
 * }
 * ```
 */
export function useTenantModule<T extends TenantContext = TenantContext>() {
 const store = useContext(Context)
 if (!store) throw new Error('TenantModuleProvider is required')
 const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot) as TenantSnapshot<T>
 return { ...snapshot, hasModule: (id: string) => snapshot.context?.enabledModules.includes(id) === true, refetchContext: store.refresh }
}

/**
 * Tenant/resource-bound host response carrying a revision and typed payload.
 * @typeParam TData - Host snapshot payload; defaults to unknown.
 *
 * @see createWorkspaceReactBindings for a complete host integration example.
 *
 * @remarks
 * A tenant/resource-bound snapshot returned by a host-owned record API.
 */
export interface WorkspaceSnapshot<TData = unknown> {
 /**
 * Verified tenant owning this response.
 */
  tenantId: string
 /**
 * Host resource/session record identifier matched by the session boundary.
 */
  recordId: string
 /**
 * Host snapshot revision used for optimistic concurrency; semantics belong to the plugin.
 */
  revision: number
 /**
 * Typed host response payload; session wrappers clone it before returning.
 */
  data: TData
}

/**
 * Authenticated host transport for loading and executing workspace operations.
 * @typeParam TData - Host snapshot payload; defaults to unknown.
 *
 * @see createWorkspaceReactBindings for a complete host integration example.
 *
 * @remarks
 * Host transport for a bounded, optimistic-concurrency workspace.
 */
export interface WorkspaceClient<TData = unknown> {
 /**
 * Load the current authorized snapshot; resolves a WorkspaceSnapshot or rejects transport/authorization failure.
 * @returns The current authorized snapshot.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @example
 * ```typescript
 * import type { WorkspaceClient } from '@alneas/eaos-react';
 * export async function readWorkspace<T>(client: WorkspaceClient<T>) {
 *  const snapshot = await client.load();
 *  return { tenantId: snapshot.tenantId, revision: snapshot.revision, data: snapshot.data };
 * }
 * ```
 */
load(): Promise<WorkspaceSnapshot<TData>>
 /**
 * Execute a named host operation with typed JSON-like input and return the resulting authorized snapshot; rejects host failures.
 * @param operation - Host operation identifier.
 * @param input - Operation input validated and authorized by the host.
 * @returns The next authorized snapshot.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @example
 * ```typescript
 * import type { WorkspaceClient } from '@alneas/eaos-react';
 * export async function executeWorkspace<T>(client: WorkspaceClient<T>, operation: string, input: Record<string, unknown>) {
 *  return client.execute(operation, input); // Include the operation's required revision and validated fields.
 * }
 * ```
 */
execute(operation: string, input: Record<string, unknown>): Promise<WorkspaceSnapshot<TData>>
}

/**
 * Controls which concurrent workspace replies supersede each other.
 *
 * @see createWorkspaceReactBindings for a complete host integration example.
 *
 * @remarks
 * Adds lifecycle, stale-response and tenant/resource checks around a host client.
 * This is UI session state only; authorization remains server-owned.
 */
export interface WorkspaceSessionOptions {
 /**
 * Session-wide latest reply by default; operation-resource keeps independent latest replies per operation and string input.id.
 * @defaultValue 'session'
 *
 * @remarks
 * Independent panels may retain replies from different operations/resources. Default: one latest reply for the session.
 */
 responseScope?: 'session' | 'operation-resource'
}
/**
 * Wraps a workspace transport with session lifetime and tenant/resource response checks.
 * @typeParam TData - Payload shape supplied by the host snapshot transport.
 * @param tenantId - Verified tenant ID expected on every response.
 * @param recordId - Resource/session record ID expected on every response.
 * @param source - Host transport responsible for current authentication and authorization.
 * @param options - Response ordering scope; defaults to one latest reply for the entire session.
 * @returns A guarded client plus close(), which invalidates pending responses without cancelling the underlying transport.
 *
 * @remarks
 * Session operations propagate transport errors and reject after close, when superseded, or for foreign tenant/record responses. Returned snapshots are cloned; server side effects can already have committed when a response is rejected.
 *
 * @example
 * ```typescript
 * import { createWorkspaceSession, type WorkspaceClient } from '@alneas/eaos-react';
 * export async function readWorkspace(tenantId: string, recordId: string, client: WorkspaceClient<unknown>) {
 *  const session = createWorkspaceSession(tenantId, recordId, client);
 *  try { return await session.client.load(); }
 *  finally { session.close(); }
 * }
 * ```
 */
export function createWorkspaceSession<TData>(tenantId: string, recordId: string, source: WorkspaceClient<TData>, options: WorkspaceSessionOptions = {}) {
 let active = true
 let sequence = 0
 const channels = new Map<string, number>()
 const call = async (channel: string, fn: () => Promise<WorkspaceSnapshot<TData>>) => {
  if (!active) throw new Error('Session expired')
  const seq = ++sequence
  if (options.responseScope !== 'operation-resource') channel = 'session'
  channels.set(channel, seq)
  try {
   const result = await fn()
   if (!active || channels.get(channel) !== seq) throw new Error('Stale response')
   if (result.tenantId !== tenantId || result.recordId !== recordId) throw new Error('Foreign response')
   const dataTenantId = (result.data as { tenantId?: unknown } | null | undefined)?.tenantId
   if (typeof dataTenantId !== 'undefined' && dataTenantId !== tenantId) throw new Error('Foreign response')
   return structuredClone(result)
  } finally { if (channels.get(channel) === seq) channels.delete(channel) }
 }
 return {
  close: () => { active = false; sequence++; channels.clear() },
  client: {
   load: () => call('load', () => source.load()),
   execute: (operation: string, input: Record<string, unknown>) => call(JSON.stringify(['execute', operation, typeof input.id === 'string' ? input.id : null]), () => source.execute(operation, input)),
  } satisfies WorkspaceClient<TData>,
 }
}

/**
 * Verified host scope, transport and descendant content for a workspace session.
 * @typeParam TData - Host snapshot payload; defaults to unknown.
 *
 * @see createWorkspaceReactBindings for a complete host integration example.
 */
export interface WorkspaceProviderProps<TData> {
 /**
 * Verified tenant ID; null disables the workspace.
 */
  tenantId: string | null
 /**
 * Verified record/resource key; null disables the workspace.
 */
  recordId: string | null
 /**
 * Host identity generation key; change on authentication changes; null disables the workspace.
 */
  sessionKey: string | null
 /**
 * Stable authenticated transport replaced when its host scope changes.
 */
  client: WorkspaceClient<TData>
 /**
 * Workspace content rendered only when a session is ready.
 */
  children: ReactNode
}

/**
 * Creates an isolated workspace context with a provider that expires sessions on scope changes.
 *
 * Creates typed React bindings for a workspace client without owning auth or data access.
 * Each call creates an isolated context, so unrelated plugin workspaces cannot cross-talk.
 * @typeParam TData - Snapshot payload shared by the returned context and client.
 * @param options - Session reply ordering; defaults to session-wide latest response.
 * @returns WorkspaceProvider and useClient; the hook returns null outside a ready provider.
 *
 * @remarks
 * The provider needs nonempty tenantId, recordId and sessionKey, shows status content until ready, and closes its session on cleanup. It performs no server authentication. See WorkspaceProviderProps.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { createWorkspaceReactBindings, type WorkspaceProviderProps } from '@alneas/eaos-react';
 * const { WorkspaceProvider, useClient } = createWorkspaceReactBindings<unknown>();
 * export function HostWorkspace(props: WorkspaceProviderProps<unknown>) { return <WorkspaceProvider {...props}/>; }
 * export function ConnectionState() { return <p>{useClient() ? 'Connected' : 'Unavailable'}</p>; }
 * ```
 */
export function createWorkspaceReactBindings<TData>(options: WorkspaceSessionOptions = {}) {
 const Context = createContext<WorkspaceClient<TData> | null>(null)
 function WorkspaceProvider({ tenantId, recordId, sessionKey, client, children }: WorkspaceProviderProps<TData>) {
  const key = tenantId && recordId && sessionKey ? JSON.stringify([tenantId, recordId, sessionKey]) : null
  const [ready, setReady] = useState<{ key: string; source: WorkspaceClient<TData>; session: ReturnType<typeof createWorkspaceSession<TData>> } | null>(null)
  useEffect(() => {
   if (!key || !tenantId || !recordId) { setReady(null); return }
   const session = createWorkspaceSession(tenantId, recordId, client, options)
   setReady({ key, source: client, session })
   return () => session.close()
  }, [key, tenantId, recordId, client])
  if (!key) return createElement('p', { role: 'status' }, 'この機能は現在利用できません。')
  if (!ready || ready.key !== key || ready.source !== client) return createElement('p', { role: 'status' }, '読み込み中...')
  return createElement(Context.Provider, { key, value: ready.session.client }, children)
 }
 const useClient = () => useContext(Context)
 return { WorkspaceProvider, useClient }
}

/**
 * Memoizes a plugin adapter for the current tenant, session and source client.
 *
 * Keep a raw client adapter stable while the verified host scope is unchanged.
 * @typeParam T - Raw client shape.
 * @typeParam U - Adapted snapshot payload.
 * @param tenantId - Current verified tenant ID, or null.
 * @param sessionKey - Current host session/resource key, or null.
 * @param client - Stable raw host client.
 * @param adapt - Converts tenant/resource/client into a workspace client; receives empty IDs when scope is missing.
 * @returns The adapted client, recomputed when any dependency changes.
 *
 * @remarks
 * React hook; adapt must be stable and must fail closed for empty scope. The surrounding workspace provider determines readiness.
 *
 * @example
 * ```typescript
 * import { useWorkspaceClientAdapter, type WorkspaceClient } from '@alneas/eaos-react';
 * export function useHostAdapter<T>(tenantId: string | null, sessionKey: string | null, client: WorkspaceClient<T>) {
 *  return useWorkspaceClientAdapter(tenantId, sessionKey, client, (_tenant, _resource, source) => source);
 * }
 * ```
 */
export function useWorkspaceClientAdapter<T,U>(tenantId:string|null,sessionKey:string|null,client:T,adapt:(tenantId:string,recordId:string,client:T)=>WorkspaceClient<U>){
 return useMemo(()=>tenantId&&sessionKey?adapt(tenantId,sessionKey,client):adapt('','',client),[tenantId,sessionKey,client,adapt])
}
/**
 * Tracks one pending UI task and suppresses obsolete completion state after client changes.
 *
 * UI-only single-flight guard. The host still owns authorization and durable execution.
 * @param client - Active transport identity; falsy values disable run.
 * @param onFailure - Called after a current task rejects, before storing its error message.
 * @returns Busy/error state and setters, generation/pending refs and run(work); skipped tasks resolve without running work.
 *
 * @remarks
 * React hook. Tasks are not cancelled on unmount/client change, and a single-flight guard is not server idempotency. work receives the generation to check before applying results.
 *
 * @example
 * ```typescript
 * import { useWorkspaceTask } from '@alneas/eaos-react';
 * export function useReload(client: object | null, reload: () => Promise<void>, clear: () => void) {
 *  const task = useWorkspaceTask(client, clear);
 *  return { ...task, reload: () => task.run(async () => { await reload(); }) };
 * }
 * ```
 */
export function useWorkspaceTask(client:unknown,onFailure:()=>void){
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),generation=useRef(0),pending=useRef<number|null>(null),lastClient=useRef(client)
 if(lastClient.current!==client){lastClient.current=client;generation.current++;pending.current=null}
 useEffect(()=>()=>{generation.current++;pending.current=null},[])
 const run=async(work:(generation:number)=>Promise<void>)=>{
  if(!client||pending.current!==null)return
  const current=generation.current;pending.current=current;setBusy(true);setError(null)
  try{await work(current)}catch(cause){if(current===generation.current&&lastClient.current===client){onFailure();setError(cause instanceof Error?cause.message:String(cause))}}
  finally{if(pending.current===current)pending.current=null;if(current===generation.current)setBusy(false)}
 }
 return {busy,error,setBusy,setError,generation,pending,run}
}
/**
 * Bridges a typed plugin client through an isolated workspace session boundary.
 *
 * Adapt a plugin's typed client through the shared authenticated snapshot/session boundary.
 * @typeParam TClient - Plugin-facing client type.
 * @typeParam TData - Snapshot data carried through the shared session.
 * @param adapt - Converts a typed client and verified scope to a workspace transport.
 * @param unwrap - Converts the guarded transport back to the typed plugin facade.
 * @returns A Provider requiring tenantId/sessionKey/client/children and a useClient hook returning null outside its ready provider.
 *
 * @remarks
 * Keep adapters and raw client stable. The provider uses sessionKey as recordId and closes old sessions on scope change; host transports retain authorization and persistence responsibility.
 *
 * @example
 * ```typescript
 * import { createWorkspaceClientBindings, type WorkspaceClient } from '@alneas/eaos-react';
 * const adapt = (_tenant: string, _record: string, client: WorkspaceClient<unknown>) => client;
 * export const { Provider, useClient } = createWorkspaceClientBindings(adapt, client => client);
 * ```
 */
export function createWorkspaceClientBindings<TClient,TData>(adapt:(tenantId:string,recordId:string,client:TClient)=>WorkspaceClient<TData>,unwrap:(client:WorkspaceClient<TData>)=>TClient){
 const ClientContext=createContext<TClient|null>(null),bindings=createWorkspaceReactBindings<TData>()
 function Bridge({children}:{children:ReactNode}){
  const workspace=bindings.useClient(),client=useMemo(()=>workspace?unwrap(workspace):null,[workspace])
  return createElement(ClientContext.Provider,{value:client},children)
 }
 function Provider({tenantId,sessionKey,client,children}:{tenantId:string|null;sessionKey:string|null;client:TClient;children:ReactNode}){
  const workspace=useWorkspaceClientAdapter(tenantId,sessionKey,client,adapt)
  return createElement(bindings.WorkspaceProvider,{tenantId,recordId:sessionKey,sessionKey,client:workspace,children:createElement(Bridge,{children})})
 }
 return {Provider,useClient:()=>useContext(ClientContext)}
}

export * from './client'
