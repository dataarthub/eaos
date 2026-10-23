import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateFeatureRegistrations, selectClientBindings, type OfficialFeatureDescriptor } from './feature-registrations'

const descriptor = (id: string): OfficialFeatureDescriptor => ({ id, version: '1.0.0', manifest: `@example/features/${id}/manifest`, server: `@example/features/${id}/server`, lifecycle: { entry: `@example/features/${id}/server`, exportName: 'lifecycle' }, clients: [{ target: 'web', entry: `@example/features/${id}/client`, exportName: 'default', path: '/plugins/' + id }] })

test('selected metadata separates browser data from server imports and check mode never repairs drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eaos-feature-registrations-'))
  try {
    const options = { descriptors: [descriptor('one'), descriptor('two')], selectedIds: ['one'], outputs: { manifests: 'generated/manifests.ts', lifecycle: 'generated/lifecycle.ts', web: 'generated/web.ts' } }
    await generateFeatureRegistrations(root, options)
    const web = await readFile(join(root, options.outputs.web), 'utf8')
    expect(web).toContain('"one"')
    expect(web).not.toContain('two')
    expect(web).not.toContain('/server')
    expect(web).not.toContain('/manifest')
    const file = join(root, options.outputs.lifecycle)
    await writeFile(file, 'changed')
    await expect(generateFeatureRegistrations(root, { ...options, check: true })).rejects.toThrow('Stale')
    expect(await readFile(file, 'utf8')).toBe('changed')
    await expect(generateFeatureRegistrations(root, { ...options, selectedIds: ['unknown'] })).rejects.toThrow('Unknown')
    await expect(generateFeatureRegistrations(root, { ...options, selectedIds: ['one', 'one'] })).rejects.toThrow('Duplicate')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('client adapter selection eliminates unselected imports and unreachable feature wrappers', () => {
  const source = `import One from '@example/one/client'; import Two from '@example/two/client';
function one(){ return One() } function two(){return Two()}
export const pages=[{pluginId:'one',component:one},{pluginId:'two',component:two}];`
  const selected = selectClientBindings(source, ['one'])
  expect(selected).toContain('@example/one/client')
  expect(selected).not.toContain('@example/two/client')
  expect(selected).not.toContain('function two')
})

test('client reachability includes local named and default export references', () => {
  for (const ending of ['export { pages };', 'export { pages as default };', 'export default pages;']) {
    const selected = selectClientBindings(`import One from '@example/one/client'; import Two from '@example/two/client'; const pages=[{pluginId:'one',component:One},{pluginId:'two',component:Two}]; ${ending}`, ['one'])
    expect(selected).toContain('const pages')
    expect(selected).toContain('@example/one/client')
    expect(selected).not.toContain('@example/two/client')
  }
})

test('invalid feature contracts and missing dependency adoption fail before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eaos-feature-invalid-'))
  try {
    const outputs = { manifests: 'manifests.ts', lifecycle: 'lifecycle.ts', web: 'web.ts' }
    for (const invalid of [
      { ...descriptor('one'), version: 'invalid' },
      { ...descriptor('one'), lifecycle: undefined },
      { ...descriptor('one'), clients: [{ target: 'web', entry: '@example/one/server', exportName: 'default', path: '/one' }] },
      { ...descriptor('one'), dependencies: ['two'] },
    ]) await expect(generateFeatureRegistrations(root, { descriptors: [invalid], selectedIds: ['one'], outputs })).rejects.toThrow()
    await expect(readFile(join(root, outputs.manifests))).rejects.toThrow()
    await expect(generateFeatureRegistrations(root, { descriptors: [descriptor('one'), descriptor('one')], selectedIds: ['one'], outputs })).rejects.toThrow('Duplicate')
  } finally { await rm(root, { recursive: true, force: true }) }
})
