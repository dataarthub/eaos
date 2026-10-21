import { test, expect } from 'bun:test'
import { loadClientRoute } from '../../src/client/client-routes'
test('disabled routes are not loaded and revocation during import rejects the result', async () => {
 let enabled = false, loads = 0
 const route = { id: 'home', pluginId: 'notes', path: '/plugins/notes/home', module: 'notes', load: async () => { loads++; enabled = false; return { default: 'page' } } }
 await expect(loadClientRoute(route, () => enabled)).rejects.toThrow(); expect(loads).toBe(0)
 enabled = true; await expect(loadClientRoute(route, () => enabled)).rejects.toThrow(); expect(loads).toBe(1)
})
