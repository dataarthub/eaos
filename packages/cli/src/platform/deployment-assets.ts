import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateDeploymentPlugins, type DeploymentInventory, type DeploymentPlugin } from '@alneas/eaos-server/platform'

/**
 * Enumerate regular deployment-tree files in deterministic order while rejecting symbolic links.
 * @param directory - Built staging directory to inspect.
 * @param prefix - Optional relative traversal prefix, empty by default; caller owns its containment.
 * @returns Sorted relative file paths; Finder .DS_Store files are omitted.
 * @throws Rejects encountered symlinks and filesystem read errors.
 * @example
 * import { deploymentAssetPaths } from '@alneas/eaos-cli/platform/deployment-assets'
 * export function stagedFiles(directory: string) { return deploymentAssetPaths(directory) }
 */
export async function deploymentAssetPaths(directory: string, prefix = ''): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue // npm never ships Finder metadata.
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    assert(!entry.isSymbolicLink(), `Symlink in deployment assets: ${name}`)
    if (entry.isDirectory()) files.push(...await deploymentAssetPaths(directory, name))
    else if (entry.isFile()) files.push(name)
  }
  return files.sort()
}

/**
 * Resolve declared asset selectors against the packaged path list.
 * @param plugin - Deployment plugin declaration whose selectors are resolved.
 * @param paths - Trusted relative package file paths.
 * @param mapPattern - Optional selector mapper; defaults to preserving each pattern.
 * @returns Copied plugin metadata with sorted concrete assets and single-file runtime entries where appropriate.
 * @throws If a declared asset selector matches no packaged path; mapper errors propagate.
 * @remarks Does not read files or verify hashes; use verified staging paths and inventory checks separately.
 * @example
 * import { resolveDeploymentPlugin } from '@alneas/eaos-cli/platform/deployment-assets'
 * export function resolveAssets(plugin: Parameters<typeof resolveDeploymentPlugin>[0], paths: string[]) { return resolveDeploymentPlugin(plugin, paths) }
 */
export function resolveDeploymentPlugin(plugin: DeploymentPlugin, paths: string[], mapPattern: (pattern: string) => string = value => value): DeploymentPlugin {
  return { ...plugin, components: plugin.components.map(component => {
    const { assetPatterns, ...resolved } = component
    if (!assetPatterns) return resolved
    const matches = new Set<string>()
    for (const pattern of assetPatterns) {
      const glob = new Bun.Glob(mapPattern(pattern)), found = paths.filter(path => glob.match(path))
      assert(found.length, `Missing packaged deployment assets: ${plugin.id}/${pattern}`)
      found.forEach(path => matches.add(path))
    }
    const assets = [...matches].sort()
    return { ...resolved, assets, ...(['api', 'mcp', 'frontend', 'service'].includes(component.kind) && assets.length === 1 ? { entry: assets[0] } : {}) }
  }) }
}
/**
 * Hash staging files and write a validated, bounded deployment inventory.
 * @param root - Isolated built package staging root.
 * @param inventory - Mutable inventory object; its assets list is replaced with computed hashes.
 * @param paths - Relative files to hash; deployment.json itself is excluded.
 * @returns The validated inventory after writing deployment.json.
 * @throws Rejects nonfiles, malformed plugin metadata, inventories over 1 MiB and filesystem failures.
 * @remarks Mutates inventory.assets and writes staging metadata; the caller must provide contained paths, not arbitrary user input.
 * @example
 * import { writeInventory } from '@alneas/eaos-cli/platform/deployment-assets'
 * export function writeStagedInventory(root: string, inventory: Parameters<typeof writeInventory>[1], paths: string[]) { return writeInventory(root, inventory, paths) }
 */
export async function writeInventory(root: string, inventory: DeploymentInventory, paths: string[]) {
  inventory.assets = await Promise.all(paths.filter(path => path !== 'deployment.json').map(async path => {
    assert((await lstat(join(root, path))).isFile(), `Not a deployment asset: ${path}`)
    return { path, sha256: createHash('sha256').update(await readFile(join(root, path))).digest('hex') }
  }))
  validateDeploymentPlugins(inventory)
  const content = JSON.stringify(inventory) + '\n'
  assert(Buffer.byteLength(content) <= 1024 * 1024, 'Deployment inventory exceeds the public 1 MiB limit')
  await writeFile(join(root, 'deployment.json'), content)
  return inventory
}


/**
 * Finalize deployment assets and exact hashes in an isolated built plugin package before packing.
 * @param root - Staging directory containing canonical package.json, deployment.json and built dist/runtime.js.
 * @returns The verified deployment inventory written into the staging directory.
 * @throws Rejects owner/version mismatches, missing lifecycle/runtime/assets, symlinks and inventory or filesystem failures.
 * @remarks Writes deployment.json. Do not pass a released immutable artifact or live host directory; this does not deploy or enable a tenant.
 * @example
 * import { preparePluginDeployment } from '@alneas/eaos-cli/platform/deployment-assets'
 * export function finalizeStaging(directory: string) { return preparePluginDeployment(directory) }
 */
export async function preparePluginDeployment(root: string): Promise<DeploymentInventory> {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const declaration = JSON.parse(await readFile(join(root, 'deployment.json'), 'utf8')) as DeploymentInventory
  assert(declaration.owner === pkg.name && declaration.version === pkg.version, 'Deployment release differs')
  const plugins = validateDeploymentPlugins(declaration)
  assert(plugins?.length && declaration.lifecycleBundle?.length === plugins.length, 'Missing plugin lifecycle bundle')
  const paths: string[] = []
  for (const name of pkg.files as string[]) {
    const path = join(root, name), info = await lstat(path)
    assert(!info.isSymbolicLink(), 'Symlink in package files')
    if (info.isDirectory()) paths.push(...(await deploymentAssetPaths(path)).map(file => name + '/' + file))
    else paths.push(name)
  }
  paths.push('package.json')
  assert(paths.includes('dist/runtime.js'), 'Missing public runtime entry')
  return writeInventory(root, { ...declaration, runtime: 'dist/runtime.js', plugins: plugins.map(plugin => resolveDeploymentPlugin(plugin, paths)) }, [...new Set(paths)].sort())
}
/**
 * Finalize independent module inventories in a built plugin collection.
 * @param root - Collection staging root containing package.json, catalog.json, module declarations and dist/<id> outputs.
 * @returns Inventories in catalog order, each written to dist/<id>/deployment.json with hashes relative to that module.
 * @throws Rejects malformed catalogs, owner/version mismatches, missing runtimes, symlinks and invalid deployment metadata.
 * @remarks Reads declarative metadata and compiled bytes without importing runtime code or enabling tenants. Only use mutable staging trees.
 * @example
 * import { preparePluginCollection } from '@alneas/eaos-cli/platform/deployment-assets'
 * export function finalizeCollection(directory: string) { return preparePluginCollection(directory) }
 */
export async function preparePluginCollection(root: string): Promise<DeploymentInventory[]> {
  const regular = async (parts: string[], directory = false) => {
    let cursor = root
    for (const part of parts) {
      cursor = join(cursor, part)
      assert(!(await lstat(cursor)).isSymbolicLink(), 'Symlink in plugin collection')
    }
    const info = await lstat(cursor)
    assert(directory ? info.isDirectory() : info.isFile(), 'Invalid plugin collection file')
    return cursor
  }
  const pkg = JSON.parse(await readFile(await regular(['package.json']), 'utf8'))
  const catalog = JSON.parse(await readFile(await regular(['catalog.json']), 'utf8'))
  assert(typeof pkg.name === 'string' && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(pkg.name) && typeof pkg.version === 'string', 'Invalid collection package')
  assert(catalog?.apiVersion === 1 && Array.isArray(catalog.plugins) && catalog.plugins.length && new Set(catalog.plugins).size === catalog.plugins.length && catalog.plugins.every((id: unknown) => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(id)), 'Invalid plugin collection catalog')
  const inventories: DeploymentInventory[] = []
  for (const id of catalog.plugins as string[]) {
    const declaration = JSON.parse(await readFile(await regular([id, 'deployment.json']), 'utf8')) as DeploymentInventory
    assert(declaration.owner === `${pkg.name}/${id}` && declaration.version === pkg.version, 'Deployment release differs')
    const plugins = validateDeploymentPlugins(declaration)
    assert(plugins?.length && declaration.lifecycleBundle?.length === plugins.length, 'Missing plugin lifecycle bundle')
    const output = await regular(['dist', id], true)
    const paths = (await deploymentAssetPaths(output)).filter(path => path !== 'deployment.json')
    assert(paths.includes('src/runtime.js'), 'Missing public runtime entry')
    inventories.push(await writeInventory(output, { ...declaration, runtime: 'src/runtime.js', plugins: plugins.map(plugin => resolveDeploymentPlugin(plugin, paths)) }, paths))
  }
  return inventories
}
if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd()
  if (await Bun.file(join(root, 'catalog.json')).exists()) await preparePluginCollection(root)
  else await preparePluginDeployment(root)
}
