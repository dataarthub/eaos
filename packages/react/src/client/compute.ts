import type { PluginExecutor, PluginExecutionRequest } from './plugin-execution'

/**
 * Worker message/lifecycle capabilities required by the compute executor.
 *
 * @see createWorkerPluginExecutor for a complete host integration example.
 */
export interface ComputeWorkerPort {
  /**
 * Transfer an execution envelope or result; structured-clone failures may throw.
 * @param value - Structured-cloneable message envelope.
 * @returns Completes without a value after the requested side effect.
 *
 * @example
 * ```typescript
 * import type { ComputeWorkerPort } from '@alneas/eaos-react/client/compute';
 * export function postCompute(worker: ComputeWorkerPort, id: number, pluginId: string, action: string, payload: unknown) {
 *  worker.postMessage({ id, request: { pluginId, action, payload } });
 * }
 * ```
 */
postMessage(value: unknown): void
  /**
 * Register a message/error listener for the worker lifetime.
 * @param type - Message/error event name.
 * @param listener - Synchronous snapshot listener called on each published state.
 * @returns Completes without a value after the requested side effect.
 *
 * @example
 * ```typescript
 * import type { ComputeWorkerPort } from '@alneas/eaos-react/client/compute';
 * export async function listenWhile(worker: ComputeWorkerPort, work: () => Promise<void>, received: (value: unknown) => void) {
 *  const listener = (event: { data: unknown }) => received(event.data);
 *  worker.addEventListener('message', listener);
 *  try { await work(); } finally { worker.removeEventListener('message', listener); }
 * }
 * ```
 */
addEventListener(type: string, listener: (event: any) => void): void
  /**
 * Remove the same listener during executor cleanup.
 * @param type - Message/error event name.
 * @param listener - Synchronous snapshot listener called on each published state.
 * @returns Completes without a value after the requested side effect.
 *
 * @example
 * ```typescript
 * import type { ComputeWorkerPort } from '@alneas/eaos-react/client/compute';
 * export async function observeWorker(worker: ComputeWorkerPort, work: () => Promise<void>, received: (value: unknown) => void) {
 *  const listener = (event: { data: unknown }) => received(event.data);
 *  worker.addEventListener('message', listener);
 *  try { await work(); } finally { worker.removeEventListener('message', listener); }
 * }
 * ```
 */
removeEventListener(type: string, listener: (event: any) => void): void
  /**
 * Stop the worker; executor calls this on close, cancellation, timeout or failure.
 * @returns Completes without a value after the requested side effect.
 *
 * @example
 * ```typescript
 * import type { ComputeWorkerPort } from '@alneas/eaos-react/client/compute';
 * export function disposeOwnedWorker(worker: ComputeWorkerPort) { worker.terminate(); }
 * ```
 */
terminate(): void
}
/**
 * Manages a lazy worker and rejects all pending computations when any call aborts, times out or crashes.
 *
 * One worker per authenticated client scope. Cancellation terminates computation and pending calls.
 * @param createWorker - Factory for a trusted worker implementing the compute message protocol.
 * @param timeoutMs - Positive safe integer timeout per call in milliseconds; defaults to 60000.
 * @returns An execute transport and close() that permanently closes the session and terminates its worker.
 * @throws Invalid timeout throws immediately; execute rejects closed/aborted sessions, worker failures, timeouts or transfer errors.
 *
 * @remarks
 * Use one executor per authenticated scope and close on logout/unmount. A failure terminates the shared worker and all pending calls; later calls can create a fresh worker unless closed. Payloads/results must be structured-cloneable.
 *
 * @example
 * ```typescript
 * import { createWorkerPluginExecutor } from '@alneas/eaos-react/client/compute';
 * export async function compute(workerUrl: URL) {
 *  const executor = createWorkerPluginExecutor(() => new Worker(workerUrl, { type: 'module' }));
 *  try { return await executor.execute({ pluginId: 'reports', action: 'sum', payload: [1, 2] }); }
 *  finally { executor.close(); }
 * }
 * ```
 */
export function createWorkerPluginExecutor(createWorker: () => ComputeWorkerPort, timeoutMs = 60_000) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw Error('Invalid compute timeout')
  let worker: ComputeWorkerPort | undefined, closed = false, sequence = 0
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; cleanup(): void }>()
  const fail = (error: Error) => {
    worker?.removeEventListener('message', receive); worker?.removeEventListener('error', crashed); worker?.terminate(); worker = undefined
    for (const call of pending.values()) { call.cleanup(); call.reject(error) }
    pending.clear()
  }
  const receive = (event: { data: any }) => {
    const data = event.data
    if (!data || !Number.isSafeInteger(data.id) || typeof data.ok !== 'boolean') return
    const call = pending.get(data.id)
    if (!call) return
    pending.delete(data.id); call.cleanup()
    data.ok ? call.resolve(data.result) : call.reject(new Error(typeof data.error === 'string' ? data.error : 'Client compute failed'))
  }
  const crashed = () => fail(new Error('Client compute worker failed'))
  const execute: PluginExecutor = async (request, signal) => {
    if (closed) throw Error('Compute session closed')
    signal?.throwIfAborted()
    if (!worker) { worker = createWorker(); worker.addEventListener('message', receive); worker.addEventListener('error', crashed) }
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const abort = () => fail(new Error('Client compute cancelled'))
      const timer = setTimeout(() => fail(new Error('Client compute timed out')), timeoutMs)
      pending.set(id, { resolve, reject, cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', abort) } })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) { abort(); return }
      try { worker!.postMessage({ id, request }) } catch { fail(new Error('Client compute request cannot be transferred')) }
    })
  }
  return { execute,
/**
 * Permanently closes this authenticated compute scope and terminates its worker.
 * @returns Completes without a value after removing listeners and rejecting all pending calls.
 * @example
 * ```typescript
 * import { createWorkerPluginExecutor } from '@alneas/eaos-react/client/compute';
 * export async function compute(workerUrl: URL) {
 *  const executor = createWorkerPluginExecutor(() => new Worker(workerUrl, { type: 'module' }));
 *  try { return await executor.execute({ pluginId: 'reports', action: 'sum', payload: [1, 2] }); }
 *  finally { executor.close(); }
 * }
 * ```
 */
close() { closed = true; fail(new Error('Compute session closed')) } }
}
/**
 * Installs a worker message handler that runs only host-registered pluginId:action operations.
 *
 * Worker-side allowlist. Host code supplies the actual WASM/ONNX handler, never a module URL from the payload.
 * @param scope - Worker-like message target and response sender.
 * @param operations - Trusted allowlist of handlers; each receives request.payload and may return a Promise.
 * @returns Completes without a value after registering the listener.
 *
 * @remarks
 * Install once for a worker lifetime; no uninstall handle is returned. Errors are converted to generic failed response messages. Payload validation and access constraints belong to the registered handler; payload module URLs are never loaded.
 *
 * @example
 * ```typescript
 * import { installComputeWorker } from '@alneas/eaos-react/client/compute';
 * export function install(scope: Parameters<typeof installComputeWorker>[0]) {
 *  installComputeWorker(scope, { 'reports:sum': payload => {
 *   if (!Array.isArray(payload) || payload.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw Error('Invalid values');
 *   return payload.reduce((sum, value) => sum + value, 0);
 *  } });
 * }
 * ```
 */
export function installComputeWorker(scope: {
/**
 * Register the worker message handler for this worker lifetime; no disposer is returned.
 * @param type - Worker event type; installComputeWorker registers message.
 * @param listener - Handler receiving the host event envelope; it remains registered for this worker lifetime.
 * @returns Completes without a value after the host registers the handler; no disposer is exposed by this structural scope.
 * @throws Host listener-registration failures propagate synchronously.
 *
 * @example
 * ```typescript
 * import { installComputeWorker } from '@alneas/eaos-react/client/compute';
 * export function registerMessages(scope: Parameters<typeof installComputeWorker>[0], received: (payload: unknown) => void) {
 *  scope.addEventListener('message', event => received(event.data));
 *  // The owning host terminates this worker to end its listener lifetime.
 * }
 * ```
 */
addEventListener(type: string, listener: (event: any) => void): void;
/**
 * Send a structured-cloneable result envelope back to the client.
 * @param value - Structured-cloneable result/error envelope returned to the client worker executor.
 * @returns Completes without a value after the message is posted; no client acknowledgement is implied.
 * @throws Host transfer or serialization errors propagate synchronously.
 *
 * @example
 * ```typescript
 * import { installComputeWorker } from '@alneas/eaos-react/client/compute';
 * export function replyWithResult(scope: Parameters<typeof installComputeWorker>[0], id: number, result: unknown) {
 *  scope.postMessage({ id, ok: true, result });
 * }
 * ```
 */
postMessage(value: unknown): void }, operations: Readonly<Record<string, (payload: unknown) => unknown | Promise<unknown>>>) {
  scope.addEventListener('message', async (event: { data: { id: number; request: PluginExecutionRequest } }) => {
    const { id, request } = event.data ?? {}
    if (!Number.isSafeInteger(id)) return
    const key = request && `${request.pluginId}:${request.action}`
    try {
      if (!key || !Object.hasOwn(operations, key)) throw Error('Client compute operation unavailable')
      const result = await operations[key](request.payload)
      scope.postMessage({ id, ok: true, result })
    } catch { scope.postMessage({ id, ok: false, error: 'Client compute failed' }) }
  })
}
/**
 * Downloads a compute asset and checks its bytes against a caller-pinned SHA-256 digest.
 * @param asset - HTTPS URL (HTTP allowed only for loopback) and lowercase 64-character hexadecimal digest.
 * @param request - Fetch implementation; defaults to global fetch.
 * @returns Verified asset bytes owned by the caller.
 * @throws Rejects invalid URL/metadata, non-OK response, digest mismatch or fetch/crypto failure.
 *
 * @remarks
 * Requires Web Crypto. Fetch omits credentials, rejects redirects and disables cache; no size limit or timeout is imposed. Pin the digest from a trusted release manifest.
 *
 * @example
 * ```typescript
 * import { fetchVerifiedComputeAsset } from '@alneas/eaos-react/client/compute';
 * export function downloadPinnedAsset(asset: { url: string; sha256: string }) { return fetchVerifiedComputeAsset(asset); }
 * ```
 */
export async function fetchVerifiedComputeAsset(asset: {
/**
 * Trusted asset URL; HTTPS required except HTTP loopback development.
 */
  url: string;
/**
 * Pinned lowercase 64-character hexadecimal SHA-256 digest from a trusted release.
 */
  sha256: string }, request: typeof fetch = fetch): Promise<ArrayBuffer> {
  const url = new URL(asset.url)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error('Invalid compute asset URL')
  if (url.username || url.password || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw Error('Invalid compute asset metadata')
  const response = await request(url, { credentials: 'omit', redirect: 'error', cache: 'no-store' })
  if (!response.ok) throw Error('Compute asset unavailable')
  const bytes = await response.arrayBuffer()
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('')
  if (digest !== asset.sha256) throw Error('Compute asset checksum differs')
  return bytes
}
/**
 * Instantiates Go WASM with a matching host runtime and waits for the host readiness handshake.
 *
 * Official wasm_exec.js runtime is supplied by the host from the matching Go toolchain.
 * @param options - Verified WASM bytes, matching wasm_exec.js runtime, readiness callback and operation invoker.
 * @returns An async action/payload invoker that refuses calls after an observed runtime rejection.
 * @throws Rejects instantiation/readiness failures; returned invoker rejects stopped runtime or propagated invoke failures.
 *
 * @remarks
 * The host must install matching Go runtime imports, implement readiness, and manage lifetime; this helper provides no stop handle. A readiness callback that never settles leaves loading pending.
 *
 * @example
 * ```typescript
 * import { loadGoCompute } from '@alneas/eaos-react/client/compute';
 * export async function startGo(options: Parameters<typeof loadGoCompute>[0]) { return loadGoCompute(options); }
 * ```
 */
export async function loadGoCompute(options: {
/**
 * Verified model or WASM binary bytes supplied by the caller.
 */
  bytes: ArrayBuffer;
/**
 * Official matching Go wasm_exec.js runtime installed by the host.
 */
  runtime: {
/**
 * WebAssembly imports provided by the matching Go runtime.
 */
  importObject: WebAssembly.Imports;
/**
 * Start the Go instance; rejection is recorded and causes subsequent invocations to fail.
 * @param instance - Go WebAssembly instance instantiated with this matching runtime importObject.
 * @returns Resolves without a value when the Go program finishes; an active program can keep this Promise pending.
 * @throws Rejects host runtime/trap failures; loadGoCompute records rejection and rejects subsequent invocations.
 *
 * @example
 * ```typescript
 * import { loadGoCompute } from '@alneas/eaos-react/client/compute';
 * export async function runInstalledGo(runtime: Parameters<typeof loadGoCompute>[0]['runtime'], instance: WebAssembly.Instance) {
 *  await runtime.run(instance);
 * }
 * ```
 */
run(instance: WebAssembly.Instance): Promise<void> };
/**
 * Host readiness handshake; must resolve only when the WASM entry points are usable.
 */
  ready: () => Promise<void>;
/**
 * Host invocation bridge for the installed runtime; rejection propagates.
 */
  invoke: (action: string, payload: unknown) => Promise<unknown> }) {
  const { instance } = await WebAssembly.instantiate(options.bytes, options.runtime.importObject)
  let failure: unknown
  void options.runtime.run(instance).catch(error => { failure = error })
  await options.ready()
  return async (action: string, payload: unknown) => { if (failure) throw Error('Go WASM runtime stopped'); return options.invoke(action, payload) }
}
/**
 * Creates a host AI session with ordered WebGPU/WASM execution-provider preferences.
 *
 * Thin ONNX adapter; model preparation/tensor types remain in the plugin's Worker.
 * @typeParam TSession - Host session object, including any host-required disposal interface.
 * @param options - Verified model bytes, host session factory and webgpu capability flag.
 * @returns The session resolved by createSession; true webgpu supplies [webgpu, wasm], otherwise [wasm].
 * @throws Rejects when the supplied session factory rejects.
 *
 * @remarks
 * The plugin worker owns tensor types, model preparation and session disposal. This helper does not detect capabilities or implement provider fallback itself.
 *
 * @example
 * ```typescript
 * import { loadBrowserAiCompute } from '@alneas/eaos-react/client/compute';
 * export function startModel<T>(bytes: ArrayBuffer, createSession: (bytes: ArrayBuffer, providers: readonly string[]) => Promise<T>) {
 *  return loadBrowserAiCompute({ bytes, createSession, webgpu: false });
 * }
 * ```
 */
export async function loadBrowserAiCompute<TSession>(options: {
/**
 * Verified model or WASM binary bytes supplied by the caller.
 */
  bytes: ArrayBuffer;
/**
 * Host AI session factory receiving bytes and ordered provider preferences; rejects preparation failure.
 */
  createSession: (bytes: ArrayBuffer, providers: readonly string[]) => Promise<TSession>;
/**
 * Whether host capability checks permit WebGPU; false selects WASM only.
 */
  webgpu: boolean }) {
  return options.createSession(options.bytes, options.webgpu ? ['webgpu', 'wasm'] : ['wasm'])
}
