import { expect, test } from 'bun:test'
import { createPluginInvoker, createInvokePluginExecutor } from '../../src/client/plugin-execution'
test('host-selected native failures never fall back to a server', async () => {
 let remote = 0
 const invoke = createPluginInvoker({ operations: { 'notes:parse': { placement: 'native' } }, native: async () => { throw new Error('offline') }, server: async () => { remote++ } })
 await expect(invoke({ pluginId: 'notes', action: 'parse', payload: 'private' })).rejects.toThrow('offline')
 await expect(invoke({ pluginId: 'notes', action: 'unknown', payload: null })).rejects.toThrow('not configured')
 expect(remote).toBe(0)
})
test('native bridge sends an operation, never a caller-selected executable', async () => {
 let args: unknown
 const native = createInvokePluginExecutor(async (command, value) => { expect(command).toBe('execute_plugin'); args = value; return 42 })
 expect(await native({ pluginId: 'notes', action: 'parse', payload: {} })).toBe(42)
 expect(args).toEqual({ request: { pluginId: 'notes', action: 'parse', payload: {} } })
 const controller = new AbortController(); controller.abort()
 await expect(native({ pluginId: 'notes', action: 'parse', payload: null }, controller.signal)).rejects.toThrow()
})
