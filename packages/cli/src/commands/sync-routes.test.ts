import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncRoutes } from './sync-routes'

test('client route composition resolves collection metadata and exact module exports without loading runtime code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eaos-client-collection-')), previous = process.cwd()
  try {
    const pkg = join(root, 'node_modules/@example/plugins')
    await mkdir(join(pkg, 'admin'), { recursive: true })
    await writeFile(join(root, 'package.json'), '{}')
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@example/plugins', exports: { './admin/eaos.clients.json': './admin/eaos.clients.json', './admin/client/web/journal': './dangerous.js' } }))
    await writeFile(join(pkg, 'dangerous.js'), "throw Error('Route generation must not execute runtime code')")
    const manifest = join(pkg, 'admin/eaos.clients.json')
    await writeFile(manifest, JSON.stringify({ web: [{ id: 'journal', path: '/plugins/admin', module: 'admin', export: './client/web/journal' }] }))
    const config = { plugins: [{ id: 'admin', package: '@example/plugins/admin' }] }
    await writeFile(join(root, 'eaos.clients.json'), JSON.stringify(config))
    process.chdir(root)
    await syncRoutes()
    const routes = await readFile(join(root, 'apps/frontend/src/generated/plugin-routes.web.ts'), 'utf8')
    expect(routes).toContain('import("@example/plugins/admin/client/web/journal")')
    expect(routes).toContain('"path":"/plugins/admin"')
    await expect(syncRoutes({ check: true })).resolves.toBeUndefined()
    for (const selector of ['@example/plugins/../admin', '@example/plugins/%61dmin', '@example/plugins//admin']) {
      await writeFile(join(root, 'eaos.clients.json'), JSON.stringify({ plugins: [{ id: 'admin', package: selector }] }))
      await expect(syncRoutes()).rejects.toThrow('Invalid plugin package')
    }
    await writeFile(join(root, 'eaos.clients.json'), JSON.stringify(config))
    await writeFile(manifest, JSON.stringify({ web: [{ id: 'journal', path: '/plugins/administrator', module: 'admin', export: './client/web/journal' }] }))
    await expect(syncRoutes()).rejects.toThrow('Invalid or conflicting client route')
    await writeFile(manifest, JSON.stringify({ web: [{ id: 'journal', path: '/plugins/admin', module: 'admin', export: './client/web/other' }] }))
    await expect(syncRoutes()).rejects.toThrow('explicit package export')
  } finally { process.chdir(previous); await rm(root, { recursive: true, force: true }) }
})

test('third-party single-plugin client manifests still compose their explicit exports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eaos-client-single-')), previous = process.cwd()
  try {
    const pkg = join(root, 'node_modules/example-plugin')
    await mkdir(pkg, { recursive: true })
    await writeFile(join(root, 'package.json'), '{}')
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'example-plugin', exports: { './eaos.clients.json': './eaos.clients.json', './client/web/page': './page.js' } }))
    await writeFile(join(pkg, 'eaos.clients.json'), JSON.stringify({ web: [{ id: 'page', path: '/plugins/example/page', module: 'example', export: './client/web/page' }] }))
    await writeFile(join(root, 'eaos.clients.json'), JSON.stringify({ plugins: [{ id: 'example', package: 'example-plugin' }] }))
    process.chdir(root)
    await syncRoutes()
    expect(await readFile(join(root, 'apps/frontend/src/generated/plugin-routes.web.ts'), 'utf8')).toContain('import("example-plugin/client/web/page")')
  } finally { process.chdir(previous); await rm(root, { recursive: true, force: true }) }
})
