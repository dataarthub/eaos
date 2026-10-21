import { dom } from './dom-environment'
import { expect, test } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { PluginGate, PluginRuntimeProvider, TenantModuleProvider, createTenantModuleStore, usePluginCompute, type PluginTenantContext } from '../src/index'
test('PluginGate hides old tenant content while the next authenticated context loads', async () => {
  let allowed = true
  const store = createTenantModuleStore<PluginTenantContext>(async () => ({ tenantId: 't-a', userId: 'u', enabledModules: ['quant'], pluginAccess: { quant: { allowed, reason: 'addon-required' } } }))
  const container = dom.document.createElement('div'); dom.document.body.appendChild(container)
  const root = createRoot(container as any)
  try {
    await act(async () => { root.render(<TenantModuleProvider store={store}><PluginGate pluginId="quant"><span>protected content</span></PluginGate></TenantModuleProvider>); await store.refresh() })
    expect(container.textContent).toContain('protected content')
    allowed = false
    await act(async () => { await store.refresh() })
    expect(container.textContent).not.toContain('protected content')
    expect(container.textContent).toContain('契約プラン')
    await act(async () => store.clear())
    expect(container.textContent).not.toContain('protected content')
  } finally { await act(async () => root.unmount()); container.remove() }
})
test('compute rejects replies belonging to the previous session, including ignored transport cancellation', async () => {
  const container = dom.document.createElement('div'); dom.document.body.appendChild(container)
  const root = createRoot(container as any)
  let execute: ReturnType<typeof usePluginCompute>, resolve!: (value: unknown) => void, signal!: AbortSignal
  const runtime = { tenantId: 't-a', sessionKey: 's1', request: async () => null, compute: async (_plugin: string, _action: string, _input: unknown, s: AbortSignal) => { signal = s; return new Promise(r => { resolve = r }) } }
  function Panel() { execute = usePluginCompute('quant'); return null }
  try {
    await act(async () => root.render(<React.StrictMode><PluginRuntimeProvider runtime={runtime}><Panel /></PluginRuntimeProvider></React.StrictMode>))
    const pending = execute!('run', {}).then(() => 'unexpected', e => e.message)
    await act(async () => root.render(<PluginRuntimeProvider runtime={{ ...runtime, tenantId: 't-b', sessionKey: 's2' }}><Panel /></PluginRuntimeProvider>))
    expect(signal.aborted).toBe(true)
    resolve('old private result')
    expect(await pending).toContain('expired session')
  } finally { await act(async () => root.unmount()); container.remove() }
})
