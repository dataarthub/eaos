import { pathToFileURL } from 'node:url'
import type { PlatformContribution } from '@alneas/eaos-server/platform'
import { createHash } from 'node:crypto'
import { lstat, readdir, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, relative } from 'node:path'
import type { LifecycleStore } from '@alneas/eaos-server/lifecycle-engine'
import { validatePlatformPackages, resolvePlatformDatabaseTarget, platformDatabaseTargets, type PlatformRuntimeConfig, type DeploymentInventory, type PlatformPackage } from '@alneas/eaos-server/platform'
import { safePath, readJson } from './index'
import { resolveManifest } from './render'
import { resolveProjectManifest } from './preset'
import { createDeploymentPlan } from './deployment-plan'

/**
 * Derive a lifecycle-safe package bundle identifier from the exact package identity bytes.
 * @param packageId - Nonblank package identity, including an optional npm scope; nonblank input is not trimmed before hashing.
 * @returns package- followed by the SHA-256 hexadecimal digest.
 * @throws If the package identity is blank.
 * @example
 * import { platformPackageBundleId } from '@alneas/eaos-cli/platform'
 * const bundleId = platformPackageBundleId('@example/notes')
 */
export function platformPackageBundleId(packageId: string): string {
  if (!packageId.trim()) throw new Error('Package identity is required')
  return 'package-' + createHash('sha256').update(packageId).digest('hex')
}

/**
 * Read registered package metadata from the application manifest.
 * @param root - Trusted application root.
 * @param config - Workspace-relative manifest path; defaults to eaos.platform.json.
 * @returns The resolved application package registrations.
 * @throws Rejects invalid manifest paths, declarations or package metadata; filesystem errors propagate.
 * @remarks Reads and resolves metadata without importing runtime factories or activating plugins.
 * @example
 * import { readPlatformPackages } from '@alneas/eaos-cli/platform'
 * export function readHost(root: string) { return readPlatformPackages(root) }
 */
export async function readPlatformPackages(root: string, config = 'eaos.platform.json'): Promise<PlatformPackage[]> {
  const { data } = await readJson(await safePath(root, config))
  return (await resolveProjectManifest(root, data)).resolved.packages
}
/**
 * Verify package registrations against inventory assets and optional runtime database targets.
 * @param root - Application workspace root.
 * @param packages - Explicit package registrations to verify.
 * @param runtime - Optional runtime catalog for tenant-to-database checks.
 * @returns The verified deployment plan with each contribution annotated by tenant database targets.
 * @throws Rejects invalid registrations, runtime/lifecycle mismatches, hash failures or inconsistent database targets.
 * @remarks Does not execute registered modules or migrate a database.
 * @example
 * import { verifyPlatformPackages } from '@alneas/eaos-cli/platform'
 * export function verifyHost(root: string, packages: Parameters<typeof verifyPlatformPackages>[1]) { return verifyPlatformPackages(root, packages) }
 */
export async function verifyPlatformPackages(root: string, packages: PlatformPackage[], runtime?: PlatformRuntimeConfig) {
  validatePlatformPackages(packages)
  const paths: string[] = []
  for (const entry of packages) {
    const path = await safePath(root, entry.inventory)
    const { data } = await readJson(path)
    const inventory = data as DeploymentInventory
    if (inventory.owner !== entry.id || !inventory.runtime || !inventory.lifecycleBundle
      || JSON.stringify([...inventory.lifecycleBundle].sort()) !== JSON.stringify([...entry.pluginIds].sort())
      || resolve(dirname(path), inventory.runtime) !== await safePath(root, entry.module)) throw new Error('Package registration does not match its deployment inventory')
    paths.push(path)
  }
  const plan = await createDeploymentPlan(paths)
  return { ...plan, databaseTargets: runtime ? platformDatabaseTargets(runtime) : [], contributions: plan.contributions.map(contribution => {
    const entry = packages.find(p => p.id === contribution.owner)!
    const tenantDatabases = runtime ? entry.tenantIds.map(tenantId => ({ tenantId, targetId: resolvePlatformDatabaseTarget(runtime, tenantId).id, databaseId: resolvePlatformDatabaseTarget(runtime, tenantId).databaseId })) : []
    return { ...contribution, tenantDatabases }
  }) }

}
/**
 * Import verified trusted package factories and validate their returned platform contributions.
 * @param root - Application root containing installed or acquired artifacts.
 * @param config - Workspace-relative manifest path; defaults to eaos.platform.json.
 * @param options - Host-verified tenantIds for npm modules and in-memory bindings keyed by package identity.
 * @returns Loaded registration/contribution pairs in registration order.
 * @throws Rejects missing verified tenants, inventory mismatch, missing createExtension, invalid factory contributions or propagated import/factory errors.
 * @remarks Executes trusted module top-level code and createExtension. Hosts own authorization and durable bindings; loading is not a tenant activation operation.
 * @example
 * import { loadRegisteredPlatformModules } from '@alneas/eaos-cli/platform'
 * export function loadHost(root: string, tenantIds: string[], bindings: Record<string, unknown>) { return loadRegisteredPlatformModules(root, 'eaos.platform.json', { tenantIds, bindings }) }
 */
export async function loadRegisteredPlatformModules(root: string, config = 'eaos.platform.json', options: { 
/**
 * Verified concrete tenant catalog required for selected npm modules; no wildcard/default scope is inferred.
 */
tenantIds?: string[]; 
/**
 * In-memory live host bindings keyed by package identity and passed to its createExtension factory; not written to registration metadata.
 */
bindings?: Record<string, unknown> } = {}): Promise<Array<{ 
/**
 * Verified package/module registration and its explicit tenant/plugin/settings scope used for loading.
 */
registration: PlatformPackage; 
/**
 * Trusted factory contribution validated to match registration identity, tenant catalog and lifecycle plugin IDs.
 */
contribution: PlatformContribution }>> {
  root = resolve(root)
  const project = await resolveProjectManifest(root, (await readJson(await safePath(root, config))).data)
  if (project.npmArtifacts.length && !options.tenantIds?.length) throw new Error('Selected npm modules require the host verified tenant catalog; no wildcard tenant is inferred')
  const registrations = [...project.resolved.packages, ...project.npmArtifacts.map(entry => ({ ...entry, tenantIds: options.tenantIds! }))]
  await verifyPlatformPackages(root, registrations, await readPlatformRuntime(root, config))
  const loaded: Array<{ registration: PlatformPackage; contribution: PlatformContribution }> = []
  for (const registration of registrations) {
    const module = await import(pathToFileURL(await safePath(root, registration.module)).href)
    if (typeof module.createExtension !== 'function') throw new Error('Registered package must export createExtension')
    const contribution = await module.createExtension({ tenantIds: [...registration.tenantIds], settings: registration.settings ?? {}, bindings: options.bindings?.[registration.id] }) as PlatformContribution
    if (!contribution || contribution.apiVersion !== 1 || contribution.id !== registration.id
      || JSON.stringify(contribution.tenantIds) !== JSON.stringify(registration.tenantIds)
      || JSON.stringify((contribution.lifecycle ?? []).map(p => p.id).sort()) !== JSON.stringify([...registration.pluginIds].sort())) throw new Error('Runtime contribution does not match registration')
    loaded.push({ registration, contribution })
  }
  return loaded
}
/**
 * Read runtime placement configuration from the application manifest.
 * @param root - Trusted application root.
 * @param config - Workspace-relative manifest path; defaults to eaos.platform.json.
 * @returns The resolved optional runtime configuration.
 * @throws Rejects invalid manifest paths, declarations or package metadata; filesystem errors propagate.
 * @remarks Reads and resolves metadata without importing runtime factories or activating plugins.
 * @example
 * import { readPlatformRuntime } from '@alneas/eaos-cli/platform'
 * export function readHost(root: string) { return readPlatformRuntime(root) }
 */
export async function readPlatformRuntime(root: string, config = 'eaos.platform.json') {
  const { data } = await readJson(await safePath(root, config))
  return (await resolveProjectManifest(root, data)).resolved.runtime
}
async function update<T>(root: string, config: string, action: (manifest: Record<string, unknown>, file: string) => Promise<T>) {
  const file = await safePath(root, config), lock = await safePath(root, '.eaos/package-register.lock')
  await mkdir(dirname(lock), { recursive: true })
  await writeFile(lock, 'package registration lock\n', { flag: 'wx' })
  try {
    const { data } = await readJson(file)
    resolveManifest(data)
    return await action(data as Record<string, unknown>, file)
  } finally { await rm(lock) }
}
async function save(file: string, manifest: Record<string, unknown>) {
  const temp = file + '.new'
  await writeFile(temp, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  await rename(temp, file)
}
/**
 * Acquire verified artifact bytes and atomically register code without executing package factories.
 * @param root - Application workspace root.
 * @param options - Already built/downloaded directory, explicit tenantIds, optional settings and manifest path.
 * @returns The registration, verified asset count, activated=false and restartRequired=true.
 * @throws Rejects invalid hashes, duplicate package identities, mismatched retained assets, registration locks or filesystem failures.
 * @remarks Writes immutable retained files and the application manifest under a registration lock. Partial acquisition may remain after failure; no database application or tenant activation occurs.
 * @example
 * import { registerPlatformPackage } from '@alneas/eaos-cli/platform'
 * export function acquireReviewed(root: string, directory: string, tenantIds: string[]) { return registerPlatformPackage(root, { directory, tenantIds }) }
 */
export async function registerPlatformPackage(root: string, options: { 
/**
 * Already built/downloaded artifact directory containing deployment.json and its checksummed assets; resolved against the process working directory.
 */
directory: string; 
/**
 * Explicit nonempty verified concrete tenant catalog to register for this package; registration never activates these tenants.
 */
tenantIds: string[]; 
/**
 * Optional nonsecret settings object retained in the package registration; actual durable/authentication bindings stay host-owned.
 */
settings?: Record<string, unknown>; 
/**
 * Workspace-relative application manifest to update under the registration lock; defaults to eaos.platform.json.
 */
config?: string }) {
  root = resolve(root)
  const source = resolve(options.directory), inventoryPath = join(source, 'deployment.json')
  await createDeploymentPlan([inventoryPath])
  const bytes = await readFile(inventoryPath), inventory = JSON.parse(bytes.toString()) as DeploymentInventory
  if (!inventory.runtime || !inventory.lifecycleBundle?.length) throw new Error('Package requires a runtime and lifecycle bundle')
  const digest = createHash('sha256').update(bytes).digest('hex')
  return update(root, options.config ?? 'eaos.platform.json', async (manifest, file) => {
    const packages = validatePlatformPackages(manifest.packages)
    if (packages.some(p => p.id === inventory.owner)) throw new Error('Package already registered; uninstall before replacing its release')
    const targetRelative = `.eaos/packages/${digest}`, target = await safePath(root, targetRelative)
    const entry: PlatformPackage = { id: inventory.owner, inventory: `${targetRelative}/deployment.json`, module: `${targetRelative}/${inventory.runtime}`, tenantIds: options.tenantIds, pluginIds: inventory.lifecycleBundle!, settings: options.settings }
    validatePlatformPackages([...packages, entry])
    resolveManifest({ ...manifest, packages: [...packages, entry] })
    // Immutable retained artifacts may already exist after an earlier unregister.
    try { await readJson(await safePath(root, entry.inventory)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !String(error).includes('expected a regular JSON')) throw error
      await mkdir(target, { recursive: true })
      // Write verified bytes, never follow source/destination symlinks or copy a whole checkout.
      for (const asset of inventory.assets) {
        const bytes = await readFile(await safePath(source, asset.path))
        if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Artifact changed during acquisition', { cause: error })
        const destination = await safePath(root, `${targetRelative}/${asset.path}`)
        await mkdir(dirname(destination), { recursive: true })
        try {
          const present = await lstat(destination)
          if (!present.isFile() || present.isSymbolicLink() || createHash('sha256').update(await readFile(destination)).digest('hex') !== asset.sha256) throw new Error('Retained package asset differs from the verified artifact', { cause: error })
        } catch (copyError) {
          if ((copyError as NodeJS.ErrnoException).code !== 'ENOENT') throw copyError
          await writeFile(destination, bytes, { flag: 'wx' })
        }
      }
      await writeFile(await safePath(root, entry.inventory), bytes, { flag: 'wx' })
    }
    const plan = await verifyPlatformPackages(root, [...packages, entry])
    manifest.packages = [...packages, entry]
    await save(file, manifest)
    return { entry, verifiedAssets: plan.contributions.at(-1)!.verifiedAssets, activated: false, restartRequired: true }
  })
}
/**
 * Remove a package code registration only after every owned plugin is uninstalled and disabled.
 * @param root - Application workspace root.
 * @param id - Exact registered package identity.
 * @param store - Shared Lifecycle store used to inspect installations/activations under its writer lock.
 * @param config - Workspace-relative manifest path; defaults to eaos.platform.json.
 * @returns Removed identity and flags confirming retained artifacts/database plus restartRequired.
 * @throws Rejects missing registrations, remaining installations/enabled activations, lock contention or store/filesystem failures.
 * @remarks Retains database records, lifecycle history and artifact files. Do not infer deletion from code unregistration.
 * @example
 * import { unregisterPlatformPackage } from '@alneas/eaos-cli/platform'
 * export function unregisterReviewed(root: string, id: string, store: Parameters<typeof unregisterPlatformPackage>[2]) { return unregisterPlatformPackage(root, id, store) }
 */
export async function unregisterPlatformPackage(root: string, id: string, store: LifecycleStore, config = 'eaos.platform.json') {
  return update(resolve(root), config, async (manifest, file) => store.withLock(async writer => {
    const packages = validatePlatformPackages(manifest.packages), entry = packages.find(p => p.id === id)
    if (!entry) throw new Error('Package not registered')
    const state = await writer.read(), owns = (id: string) => entry.pluginIds.includes(id)
    if (Object.values(state.installations).some(i => owns(i.release.id)) || Object.values(state.activations).some(a => owns(a.pluginId) && a.enabled)) throw new Error('Uninstall the package plugins from every backend/tenant before unregistering code')
    manifest.packages = packages.filter(p => p.id !== id)
    await save(file, manifest)
    return { id, retainedArtifacts: true, retainedDatabase: true, restartRequired: true }
  }))
}

// Preserve conditional exports only when every concrete target belongs to this
// module's verified inventory. Do not expose neighboring modules or source files.
function verifiedStagedExport(value: unknown, paths: Set<string>): boolean {
  if (typeof value === 'string') {
    if (!value.startsWith('./') || /[\\%?#*\x00-\x20]/.test(value) || value.slice(2).split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === 'node_modules')) throw new Error('Invalid staged package export target')
    return paths.has(value)
  }
  if (value === null) return false
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length || Object.keys(value).some(key => !key || key.startsWith('.') || /^[0-9]+$/.test(key))) throw new Error('Invalid staged package export conditions')
  const verified = Object.values(value).map(target => verifiedStagedExport(target, paths))
  return verified.every(Boolean)
}

/**
 * Copy only registered, checksum-verified assets into a fresh image staging tree.
 * @param root - Trusted application root.
 * @param directory - Separate empty staging destination.
 * @param config - Workspace-relative manifest path; defaults to eaos.platform.json.
 * @returns The staging directory, copied package count and activated=false.
 * @throws Rejects reused destinations, changed hashes, invalid paths/registrations or filesystem errors.
 * @remarks Uses exclusive file creation and does not execute package modules; a failed staging attempt may leave partial files for inspection.
 * @example
 * import { stagePlatformPackages } from '@alneas/eaos-cli/platform'
 * export function stageImage(root: string, directory: string) { return stagePlatformPackages(root, directory) }
 */
export async function stagePlatformPackages(root: string, directory: string, config = 'eaos.platform.json') {
  root = resolve(root)
  const destination = resolve(directory)
  if (destination === root) throw new Error('Package staging must use a separate empty directory')
  try {
    const info = await lstat(destination)
    if (!info.isDirectory() || info.isSymbolicLink() || (await readdir(destination)).length) throw new Error('Package staging requires a new or empty directory')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const project = await resolveProjectManifest(root, (await readJson(await safePath(root, config))).data)
  const entries = project.resolved.packages
  await verifyPlatformPackages(root, entries, project.resolved.runtime)
  await mkdir(destination, {recursive:true})
  await mkdir(await safePath(destination, '.eaos/packages'), {recursive:true})
  const npmMetadata = new Map<string, { name: string; exports: Record<string, unknown> }>()
  for (const entry of [...entries, ...project.npmArtifacts]) {
    const source = await safePath(root, entry.inventory)
    const inventory = JSON.parse(await readFile(source,'utf8')) as DeploymentInventory
    const base = dirname(entry.inventory)
    for (const asset of inventory.assets) {
      const bytes = await readFile(await safePath(root, `${base}/${asset.path}`))
      if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Artifact changed during staging')
      const target = await safePath(destination, `${base}/${asset.path}`)
      await mkdir(dirname(target), {recursive:true})
      await writeFile(target,bytes,{flag:'wx'})
    }
    const target = await safePath(destination,entry.inventory)
    await mkdir(dirname(target),{recursive:true})
    await writeFile(target,await readFile(source),{flag:'wx'})
    if (project.npmArtifacts.some(p => p.id === entry.id)) {
      const parts = entry.id.split('/'), packageName = parts.slice(0, entry.id.startsWith('@') ? 2 : 1).join('/')
      let packageRoot = dirname(source), packageExports: Record<string, unknown> = {}
      while (true) {
        try {
          const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
          if (pkg.name === packageName) { packageExports = pkg.exports ?? {}; break }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        const parent = dirname(packageRoot)
        if (parent === packageRoot || !relative(root, parent) || relative(root, parent).startsWith('..')) throw new Error('Missing installed package metadata')
        packageRoot = parent
      }
      const packageBase = relative(root, packageRoot).split('\\').join('/')
      const metadata = npmMetadata.get(packageBase) ?? { name: packageName, exports: {} }
      const subpath = entry.id.slice(packageName.length)
      const inventoryExport = './' + relative(packageRoot, source).split('\\').join('/')
      if (subpath) {
        const moduleBase = relative(packageRoot, dirname(source)).split('\\').join('/')
        const verified = new Set([inventoryExport, ...inventory.assets.map(asset => `./${moduleBase}/${asset.path}`)])
        for (const [key, target] of Object.entries(packageExports)) {
          if (key !== `.${subpath}` && !key.startsWith(`.${subpath}/`)) continue
          if (key.includes('*') || key.includes('\\') || key.includes('%') || key.slice(2).split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid staged package export key')
          if (verifiedStagedExport(target, verified)) metadata.exports[key] = target
        }
      }
      metadata.exports[`.${subpath}/deployment.json`] = inventoryExport
      npmMetadata.set(packageBase, metadata)
    }
  }
  for (const [base, metadata] of npmMetadata) {
    const target = await safePath(destination, `${base}/package.json`)
    try { await lstat(target) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await writeFile(target, JSON.stringify({ ...metadata, private: true, type: 'module' }) + '\n', { flag: 'wx' })
    }
  }

  await writeFile(await safePath(destination,'eaos.platform.json'),await readFile(await safePath(root,config)),{flag:'wx'})
  await resolveProjectManifest(destination, (await readJson(await safePath(destination, 'eaos.platform.json'))).data)
  await verifyPlatformPackages(destination,entries,await readPlatformRuntime(destination))
  return {directory:destination,packages:entries.length+project.npmArtifacts.length,activated:false}
}
