import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { syncRoutes } from '../commands/sync-routes'
import * as deploymentAssets from './deployment-assets'
import { createDeploymentPlan } from './deployment-plan'
import { expandPreset, resolveProjectManifest } from './preset'
import { loadRegisteredPlatformModules, stagePlatformPackages } from './packages'
import { FRAMEWORK_VERSION } from '@alneas/eaos-server/lifecycle-engine'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function collection() {
  const root = await mkdtemp(join(tmpdir(), 'eaos-collection-')); roots.push(root)
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@example/plugins', version: '0.1.0', type: 'module', exports: Object.fromEntries(['approval', 'admin', 'unused'].map(id => [`./${id}/deployment.json`, `./dist/${id}/deployment.json`])) }))
  await writeFile(join(root, 'catalog.json'), JSON.stringify({ apiVersion: 1, plugins: ['approval', 'admin', 'unused'] }))
  for (const id of ['approval', 'admin', 'unused']) {
    await mkdir(join(root, id), { recursive: true }); await mkdir(join(root, 'dist', id, 'src'), { recursive: true })
    await writeFile(join(root, id, 'deployment.json'), JSON.stringify({ apiVersion: 1, owner: `@example/plugins/${id}`, version: '0.1.0', lifecycleBundle: [id], functions: [], assets: [], plugins: [{ id, components: [{ id: 'api', kind: 'api', placement: 'host', assetPatterns: ['src/index.js'] }], tasks: [{ id: 'verify', componentIds: ['api'], action: 'verify', scope: 'environment', required: true, dependsOn: [], executor: 'host:verify' }] }] }))
    await writeFile(join(root, 'dist', id, 'src/runtime.js'), id === 'unused' ? "throw Error('Unselected module executed')" : `import '../chunk.js'; export function createExtension({tenantIds}) {return {apiVersion:1,id:'@example/plugins/${id}',tenantIds,lifecycle:[{id:'${id}',version:'0.1.0',framework:'^${FRAMEWORK_VERSION}',migrations:[]}]}}`)
    await writeFile(join(root, 'dist', id, 'src/index.js'), "throw Error('API module executed')")
    await writeFile(join(root, 'dist', id, 'chunk.js'), 'export const chunk = true')
  }
  return root
}
async function host() {
  const source = await collection()
  await deploymentAssets.preparePluginCollection(source)
  const root = await mkdtemp(join(tmpdir(), 'eaos-collection-host-')); roots.push(root)
  await writeFile(join(root, 'package.json'), '{}')
  await mkdir(join(root, 'node_modules/@example'), { recursive: true })
  const { cp } = await import('node:fs/promises')
  await cp(source, join(root, 'node_modules/@example/plugins'), { recursive: true })
  const manifest = { preset: 'oci-adb', platform: { appName: 'example', baseDomain: 'example.test' }, plugins: ['@example/plugins/approval', '@example/plugins/admin'] }
  await writeFile(join(root, 'eaos.platform.json'), JSON.stringify(manifest))
  return { root, manifest }
}
test('collection inventories contain exact independent compiled files and preserve plugin identities', async () => {
  const root = await collection()
  const inventories = await deploymentAssets.preparePluginCollection(root)
  expect(inventories.map(i => i.owner)).toEqual(['@example/plugins/approval', '@example/plugins/admin', '@example/plugins/unused'])
  expect(inventories[0].assets.map(a => a.path)).toEqual(['chunk.js', 'src/index.js', 'src/runtime.js'])
  expect(inventories[0].runtime).toBe('src/runtime.js')
  expect(inventories[0].lifecycleBundle).toEqual(['approval'])
  expect(inventories[0].plugins?.[0].components[0].assets).toEqual(['src/index.js'])
  const paths = ['approval', 'admin'].map(id => join(root, 'dist', id, 'deployment.json'))
  expect((await createDeploymentPlan(paths)).contributions).toHaveLength(2)
  await writeFile(join(root, 'dist/approval/chunk.js'), 'tampered')
  await expect(createDeploymentPlan(paths)).rejects.toThrow('checksum')
})
test('collection finalization rejects owner/version mismatches, traversal catalog IDs and escaped output symlinks', async () => {
  for (const change of [{ owner: '@example/wrong' }, { version: '0.2.0' }]) {
    const root = await collection(), path = join(root, 'approval/deployment.json')
    await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), ...change }))
    await expect(deploymentAssets.preparePluginCollection(root)).rejects.toThrow('release differs')
  }
  for (const id of ['../approval', '.', 'approval/child', 'approval%2fchild', 'approval\\child']) {
    const root = await collection()
    await writeFile(join(root, 'catalog.json'), JSON.stringify({ apiVersion: 1, plugins: [id] }))
    await expect(deploymentAssets.preparePluginCollection(root)).rejects.toThrow('catalog')
  }
  const root = await collection()
  await rm(join(root, 'dist/approval'), { recursive: true })
  await symlink(join(root, 'dist/admin'), join(root, 'dist/approval'))
  await expect(deploymentAssets.preparePluginCollection(root)).rejects.toThrow('Symlink')
})
test('preset selects multiple modules from one installed collection without executing unselected code and stages them independently', async () => {
  const { root, manifest } = await host()
  const selected = await resolveProjectManifest(root, manifest)
  expect(selected.npmArtifacts.map(a => a.id)).toEqual(['@example/plugins/approval', '@example/plugins/admin'])
  expect(selected.resolved.deployment.placements?.plugins.map(p => p.pluginId)).toEqual(['approval', 'admin'])
  const staged = join(root, 'staged')
  await stagePlatformPackages(root, staged)
  const loaded = await loadRegisteredPlatformModules(staged, 'eaos.platform.json', { tenantIds: ['tenant-a'] })
  expect(loaded.map(m => m.contribution.id)).toEqual(['@example/plugins/approval', '@example/plugins/admin'])
  expect(await Bun.file(join(staged, 'node_modules/@example/plugins/dist/unused/src/runtime.js')).exists()).toBe(false)
  const file = join(root, 'node_modules/@example/plugins/dist/admin/deployment.json')
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), owner: '@example/plugins/approval' }))
  await expect(resolveProjectManifest(root, manifest)).rejects.toThrow('matching owner')
})
test('preset permits safe package subpaths and rejects malformed, encoded and traversal selectors', () => {
  for (const selector of ['@example/plugins/approval', 'third-party/plugin', '@example/plugins']) {
    expect(() => expandPreset({ preset: 'oci-adb', plugins: [selector] })).not.toThrow()
  }
  for (const selector of ['@example/plugins/../admin', '@example/plugins/.', '@example/plugins/%61dmin', '@example/plugins//admin', '@example/plugins/admin/', '/absolute', './local', '@example/plugins\\admin', '@example/plugins/a?x', '@example/plugins/a#x', '@example/plugins/.hidden']) {
    expect(() => expandPreset({ preset: 'oci-adb', plugins: [selector] })).toThrow('Preset plugins')
  }
})
test('deployment-assets command finalizes a collection root and reports failure for invalid module metadata', async () => {
  const root = await collection()
  const run = () => Bun.spawn([process.execPath, new URL('./deployment-assets.ts', import.meta.url).pathname, root], { stdout: 'pipe', stderr: 'pipe' })
  const result = run()
  const error = await new Response(result.stderr).text()
  expect({ code: await result.exited, error }).toEqual({ code: 0, error: '' })
  expect(JSON.parse(await readFile(join(root, 'dist/admin/deployment.json'), 'utf8')).owner).toBe('@example/plugins/admin')
  await writeFile(join(root, 'admin/deployment.json'), '{}')
  const invalid = run()
  await new Response(invalid.stderr).text()
  expect(await invalid.exited).not.toBe(0)
})

async function publicHost() {
  const fixture = await host(), pkgRoot = join(fixture.root, 'node_modules/@example/plugins')
  const metadata = JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf8'))
  metadata.exports['./catalog.json'] = './catalog.json'
  for (const id of ['approval', 'admin', 'unused']) {
    const target = `./dist/${id}/src/runtime.js`
    metadata.exports[`./${id}`] = { types: `./dist/${id}/src/index.d.ts`, import: `./dist/${id}/src/index.js`, default: `./dist/${id}/src/index.js` }
    metadata.exports[`./${id}/runtime`] = { types: `./dist/${id}/src/index.d.ts`, node: { import: target, require: target }, default: target }
    metadata.exports[`./${id}/react`] = { types: `./dist/${id}/src/index.d.ts`, import: `./dist/${id}/src/index.js`, default: `./dist/${id}/src/index.js` }
    await writeFile(join(pkgRoot, 'dist', id, 'src/index.d.ts'), 'export declare const value: boolean')
  }
  metadata.exports['./approval/import-only'] = { types: './dist/approval/src/index.d.ts', import: './dist/approval/src/runtime.js' }
  metadata.exports['./administrator'] = './dist/admin/src/index.js'
  metadata.exports['./admin/eaos.clients.json'] = './dist/admin/eaos.clients.json'
  metadata.exports['./admin/client/web/journal'] = metadata.exports['./admin/react']
  metadata.exports['./admin/incomplete'] = { import: './dist/admin/src/index.js', types: './missing.d.ts' }
  metadata.exports['./admin/foreign'] = { import: './dist/admin/src/index.js', types: './dist/unused/src/index.d.ts' }
  await writeFile(join(pkgRoot, 'dist/admin/eaos.clients.json'), JSON.stringify({ web: [{ id: 'journal', path: '/plugins/admin', module: 'admin', export: './client/web/journal' }] }))
  await writeFile(join(pkgRoot, 'package.json'), JSON.stringify(metadata))
  await deploymentAssets.preparePluginCollection(pkgRoot)
  return { ...fixture, pkgRoot }
}
test('staged collections preserve selected verified conditional exports and client route composition', async () => {
  const { root } = await publicHost(), staged = join(root, 'staged'), previous = process.cwd()
  await stagePlatformPackages(root, staged)
  const require = createRequire(join(staged, 'package.json'))
  for (const selector of ['approval', 'approval/runtime', 'admin/react', 'admin/client/web/journal', 'admin/deployment.json']) {
    expect(require.resolve('@example/plugins/' + selector).startsWith(join(staged, 'node_modules/@example/plugins/dist/'))).toBe(true)
  }
  for (const selector of ['unused/runtime', 'catalog.json', 'administrator', 'admin/incomplete', 'admin/foreign']) {
    expect(() => require.resolve('@example/plugins/' + selector)).toThrow()
  }
  await writeFile(join(staged, 'import-check.mjs'), `import assert from 'node:assert/strict'; const target=import.meta.resolve('@example/plugins/approval/import-only'); assert.ok(target.endsWith('/dist/approval/src/runtime.js')); const module=await import('@example/plugins/approval/import-only'); assert.equal(typeof module.createExtension,'function')`)
  const imported = Bun.spawn([process.execPath, join(staged, 'import-check.mjs')], { stdout: 'pipe', stderr: 'pipe' })
  const error = await new Response(imported.stderr).text()
  expect({ code: await imported.exited, error }).toEqual({ code: 0, error: '' })
  const metadata = JSON.parse(await readFile(join(staged, 'node_modules/@example/plugins/package.json'), 'utf8'))
  expect(metadata.exports['./approval/runtime'].node).toEqual({ import: './dist/approval/src/runtime.js', require: './dist/approval/src/runtime.js' })
  await writeFile(join(staged, 'eaos.clients.json'), JSON.stringify({ plugins: [{ id: 'admin', package: '@example/plugins/admin' }] }))
  try {
    process.chdir(staged)
    await syncRoutes()
    expect(await readFile(join(staged, 'apps/frontend/src/generated/plugin-routes.web.ts'), 'utf8')).toContain('import("@example/plugins/admin/client/web/journal")')
  } finally { process.chdir(previous) }
})
test('staging rejects malformed and escaped selected export targets', async () => {
  for (const target of ['./dist/admin/../unused/src/runtime.js', '../escape.js', '/absolute.js', './dist/admin/%2e%2e/runtime.js', './dist/admin/unsafe\\runtime.js', 42, ['./dist/admin/src/runtime.js']]) {
    const { root, pkgRoot } = await publicHost(), metadata = JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf8'))
    metadata.exports['./admin/unsafe'] = { default: target }
    await writeFile(join(pkgRoot, 'package.json'), JSON.stringify(metadata))
    await expect(stagePlatformPackages(root, join(root, 'staged'))).rejects.toThrow('Invalid staged package export')
  }
})
