import { readFile, realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'

import { validateDeploymentPlugins, resolveDeploymentPlacements, type DeploymentPlacements, type DeploymentInventory } from '@alneas/eaos-server/platform'
import { lstat } from 'node:fs/promises'

/**
 * Hash-verified deployment contribution read from one immutable package inventory.
 * @see {@link createDeploymentPlan} for the canonical usage example and runtime requirements.
 */
export interface DeploymentContribution {
 
    /**
   * Exact package identity declared by the verified inventory.
   */
  owner: string
 
    /**
   * Canonical inventory JSON path used for this contribution.
   */
  artifact: string
 
    /**
   * SHA-256 of the exact immutable inventory bytes.
   */
  inventorySha256: string
 
    /**
   * Optional declared runtime module path; inspection does not execute it.
   */
  runtime?: string
 
    /**
   * Declared runtime function contributions, with source assets verified.
   */
  functions: DeploymentInventory['functions']
 
    /**
   * Optional adopted-history database contribution; does not run schema changes.
   */
  database?: DeploymentInventory['database']
 
    /**
   * Optional declared plugins, components and adoption tasks.
   */
  plugins: DeploymentInventory['plugins']
 
    /**
   * declared for inventories with task declarations; legacy-unclassified otherwise.
   */
  coverage: 'declared' | 'legacy-unclassified'
 
    /**
   * Number of inventory assets whose exact bytes passed SHA-256 validation.
   */
  verifiedAssets: number
}

/**
 * Validate inventories and every declared asset hash without executing deployment or migrations.
 * @param paths - Deployment inventory JSON paths; each must be a regular nonsymlink file of at most 1 MiB.
 * @param options - Optional explicit placement catalog for component-to-destination resolution.
 * @returns Verified contributions, function bindings and any resolved placement plan.
 * @throws Rejects malformed or duplicate owners/assets/functions, path escapes, symlinks, checksum mismatches and unresolved required placements.
 * @remarks Reads packaged sources but does not certify their behavior or authorize host adoption.
 * @example
 * import { createDeploymentPlan } from '@alneas/eaos-cli/platform'
 * export function inspectInventory(path: string) { return createDeploymentPlan([path]) }
 */
export async function createDeploymentPlan(paths: string[], options: {
/**
 * Optional explicit component/destination selections to validate against the verified inventories; omitted performs artifact-only inspection.
 */
placements?:DeploymentPlacements} = {}) {
  const owners = new Set<string>()
  const functionIds = new Set<string>()
  const contributions: DeploymentContribution[] = []
  const inventories:DeploymentInventory[]=[]
  for (const path of paths) {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error('Deployment inventory must be a regular JSON file of at most 1 MiB')
    const file = await realpath(path)
    const root = dirname(file)
    const bytes = await readFile(file)
    const inventory: DeploymentInventory = JSON.parse(bytes.toString('utf8'))
    if (!inventory || typeof inventory !== 'object' || inventory.apiVersion !== 1 || typeof inventory.owner !== 'string' || !inventory.owner || !Array.isArray(inventory.assets)
      || !Array.isArray(inventory.functions) || (inventory.database && (inventory.database.tenantColumn !== 'tenant_id'
      || inventory.database.mode !== 'adopt-existing-history'))) throw new Error(`Invalid deployment inventory: ${file}`)
    if (owners.has(inventory.owner)) throw new Error(`Duplicate deployment owner: ${inventory.owner}`)
    owners.add(inventory.owner)
    const assets = new Set<string>()
    for (const asset of inventory.assets) {
      if (!asset || typeof asset.path !== 'string' || !asset.path || asset.path.startsWith('/') || asset.path.includes('\\') || asset.path.split('/').some(part => !part || part === '.' || part === '..') || assets.has(asset.path) || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid or duplicate deployment asset')
      let cursor = root
      for (const part of asset.path.split('/')) { cursor = resolve(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Symlink deployment assets are not supported') }
      const actual = await realpath(cursor)
      if (!(await lstat(actual)).isFile()) throw new Error('Deployment assets must be regular files')
      if (!actual.startsWith(root + sep)) throw new Error('Deployment asset escapes artifact directory')
      const digest = createHash('sha256').update(await readFile(actual)).digest('hex')
      if (digest !== asset.sha256) throw new Error(`Deployment artifact checksum mismatch: ${asset.path}`)
      assets.add(asset.path)
    }
    const requireSource = (source: string) => {
      if (!source || ![...assets].some(path => path.startsWith(source + '/'))) throw new Error(`Missing deployment source: ${source}`)
    }
    if (inventory.database) requireSource(inventory.database.source)
    for (const fn of inventory.functions) {
      if (!fn || !fn.id || functionIds.has(fn.id) || fn.scope !== 'tenant' || !Array.isArray(fn.requiredTenantBindings)
        || !fn.requiredTenantBindings.length || fn.requiredTenantBindings.some(binding => typeof binding !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(binding))) throw new Error(`Invalid or conflicting Function declaration: ${fn.id}`)
      requireSource(fn.source)
      functionIds.add(fn.id)
    }
    if (inventory.runtime && !assets.has(inventory.runtime)) throw new Error('Runtime must be a verified asset')
    const plugins = validateDeploymentPlugins(inventory)
    inventories.push(inventory)
    contributions.push({ owner: inventory.owner, artifact: file, inventorySha256: createHash('sha256').update(bytes).digest('hex'), runtime: inventory.runtime, functions: inventory.functions, database: inventory.database, plugins, coverage: plugins ? 'declared' : 'legacy-unclassified', verifiedAssets: assets.size })
  }
  return { mode: 'plan-only', contributions, ...(options.placements?{componentPlacements:resolveDeploymentPlacements(options.placements,inventories),destinations:options.placements.destinations}:{}), databasePolicy: 'one shared migration history; reconcile existing checksums before applying new changesets' }
}
