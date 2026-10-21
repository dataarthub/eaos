import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { generatePlatform } from './index'
import { FRAMEWORK_VERSION } from '@alneas/eaos-server/lifecycle-engine'
import { resolveProjectManifest } from './preset'
import { initializePreset, renderOciAdbTemplate } from '../presets/oci-adb/template'
const roots: string[] = []
test('new Pulumi projects adopt the CLI release that generated them', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  const generated = JSON.parse(renderOciAdbTemplate('example')['pulumi/package.json'])
  expect(generated.dependencies['@alneas/eaos-cli']).toBe('^' + pkg.version)
})
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'eaos-preset-')); roots.push(root)
  const manifest = { preset: 'oci-adb', platform: { appName: 'example', baseDomain: 'example.com' }, plugins: ['@example/plugins'], corporatePackages: [{ id: 'corp-a', path: './vendor/corp-a', tenants: ['tenant-a'] }] }
  await writeFile(join(root, 'package.json'), '{}')
  await writeFile(join(root, 'eaos.platform.json'), JSON.stringify(manifest))
  for (const [directory, owner, ids] of [['node_modules/@example/plugins', '@example/plugins', ['public-a', 'public-b']], ['vendor/corp-a', 'corp-a', ['corp-a']]] as const) {
    const target = join(root, directory); await mkdir(target, { recursive: true })
    const content = 'throw new Error("must not execute generation")'
    await writeFile(join(target, 'runtime.js'), content)
    await writeFile(join(target, 'package.json'), JSON.stringify({ name: owner, exports: { './deployment.json': './deployment.json' } }))
    await writeFile(join(target, 'deployment.json'), JSON.stringify({ apiVersion: 1, owner, functions: [], runtime: 'runtime.js', assets: [{ path: 'runtime.js', sha256: createHash('sha256').update(content).digest('hex') }], lifecycleBundle: ids,
      plugins: ids.map(id => ({ id, components: [{ id: 'ui', kind: 'frontend', placement: 'host' }, { id: 'api', kind: 'api', placement: 'container' }, { id: 'db', kind: 'database', placement: 'database' }, { id: 'native', kind: 'native', placement: 'native', required: false }], tasks: ['ui', 'api', 'db', 'native'].map(component => ({ id: `verify-${component}`, action: 'verify', scope: 'environment', componentIds: [component], required: true, dependsOn: [], executor: 'host:verify' })) })) }))
  }
  return { root, manifest }
}
test('minimal OCI manifest verifies npm/corporate packages and expands all component placements without executing runtime code', async () => {
  const { root, manifest } = await project()
  const result = await resolveProjectManifest(root, manifest)
  expect(result.resolved.packages[0].tenantIds).toEqual(['tenant-a'])
  expect(result.resolved.runtime?.backend.dialect).toBe('oracle')
  expect(result.resolved.deployment.placements?.plugins).toHaveLength(3)
  expect(result.resolved.deployment.placements?.plugins[0].components).toEqual({ ui: ['preset-frontend'], api: ['preset-backend'], db: ['preset-database'], native: [] })
  await generatePlatform(root)
  const placements = JSON.parse(await readFile(join(root, '.eaos/generated/platform/deployment-placements.json'), 'utf8'))
  expect(placements.components).toHaveLength(12)
  await expect(generatePlatform(root, { check: true })).resolves.toMatchObject({ status: 'current' })
  await writeFile(join(root, 'node_modules/@example/plugins/runtime.js'), 'changed')
  await expect(generatePlatform(root, { check: true })).rejects.toThrow('checksum')
})
test('required external work needs an explicit destination; unknown fields and missing packages fail closed', async () => {
  const { root, manifest } = await project()
  const path = join(root, 'vendor/corp-a/deployment.json'), inv = JSON.parse(await readFile(path, 'utf8'))
  inv.plugins[0].components[3].required = true
  await writeFile(path, JSON.stringify(inv))
  await expect(resolveProjectManifest(root, manifest)).rejects.toThrow('explicit binding')
  await expect(resolveProjectManifest(root, { ...manifest, typo: true })).rejects.toThrow('unknown key')
  await expect(resolveProjectManifest(root, { ...manifest, preset: 'fake' })).rejects.toThrow('Unknown Platform preset')
  await expect(resolveProjectManifest(root, { ...manifest, plugins: ['@example/missing'] })).rejects.toThrow()
})
test('preset initialization preserves customized Pulumi source and refuses symlink destinations', async () => {
  const { root } = await project()
  await initializePreset(root)
  expect(await readFile(join(root, 'pulumi/index.ts'), 'utf8')).toContain("requireSecret('adminPassword')")
  await initializePreset(root)
  await writeFile(join(root, 'pulumi/custom.ts'), 'host customization')
  await expect(initializePreset(root)).rejects.toThrow('already exists')
  expect(await readFile(join(root, 'pulumi/custom.ts'), 'utf8')).toBe('host customization')
  await rm(join(root, 'pulumi'), { recursive: true })
  await symlink(join(root, 'vendor'), join(root, 'pulumi'))
  await expect(initializePreset(root)).rejects.toThrow('symlink')
})

test('selected npm modules require verified host tenants, load only verified entries and survive isolated artifact staging', async () => {
  const { loadRegisteredPlatformModules, stagePlatformPackages } = await import('./packages')
  const { root } = await project()
  for (const directory of ['node_modules/@example/plugins', 'vendor/corp-a']) {
    const file = join(root, directory, 'deployment.json'), inv = JSON.parse(await readFile(file, 'utf8'))
    const content = `export function createExtension({tenantIds}) { return { apiVersion: 1, id: ${JSON.stringify(inv.owner)}, tenantIds, lifecycle: ${JSON.stringify(inv.lifecycleBundle)}.map(id => ({id,version:'1.0.0',framework:${JSON.stringify('^' + FRAMEWORK_VERSION)},migrations:[]})) }; }`
    await writeFile(join(root, directory, 'runtime.js'), content)
    inv.assets[0].sha256 = createHash('sha256').update(content).digest('hex')
    await writeFile(file, JSON.stringify(inv))
  }
  await expect(loadRegisteredPlatformModules(root)).rejects.toThrow('verified tenant catalog')
  const loaded = await loadRegisteredPlatformModules(root, 'eaos.platform.json', { tenantIds: ['tenant-b'] })
  expect(loaded.find(p => p.registration.id === '@example/plugins')?.contribution.tenantIds).toEqual(['tenant-b'])
  expect(loaded.find(p => p.registration.id === 'corp-a')?.contribution.tenantIds).toEqual(['tenant-a'])
  const staged = join(root, 'staged')
  await stagePlatformPackages(root, staged)
  expect(await readFile(join(staged, 'node_modules/@example/plugins/runtime.js'), 'utf8')).toContain('createExtension')
  const isolated = await loadRegisteredPlatformModules(staged, 'eaos.platform.json', { tenantIds: ['tenant-b'] })
  expect(isolated).toHaveLength(2)
})
