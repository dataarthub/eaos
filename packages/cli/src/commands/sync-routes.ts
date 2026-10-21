import type { Command } from 'commander'
import { readFile, writeFile, mkdir, lstat, rename } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * Client catalog, output and verification controls resolved relative to process.cwd().
 * @see {@link syncRoutes} for the canonical usage example and runtime requirements.
 */
export interface SyncRoutesOptions { 
    /**
   * Relative explicit client catalog path; defaults to eaos.clients.json in process.cwd().
   */
  config?: string; 
    /**
   * Relative generated directory; defaults to the selected web/LINE frontend generated tree.
   */
  dest?: string; 
    /**
   * web by default, or line; other targets are rejected.
   */
  target?: string; 
    /**
   * Verify exact registry and ownership receipt without writing.
   */
  check?: boolean; 
    /**
   * Unsupported legacy request; true is rejected rather than deleting copied sources.
   */
  prune?: boolean }
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
async function confined(root: string, input: string) {
 const resolved = path.resolve(root, input), relative = path.relative(root, resolved)
 if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path must be inside the project')
 let current = root
 for (const segment of relative.split(path.sep)) {
  current = path.join(current, segment)
  try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink paths are not allowed') }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
 }
 return resolved
}
async function optional(file: string) { try { return await readFile(file, 'utf8') } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e } }
/**
 * Generate registered client route entries while protecting edited or unmanaged output.
 * @param options - config defaults to eaos.clients.json; target defaults to web, dest selects the generated directory, check verifies exact output and prune is rejected.
 * @returns Resolves without a value after equality verification or writing the route registry and receipt.
 * @throws Rejects invalid inventory, protected/stale outputs and filesystem errors.
 * @remarks Uses process.cwd() as the project root. Inspects declared client manifests and writes build-time composition only; generated routes do not grant runtime access.
 * @example
 * import { syncRoutes } from '@alneas/eaos-cli/commands/sync-routes'
 * await syncRoutes({ target: 'web', check: true })
 */
export async function syncRoutes(options: SyncRoutesOptions = {}) {
 const root = process.cwd(), target = options.target ?? 'web'
 if (target !== 'web' && target !== 'line') throw new Error('Supported client targets: web, line')
 if (options.prune) throw new Error('No source copies to prune; owned registries remove stale entries on synchronization')
 const configFile = await confined(root, options.config ?? 'eaos.clients.json')
 if (!configFile.endsWith('.json')) throw new Error('Client catalog must be JSON; executable backend manifests are not loaded')
 const config = JSON.parse(await readFile(configFile, 'utf8'))
 if (!Array.isArray(config.plugins)) throw new Error('plugins must be an explicit array')
 const routes: { id: string; pluginId: string; path: string; module: string; entry: string }[] = []
 const ids = new Set<string>(), paths = new Set<string>()
 for (const plugin of config.plugins) {
  if (typeof plugin.id !== 'string' || !slug.test(plugin.id) || ids.has(plugin.id)) throw new Error('Invalid or duplicate plugin id')
  ids.add(plugin.id)
  if (typeof plugin.package !== 'string' || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(plugin.package)) throw new Error('Invalid plugin package')
  const manifestFile = plugin.manifest === undefined
   ? createRequire(path.join(root, 'package.json')).resolve(`${plugin.package}/eaos.clients.json`)
   : await confined(root, plugin.manifest)
  await confined(root, manifestFile)
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  const parts = plugin.package.split('/'), packageName = parts.slice(0, plugin.package.startsWith('@') ? 2 : 1).join('/')
  const modulePath = plugin.package.slice(packageName.length)
  let directory = path.dirname(manifestFile), pkg: { name: string; exports?: Record<string, unknown> }
  while (true) {
   const metadata = await optional(await confined(root, path.join(directory, 'package.json')))
   if (metadata !== null) {
    pkg = JSON.parse(metadata)
    if (pkg.name !== packageName) throw new Error('Plugin package identity mismatch')
    break
   }
   const parent = path.dirname(directory)
   if (parent === directory || parent === root) throw new Error('Plugin package identity mismatch')
   directory = parent
  }
  const entries = manifest[target] ?? []
  if (!Array.isArray(entries)) throw new Error('Target routes must be an array')
  const routeIds = new Set<string>()
  for (const route of entries) {
   if (typeof route.id !== 'string' || !slug.test(route.id) || routeIds.has(route.id)) throw new Error('Invalid or duplicate route id')
   routeIds.add(route.id)
   if (typeof route.path !== 'string' || !(route.path === `/plugins/${plugin.id}` || route.path.startsWith(`/plugins/${plugin.id}/`)) || !/^\/[a-z0-9/-]+$/.test(route.path) || route.path.includes('//') || route.path.endsWith('/') || paths.has(route.path)) throw new Error('Invalid or conflicting client route')
   paths.add(route.path)
   if (typeof route.export !== 'string' || !/^\.\/client\/[a-z0-9/-]+$/.test(route.export) || !Object.hasOwn(pkg.exports ?? {}, '.' + modulePath + route.export.slice(1)) || pkg.exports['.' + modulePath + route.export.slice(1)] === null) throw new Error('Client entry must be an explicit package export')
   if (typeof route.module !== 'string' || !/^[a-z0-9_-]+$/.test(route.module)) throw new Error('A required module must be declared')
   routes.push({ id: route.id, pluginId: plugin.id, path: route.path, module: route.module, entry: plugin.package + route.export.slice(1) })
  }
 }
 routes.sort((a, b) => a.path.localeCompare(b.path))
 const contents = '// @generated by eaos sync:routes; edit plugin client manifests instead.\nexport const pluginRoutes = [\n' + routes.map(({entry,...route}) => `  { ...${JSON.stringify(route)}, load: () => import(${JSON.stringify(entry)}) },`).join('\n') + '\n]\n'
 const dest = await confined(root, options.dest ?? (target === 'web' ? 'apps/frontend/src/generated' : 'apps/line-mini/src/generated'))
 const output = await confined(root, path.join(dest, `plugin-routes.${target}.ts`))
 const receipt = await confined(root, path.join(dest, `.plugin-routes.${target}.json`))
 const existing = await optional(output), previous = await optional(receipt)
 if (existing !== null && (!previous || JSON.parse(previous).hash !== hash(existing))) throw new Error('Refusing to overwrite an unmanaged or edited client registry')
 const record = JSON.stringify({ target, hash: hash(contents) }, null, 2) + '\n'
 if (options.check) { if (existing !== contents || previous !== record) throw new Error('Client registry is out of date'); return }
 await mkdir(dest, { recursive: true })
 const temp = output + '.' + randomUUID() + '.tmp'
 await writeFile(temp, contents, { flag: 'wx' }); await rename(temp, output)
 await writeFile(receipt, record)
 console.log(`Synchronized ${routes.length} ${target} client routes`)
}


/**
 * Register client route synchronization commands on a supplied Commander command tree.
 * @param program - Commander command instance to mutate; its owning host controls argument parsing.
 * @returns No value; command definitions and handlers are attached to the supplied object.
 * @throws Commander configuration errors propagate.
 * @remarks Registration itself does not execute synchronization. Parsing sync:routes reads client manifests and may write the owned route registry/receipt; it does not execute infrastructure or deployment operations.
 * @example
 * import { registerClientCommands } from '@alneas/eaos-cli/commands/sync-routes'
 * import { Command } from 'commander'
 * const program = new Command('example')
 * registerClientCommands(program)
 */
export function registerClientCommands(program: Command): void {
 program.command('sync:routes')
  .description('Generate a client route registry from explicit package exports')
  .option('-c, --config <path>', 'Path to eaos.clients.json')
  .option('-d, --dest <path>', 'Generated registry directory')
  .option('--target <target>', 'Client target: web or line', 'web')
  .option('--check', 'Reject stale or edited generated registries', false)
  .option('--prune', 'Remove routes of disabled plugins', false)
  .action(async (options: SyncRoutesOptions) => { await syncRoutes(options) })
}
