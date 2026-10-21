/**
 * Plugin operation identifier and untrusted payload passed to an execution adapter.
 *
 * @see createPluginInvoker for a complete host integration example.
 */
export interface PluginExecutionRequest {
/**
 * Plugin identifier used to select the operation adapter.
 */
  pluginId: string;
/**
 * Plugin operation name; validated by the invoker and host.
 */
  action: string;
/**
 * Operation input; host must validate shape and permission before use.
 */
  payload: unknown }
/**
 * Async operation transport whose cancellation and authorization are adapter-owned.
 *
 * @see createPluginInvoker for a complete host integration example.
 */
export type PluginExecutor = (request: PluginExecutionRequest, signal?: AbortSignal) => Promise<unknown>
/**
 * Creates a cookie-authenticated JSON POST transport for plugin operations.
 * @param options - HTTPS endpoint without credentials/query/fragment; optional fetch and per-request headers callback.
 * @returns An executor resolving parsed JSON, with pluginId/action appended as encoded path segments.
 * @throws Invalid endpoint throws immediately; returned executor rejects on header/serialization/fetch/JSON errors or non-OK HTTP status.
 *
 * @remarks
 * Host must enforce session, CSRF, tenant and operation permissions. Requests use include credentials, no-store and redirect:error; caller signal is forwarded. There are no retries or fallback destinations.
 *
 * @example
 * ```typescript
 * import { createHttpPluginExecutor } from '@alneas/eaos-react/client/plugin-execution';
 * const execute = createHttpPluginExecutor({ endpoint: 'https://app.example.com/api/execute' });
 * export const readReport = () => execute({ pluginId: 'reports', action: 'read', payload: { id: 'sample' } });
 * ```
 */
export function createHttpPluginExecutor(options: {
/**
 * Credential-free HTTPS execution URL without query or fragment.
 */
  endpoint: string;
/**
 * Optional fetch implementation; defaults to global fetch.
 */
  fetch?: typeof fetch;
/**
 * Optional callback returning current host session/CSRF headers for each request.
 */
  headers?: () => Record<string, string> }): PluginExecutor {
  const base = new URL(options.endpoint)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Invalid execution endpoint')
  const request = options.fetch ?? fetch
  return async (operation, signal) => {
    const response = await request(`${base.href.replace(/\/$/, '')}/${encodeURIComponent(operation.pluginId)}/${encodeURIComponent(operation.action)}`, {
      method: 'POST', credentials: 'include', redirect: 'error', cache: 'no-store', signal,
      headers: { ...options.headers?.(), 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(operation.payload),
    })
    if (!response.ok) throw new Error(`Plugin execution failed (${response.status})`)
    return response.json()
  }
}
/**
 * Adapts a native execute_plugin command with abort checks before and after invocation.
 *
 * The native command must independently resolve identity and enforce operation permissions.
 * @param invoke - Installed native bridge that independently resolves identity and checks operation permissions.
 * @returns An executor resolving the native result unless its signal has been aborted.
 * @throws Returned executor rejects on aborted signals or native bridge rejection.
 *
 * @remarks
 * Aborting does not interrupt the native command; it discards the eventual response. Native side effects may already have completed.
 *
 * @example
 * ```typescript
 * import { createInvokePluginExecutor } from '@alneas/eaos-react/client/plugin-execution';
 * export function connectNative(invoke: Parameters<typeof createInvokePluginExecutor>[0]) { return createInvokePluginExecutor(invoke); }
 * ```
 */
export function createInvokePluginExecutor(invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>): PluginExecutor {
  return async (request, signal) => {
    signal?.throwIfAborted()
    const result = await invoke('execute_plugin', { request })
    signal?.throwIfAborted()
    return result
  }
}
/**
 * Routes an explicitly configured plugin operation to its host-selected execution placement.
 *
 * The host explicitly selects placement. A native failure never uploads data to a remote fallback.
 * @param options - Operation allowlist keyed pluginId:action and executors for wasm/browser-ai/native/server placements.
 * @returns An invoker resolving the selected executor result; operations are cloned when configured.
 * @throws Returned invoker rejects invalid identifiers, unconfigured operations, missing executors, cancellation and executor failures.
 *
 * @remarks
 * No failure triggers another placement. Native, worker and server adapters must independently enforce their trust boundaries. Cancellation is delegated after an initial abort check.
 *
 * @example
 * ```typescript
 * import { createPluginInvoker, type PluginExecutor } from '@alneas/eaos-react/client/plugin-execution';
 * export function routeReports(server: PluginExecutor) {
 *  return createPluginInvoker({ operations: { 'reports:read': { placement: 'server' } }, server });
 * }
 * ```
 */
export function createPluginInvoker(options: {
  /**
 * Explicit host operation allowlist; unlisted operations are rejected.
 */
  operations: Record<string, {
/**
 * Explicit operation location; failures never choose a different location.
 */
  placement: 'wasm' | 'browser-ai' | 'native' | 'server' }>
  /**
 * Optional native adapter; selected before web and never silently retried in another destination.
 */
  native?: PluginExecutor
  /**
 * Optional server executor, responsible for current tenant and operation authorization.
 */
  server?: PluginExecutor
  /**
 * Optional trusted WASM worker executor.
 */
  wasm?: PluginExecutor
  /**
 * Optional trusted browser AI executor.
 */
'browser-ai'?: PluginExecutor
}) {
  const operations = structuredClone(options.operations)
  return async (request: PluginExecutionRequest, signal?: AbortSignal) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(request.pluginId) || !/^[a-zA-Z0-9_-]+$/.test(request.action)) throw new Error('Invalid plugin operation')
    const key = `${request.pluginId}:${request.action}`
    if (!Object.hasOwn(operations, key)) throw new Error('Plugin operation is not configured')
    const execute = options[operations[key].placement]
    if (!execute) throw new Error('Plugin execution placement is unavailable')
    signal?.throwIfAborted()
    return execute(request, signal)
  }
}
