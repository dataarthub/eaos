import { createContext, createElement, useContext, useEffect, useMemo, type ReactNode } from 'react'
/**
 * Live host request and compute capabilities bound to one authenticated session.
 *
 * @see createWorkspaceReactBindings for a complete host integration example.
 */
export interface PluginClientRuntime {
  /**
 * Current verified tenant identifier.
 */
  tenantId: string
  /**
 * Current authenticated session generation; replace on identity changes.
 */
  sessionKey: string
  /**
 * Perform an authenticated plugin API operation; resolve response data or reject host failures; honor the signal when possible.
 * @param pluginId - Plugin identifier whose current permission must be checked.
 * @param path - Host API operation/path.
 * @param input - Operation input validated and authorized by the host.
 * @param signal - Cancellation signal; honor it where possible and do not expose stale results.
 * @returns The host API result.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @remarks
 * Host resolves CSRF and verified session headers on every request.
 *
 * @example
 * ```typescript
 * import type { PluginClientRuntime } from '@alneas/eaos-react/plugin-runtime';
 * export function requestPlugin(runtime: PluginClientRuntime, pluginId: string, path: string, input: unknown, signal: AbortSignal) {
 *  return runtime.request(pluginId, path, input, signal);
 * }
 * ```
 */
  request(pluginId: string, path: string, input: unknown, signal: AbortSignal): Promise<unknown>
  /**
 * Perform a host-selected compute action; resolve result data or reject; authorization and cancellation are host-owned.
 * @param pluginId - Plugin identifier whose current permission must be checked.
 * @param action - Requested plugin action to authorize against current state.
 * @param input - Operation input validated and authorized by the host.
 * @param signal - Cancellation signal; honor it where possible and do not expose stale results.
 * @returns The host compute result.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @example
 * ```typescript
 * import type { PluginClientRuntime } from '@alneas/eaos-react/plugin-runtime';
 * export function computePlugin(runtime: PluginClientRuntime, pluginId: string, action: string, input: unknown, signal: AbortSignal) {
 *  return runtime.compute(pluginId, action, input, signal);
 * }
 * ```
 */
compute(pluginId: string, action: string, input: unknown, signal: AbortSignal): Promise<unknown>
}
const Runtime = createContext<PluginClientRuntime | null>(null)
/**
 * Provides the current authenticated request and compute adapters to plugin descendants.
 * @param props - Current host runtime or null when unavailable, plus descendant children.
 * @returns A runtime context provider rendering children.
 *
 * @remarks
 * Replace runtime/sessionKey when identity changes. Operation hooks abort pending signals on cleanup and reject stale replies; host transports remain responsible for authorization.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { PluginRuntimeProvider, type PluginClientRuntime } from '@alneas/eaos-react/plugin-runtime';
 * export function RuntimeRoot({runtime, children}: {runtime: PluginClientRuntime | null; children: React.ReactNode}) { return <PluginRuntimeProvider runtime={runtime}>{children}</PluginRuntimeProvider>; }
 * ```
 */
export function PluginRuntimeProvider({ runtime, children }: {
/**
 * Official matching Go wasm_exec.js runtime installed by the host.
 */
  runtime: PluginClientRuntime | null;
/**
 * React descendants rendered within this component.
 */
  children: ReactNode }) {
  return createElement(Runtime.Provider, { value: runtime }, children)
}
function useRuntimeOperation(pluginId: string, kind: 'request' | 'compute') {
  const runtime = useContext(Runtime)
  const session = useMemo(() => ({ controller: new AbortController(), active: true }), [runtime, runtime?.tenantId, runtime?.sessionKey, pluginId])
  useEffect(() => { if (session.controller.signal.aborted) session.controller = new AbortController(); session.active = true; return () => { session.active = false; session.controller.abort() } }, [session])
  return useMemo(() => async <T = unknown>(operation: string, input?: unknown): Promise<T> => {
    if (!runtime?.tenantId || !runtime.sessionKey || !session.active) throw Error('Authenticated plugin runtime required')
    if (!/^[a-z][a-z0-9-]{0,127}$/.test(pluginId)) throw Error('Invalid plugin ID')
    const controller = session.controller
    const result = await runtime[kind](pluginId, operation, input, controller.signal)
    if (!session.active || controller.signal.aborted) throw Error('Plugin response belongs to an expired session')
    return result as T
  }, [runtime, pluginId, kind, session])
}
/**
 * Creates a session-bound request function for one plugin using the nearest host runtime.
 * @param pluginId - Lowercase plugin ID starting with a letter and containing letters, digits or hyphens; maximum 128 characters.
 * @returns A generic async (operation, input?) function resolving host data; its type argument is a caller assertion, not runtime validation.
 * @throws Returned function rejects missing runtime, invalid plugin ID, expired session and propagated host errors.
 *
 * @remarks
 * Use within React under PluginRuntimeProvider. Scope changes/unmount abort the shared signal and invalidate replies. Host must honor cancellation where possible; completed side effects are not rolled back.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { usePluginApi } from '@alneas/eaos-react/plugin-runtime';
 * // Mount below PluginRuntimeProvider supplied by the authenticated host.
 * export function ReloadButton() { const execute = usePluginApi('reports'); return <button onClick={() => void execute('read', { id: 'sample' }).catch(console.error)}>Read</button>; }
 * ```
 */
export const usePluginApi = (pluginId: string) => useRuntimeOperation(pluginId, 'request')
/**
 * Creates a session-bound compute function for one plugin using the nearest host runtime.
 * @param pluginId - Lowercase plugin ID starting with a letter and containing letters, digits or hyphens; maximum 128 characters.
 * @returns A generic async (operation, input?) function resolving host data; its type argument is a caller assertion, not runtime validation.
 * @throws Returned function rejects missing runtime, invalid plugin ID, expired session and propagated host errors.
 *
 * @remarks
 * Use within React under PluginRuntimeProvider. Scope changes/unmount abort the shared signal and invalidate replies. Host must honor cancellation where possible; completed side effects are not rolled back.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { usePluginCompute } from '@alneas/eaos-react/plugin-runtime';
 * // Mount below PluginRuntimeProvider supplied by the authenticated host.
 * export function ReloadButton() { const execute = usePluginCompute('reports'); return <button onClick={() => void execute('read', { id: 'sample' }).catch(console.error)}>Read</button>; }
 * ```
 */
export const usePluginCompute = (pluginId: string) => useRuntimeOperation(pluginId, 'compute')
