import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { createDeploymentPlan } from './deployment-plan'
import { safePath, readJson } from './files'

interface FrontendPackage { id: string; pluginId: string; inventory: string }
interface FrontendInventory {
  owner: string
  runtime: string
  assets: { path: string; sha256: string }[]
  frontend: { pluginId: string; routes: { path: string; component: string }[] }
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/

async function optionalCatalog(root: string, config: string): Promise<{ packages: FrontendPackage[] }> {
  const file = await safePath(root, config)
  try { await lstat(file) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { packages: [] }
    throw error
  }
  const data = (await readJson(file)).data
  const catalog = data as { packages?: FrontendPackage[] }
  if (!catalog || !Array.isArray(catalog.packages) || catalog.packages.some(item => !item || typeof item.id !== 'string' || !item.id.trim() || typeof item.pluginId !== 'string' || !item.pluginId.trim() || typeof item.inventory !== 'string')) throw Error('Invalid frontend catalog')
  for (const item of catalog.packages) await safePath(root, item.inventory)
  return { packages: catalog.packages }
}

async function withLock<T>(root: string, work: () => Promise<T>) {
  const file = await safePath(root, '.eaos/frontend-register.lock')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, 'frontend operation\n', { flag: 'wx' })
  try { return await work() } finally { await rm(file) }
}

async function atomicWrite(file: string, contents: string) {
  await mkdir(dirname(file), { recursive: true })
  const temporary = file + '.new-' + randomUUID()
  try { await writeFile(temporary, contents, { flag: 'wx' }); await rename(temporary, file) }
  finally { await rm(temporary, { force: true }) }
}

function exportedNames(contents: string) {
  const source = ts.createSourceFile('contribution.js', contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const names = new Set<string>()
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const entry of node.exportClause.elements) names.add(entry.name.text)
    }
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    if (!modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (modifiers.some(item => item.kind === ts.SyntaxKind.DefaultKeyword)) names.add('default')
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) { if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text) }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) names.add(node.name.text)
  }
  return names
}

async function inspectInventory(file: string): Promise<FrontendInventory> {
  await createDeploymentPlan([file])
  const inventory = (await readJson(file)).data as FrontendInventory
  if (inventory.runtime !== 'index.js' || !inventory.frontend || typeof inventory.frontend.pluginId !== 'string' || !inventory.frontend.pluginId.trim() || !Array.isArray(inventory.frontend.routes) || inventory.frontend.routes.length > 1000) throw Error('Invalid frontend artifact contract')
  const runtime = await safePath(dirname(file), inventory.runtime)
  const names = exportedNames(await readFile(runtime, 'utf8'))
  for (const route of inventory.frontend.routes) {
    if (!route || typeof route.path !== 'string' || !/^\/[A-Za-z0-9/_-]*$/.test(route.path) || route.path.includes('//') || !identifier.test(route.component)) throw Error('Invalid frontend route')
    if (!names.has(route.component)) throw Error(`Missing frontend component export: ${route.component}`)
  }
  return inventory
}

async function inspectSelection(root: string, packages: FrontendPackage[], reservedRoutes: readonly string[] = []) {
  const ids = new Set<string>(), plugins = new Set<string>(), routes = new Set<string>(reservedRoutes)
  const selected: { registration: FrontendPackage; inventory: FrontendInventory; file: string }[] = []
  for (const registration of packages) {
    if (ids.has(registration.id) || plugins.has(registration.pluginId)) throw Error('Duplicate frontend package or plugin identity')
    ids.add(registration.id); plugins.add(registration.pluginId)
    const file = await safePath(root, registration.inventory), inventory = await inspectInventory(file)
    if (registration.id !== inventory.owner || registration.pluginId !== inventory.frontend.pluginId) throw Error('Frontend artifact identity mismatch')
    for (const route of inventory.frontend.routes) {
      if (routes.has(route.path)) throw Error(`Conflicting or reserved frontend route: ${route.path}`)
      routes.add(route.path)
    }
    selected.push({ registration, inventory, file })
  }
  return selected
}

/**
 * Acquire a verified immutable frontend contribution and update its selected catalog.
 * @param root - Trusted application project root.
 * @param inventoryPath - Explicit built artifact inventory path, absolute or relative to root.
 * @param options - Optional catalog path; defaults to frontend.packages.json within root.
 * @returns Package identity and inventory digest; acquisition never activates features.
 * @throws For unsafe paths, changed checksums, missing exports, malformed catalogs, conflicting selection or concurrent operations.
 * @remarks Does not execute contribution code, deploy or change tenant admission. Failed selection leaves the previous catalog intact; unselected immutable artifacts may be retained.
 * @example
 * import { acquireFrontendArtifact } from '@alneas/eaos-cli/platform'
 * export const acquire = (root: string, inventory: string) => acquireFrontendArtifact(root, inventory)
 */
export async function acquireFrontendArtifact(root: string, inventoryPath: string, options: {
  /** Project-relative selected catalog; defaults to frontend.packages.json. */
  config?: string
} = {}) {
  root = resolve(root)
  const source = resolve(root, inventoryPath), inventory = await inspectInventory(source)
  const bytes = await readFile(source), digest = hash(bytes), destination = '.eaos/frontend/' + digest
  const config = options.config ?? 'frontend.packages.json'
  return withLock(root, async () => {
    const previous = await optionalCatalog(root, config)
    const folder = await safePath(root, destination)
    await mkdir(dirname(folder), { recursive: true })
    let present = false
    try { present = (await lstat(folder)).isDirectory() } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (!present) {
      const stage = await mkdtemp(join(dirname(folder), '.stage-'))
      try {
        for (const asset of inventory.assets) {
          const data = await readFile(await safePath(dirname(source), asset.path))
          if (hash(data) !== asset.sha256) throw Error('Frontend asset changed during acquisition')
          const target = await safePath(stage, asset.path)
          await mkdir(dirname(target), { recursive: true }); await writeFile(target, data, { flag: 'wx' })
        }
        await writeFile(join(stage, 'deployment.json'), bytes, { flag: 'wx' })
        await inspectInventory(join(stage, 'deployment.json'))
        await rename(stage, folder)
      } finally { await rm(stage, { recursive: true, force: true }) }
    }
    if (hash(await readFile(join(folder, 'deployment.json'))) !== digest) throw Error('Immutable frontend inventory differs')
    const packages = [...previous.packages.filter(item => item.id !== inventory.owner), { id: inventory.owner, pluginId: inventory.frontend.pluginId, inventory: destination + '/deployment.json' }]
    await inspectSelection(root, packages)
    await atomicWrite(await safePath(root, config), JSON.stringify({ packages }, null, 2) + '\n')
    return { acquired: inventory.owner, digest, verified: true as const, activated: false as const }
  })
}

/** Host-selected frontend catalog and generated namespace module destination.
 * @see stageFrontendArtifacts
 */
export interface StageFrontendOptions {
  /** Existing project-relative catalog; defaults to frontend.packages.json. */
  config?: string
  /** Project-relative generated module, outside acquired immutable artifact storage. */
  output: string
  /** Exact host-owned routes unavailable to contributed pages. */
  reservedRoutes: readonly string[]
}

/**
 * Generate verified privateNavigation/privatePages imports from selected artifacts.
 * @param root - Trusted application root.
 * @param options - Catalog, output module and host-owned reserved route selection.
 * @returns Selected plugin IDs and exact contributed routes in catalog order.
 * @throws For invalid selection, exports, checksums, paths or concurrent operations.
 * @remarks Validates every contribution before atomically replacing output. Never executes contributed modules, activates features or grants API permission.
 * @example
 * import { stageFrontendArtifacts } from '@alneas/eaos-cli/platform'
 * export const stage = (root: string) => stageFrontendArtifacts(root, { output: 'web/private.js', reservedRoutes: ['/'] })
 */
export async function stageFrontendArtifacts(root: string, options: StageFrontendOptions) {
  root = resolve(root)
  const output = await safePath(root, options.output)
  const storage = resolve(root, '.eaos/frontend')
  if (output === storage || output.startsWith(storage + '/')) throw Error('Generated output cannot replace an immutable artifact')
  if (output === await safePath(root, options.config ?? 'frontend.packages.json')) throw Error('Generated output cannot replace the frontend catalog')
  return withLock(root, async () => {
    const catalog = await optionalCatalog(root, options.config ?? 'frontend.packages.json')
    const selected = await inspectSelection(root, catalog.packages, options.reservedRoutes)
    if (selected.some(item => item.file === output || item.inventory.assets.some(asset => resolve(dirname(item.file), asset.path) === output))) throw Error('Generated output cannot replace a selected artifact')
    const imports: string[] = [], navigation: string[] = [], pages: string[] = [], routes: string[] = []
    for (const [index, item] of selected.entries()) {
      const module = await safePath(dirname(item.file), item.inventory.runtime)
      const specifier = relative(dirname(output), module).replaceAll('\\', '/')
      imports.push(`import * as contribution${index} from ${JSON.stringify(specifier.startsWith('.') ? specifier : './' + specifier)}`)
      navigation.push(`{pluginId:${JSON.stringify(item.registration.pluginId)},navigation:contribution${index}.webNavigation}`)
      for (const route of item.inventory.frontend.routes) {
        routes.push(route.path)
        pages.push(`{path:${JSON.stringify(route.path)},pluginId:${JSON.stringify(item.registration.pluginId)},component:contribution${index}.${route.component}}`)
      }
    }
    await atomicWrite(output, imports.join('\n') + '\nexport const privateNavigation=[' + navigation.join(',') + ']\nexport const privatePages=[' + pages.join(',') + ']\n')
    return { pluginIds: selected.map(item => item.registration.pluginId), routes }
  })
}
