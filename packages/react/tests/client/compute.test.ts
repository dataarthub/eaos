import { expect, test } from 'bun:test'
import { createWorkerPluginExecutor, fetchVerifiedComputeAsset, installComputeWorker } from '../../src/client/compute'
import { createPluginInvoker } from '../../src/client/plugin-execution'
function workerPair() {
  const listeners = new Map<string, Set<(event: any) => void>>(), inbound: ((event: any) => void)[] = []
  let terminated = false
  const worker = { postMessage(value: unknown) { if (terminated) throw Error('terminated'); queueMicrotask(() => inbound.forEach(fn => fn({ data: value }))) }, addEventListener(type: string, fn: (event: any) => void) { const group = listeners.get(type) ?? new Set(); group.add(fn); listeners.set(type, group) }, removeEventListener(type: string, fn: (event: any) => void) { listeners.get(type)?.delete(fn) }, terminate() { terminated = true } }
  const scope = { addEventListener(_type: string, fn: (event: any) => void) { inbound.push(fn) }, postMessage(value: unknown) { if (!terminated) queueMicrotask(() => listeners.get('message')?.forEach(fn => fn({ data: value }))) } }
  return { worker, scope, terminated: () => terminated }
}
test('worker calls remain correlated and unregistered operations cannot select code', async () => {
  const pair = workerPair()
  installComputeWorker(pair.scope, { 'quant:run': async n => Number(n) * 2 })
  const runner = createWorkerPluginExecutor(() => pair.worker)
  expect(await Promise.all([1, 2, 3].map(payload => runner.execute({ pluginId: 'quant', action: 'run', payload })))).toEqual([2, 4, 6])
  await expect(runner.execute({ pluginId: 'quant', action: 'unregistered', payload: { module: 'https://evil.example/code.js' } })).rejects.toThrow()
  runner.close(); expect(pair.terminated()).toBe(true)
  await expect(runner.execute({ pluginId: 'quant', action: 'run', payload: 4 })).rejects.toThrow('closed')
})
test('aborted browser computation never uploads to the configured server', async () => {
  const pair = workerPair(), controller = new AbortController()
  installComputeWorker(pair.scope, { 'quant:run': () => new Promise(() => {}) })
  const runner = createWorkerPluginExecutor(() => pair.worker)
  let uploads = 0
  const invoke = createPluginInvoker({ operations: { 'quant:run': { placement: 'wasm' } }, wasm: runner.execute, server: async () => { uploads++ } })
  const pending = invoke({ pluginId: 'quant', action: 'run', payload: 'private' }, controller.signal)
  controller.abort()
  await expect(pending).rejects.toThrow('cancelled')
  expect(pair.terminated()).toBe(true); expect(uploads).toBe(0)
  runner.close()
})
test('signed compute assets must match the pinned digest before loading', async () => {
  const bytes = new Uint8Array([0, 97, 115, 109]), digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('')
  let credentials: RequestCredentials | undefined
  const request = (async (_url: unknown, options: RequestInit) => { credentials = options.credentials; return new Response(bytes) }) as typeof fetch
  expect((await fetchVerifiedComputeAsset({ url: 'https://assets.example/model?signature=secret', sha256: digest }, request)).byteLength).toBe(4)
  expect(credentials).toBe('omit')
  await expect(fetchVerifiedComputeAsset({ url: 'https://assets.example/model', sha256: '0'.repeat(64) }, request)).rejects.toThrow('checksum')
})
