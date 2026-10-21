import { createRequire } from 'node:module'
import { join, relative, dirname, resolve } from 'node:path'
import { readFile, realpath } from 'node:fs/promises'
import { validateDeploymentPlugins, validatePlatformPackages, resolveDeploymentPlacements, type DeploymentInventory, type DeploymentPlacements, type PlatformPackage } from '@alneas/eaos-server/platform'
import { readJson, safePath } from './index'
import { createDeploymentPlan } from './deployment-plan'
import { resolveManifest, type PlatformManifest } from './render'

/**
 * Supported OCI preset selections layered over a host platform manifest.
 * @see {@link expandPreset} for the canonical usage example and runtime requirements.
 */
export interface PresetManifest extends Omit<PlatformManifest, 'deployment'> {
  
    /**
   * Explicit supported infrastructure preset; oci-adb-standard is the accepted alias of oci-adb.
   */
  preset: 'oci-adb' | 'oci-adb-standard'
      /**
   * Unique installed npm package or module subpath identities selected for this host; code selection is not activation.
   */
  plugins?: string[]
  
    /**
   * Explicit local private package paths and tenant allowlists selected by the host.
   */
  corporatePackages?: Array<{
    /** Expected package owner identifier, required to match its deployment inventory. */
  id: string;
    /** Project-contained directory containing the acquired package deployment.json and verified assets. */
  path: string;
    /** Explicit nonempty tenant allowlist for the package registration, validated by platform package rules. */
  tenants: string[] }>
  
    /**
   * Optional deployment overrides layered over the preset's local Compose defaults.
   */
  deployment?: Omit<Partial<PlatformManifest['deployment']>, 'images'> & {
    /** Optional per-role image overrides merged over local appName-backend:dev and appName-frontend:dev tags before platform defaults are resolved. */
  images?: Partial<PlatformManifest['deployment']['images']> }
}
const npmName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/
/**
 * Expand supported OCI preset defaults without downloading images or performing infrastructure work.
 * @param input - Untrusted manifest value; a manifest without preset is returned unchanged.
 * @returns The original value without a preset, or a new manifest with explicit preset defaults.
 * @throws If the preset, package selections or deployment overrides have an invalid shape.
 * @remarks Default dev image tags are local build names, not claims of published registry availability.
 * @example
 * import { expandPreset } from '@alneas/eaos-cli/platform'
 * const expanded = expandPreset({ preset: 'oci-adb', platform: { appName: 'example', baseDomain: 'example.com' } })
 */
export function expandPreset(input: unknown): any {
  const value = input as PresetManifest
  if (value?.preset === undefined) return input
  if (!['oci-adb', 'oci-adb-standard'].includes(value.preset)) throw new Error('Unknown Platform preset')
  if (value.plugins !== undefined && (!Array.isArray(value.plugins) || new Set(value.plugins).size !== value.plugins.length || value.plugins.some(p => typeof p !== 'string' || !npmName.test(p)))) throw new Error('Preset plugins must be unique installed package selectors')
  if (value.corporatePackages !== undefined && (!Array.isArray(value.corporatePackages) || value.corporatePackages.some(p => !p || typeof p !== 'object' || Object.keys(p).some(k => !['id', 'path', 'tenants'].includes(k)) || typeof p.id !== 'string' || typeof p.path !== 'string' || !Array.isArray(p.tenants) || !p.tenants.length))) throw new Error('Invalid corporatePackages')
  if (value.deployment !== undefined && (!value.deployment || typeof value.deployment !== 'object' || Array.isArray(value.deployment))) throw new Error('Preset deployment must be an object')
  if (value.deployment?.images !== undefined && (!value.deployment.images || typeof value.deployment.images !== 'object' || Array.isArray(value.deployment.images))) throw new Error('Preset images must be an object')
  const app = value.platform?.appName
  // Local tags name host-built images; they are not claims that a public registry provides them.
  const deployment = { target: 'compose', ...value.deployment, images: { backend: `${app}-backend:dev`, frontend: `${app}-frontend:dev`, ...value.deployment?.images } }
  return { ...value, platform: { ...(deployment.target !== 'compose' ? { networkName: 'kamal' } : {}), ...value.platform }, deployment,
    runtime: value.runtime ?? { backend: { id: 'primary', databaseId: `${app}-adb`, dialect: 'oracle', mode: 'shared' } },
  }
}
function local(root: string, path: string) {
  const name = relative(root, path).split('\\').join('/')
  if (!name || name.startsWith('../') || name.startsWith('/')) throw new Error('Preset artifacts must be installed inside the project')
  return name
}
/**
 * Resolve an application manifest and installed package contributions into a deployment configuration.
 * @param root - Trusted application root used to resolve package inventories.
 * @param input - Application manifest or supported preset declaration.
 * @returns Resolved manifest/configuration and verified package contribution metadata.
 * @throws Rejects invalid declarations, unavailable package inventories or incompatible placements.
 * @remarks Package selection does not grant a tenant access or execute runtime factories.
 * @example
 * import { resolveProjectManifest } from '@alneas/eaos-cli/platform'
 * export function resolveHost(root: string, input: unknown) { return resolveProjectManifest(root, input) }
 */
export async function resolveProjectManifest(root: string, input: unknown) {
  root = await realpath(root)
  const expanded = expandPreset(input)
  // Validate top-level fields and explicit overrides before reading package files.
  const initial = resolveManifest(expanded)
  if (!expanded.preset) return { manifest: expanded as PlatformManifest, resolved: initial, inventories: [] as string[], npmArtifacts: [] as Omit<PlatformPackage, 'tenantIds'>[] }
  const packages: PlatformPackage[] = [...initial.packages], paths: string[] = []
  const require = createRequire(join(root, 'package.json'))
  const npmArtifacts: Omit<PlatformPackage, 'tenantIds'>[] = []
  for (const name of expanded.plugins ?? []) {
    const file = await safePath(root, local(root, require.resolve(name + '/deployment.json')))
    const inventory = (await readJson(file)).data as DeploymentInventory
    if (inventory.owner !== name || !inventory.runtime || !inventory.lifecycleBundle?.length) throw new Error('Installed inventory requires a matching owner, runtime and lifecycle bundle')
    npmArtifacts.push({ id: name, inventory: local(root, file), module: `${local(root, dirname(file))}/${inventory.runtime}`, pluginIds: inventory.lifecycleBundle })
    paths.push(file)
  }
  for (const entry of expanded.corporatePackages ?? []) {
    const path = await safePath(root, `${entry.path.replace(/\/$/, '')}/deployment.json`)
    const { data } = await readJson(path), inv = data as DeploymentInventory
    if (inv.owner !== entry.id || !inv.runtime || !inv.lifecycleBundle?.length) throw new Error('Corporate package requires matching owner, runtime and lifecycle bundle')
    const base = local(root, dirname(path))
    packages.push({ id: entry.id, inventory: local(root, path), module: `${base}/${inv.runtime}`, tenantIds: entry.tenants, pluginIds: inv.lifecycleBundle })
  }
  validatePlatformPackages(packages)
  paths.push(...await Promise.all(packages.map(p => safePath(root, p.inventory))))
  const unique = [...new Set(paths)]
  await createDeploymentPlan(unique)
  const inventories: DeploymentInventory[] = await Promise.all(unique.map(async path => JSON.parse(await readFile(path, 'utf8'))))
  const placements: DeploymentPlacements = { destinations: [...(initial.deployment.placements?.destinations ?? [])], plugins: [] }
  const add = (destination: DeploymentPlacements['destinations'][number]) => {
    const known = placements.destinations.find(d => d.id === destination.id)
    if (!known) placements.destinations.push(destination)
    return destination.id
  }
  const explicit = initial.deployment.placements
  for (const inv of inventories) {
    const plugins = validateDeploymentPlugins(inv)
    if (!plugins) throw new Error('Preset requires classified deployment components for every selected package')
    for (const plugin of plugins) {
      const override = explicit?.plugins.find(p => p.owner === inv.owner && p.pluginId === plugin.id)
      const components: Record<string, string[]> = {}
      for (const component of plugin.components) {
        if (override && Object.hasOwn(override.components, component.id)) { components[component.id] = override.components[component.id]; continue }
        let destination: DeploymentPlacements['destinations'][number] | undefined
        const revision = 'oci-adb-v1'
        if (component.placement === 'host' || component.placement === 'container') {
          const service = component.kind === 'frontend' ? 'frontend' : ['worker', 'job', 'workflow'].includes(component.kind) && initial.deployment.images.worker ? 'worker' : 'backend'
          destination = { id: `preset-${service}`, placement: 'container', service, revision }
        } else if (component.placement === 'database') {
          const backend = initial.runtime!.backend
          destination = { id: 'preset-database', placement: 'database', backendId: backend.id, databaseId: backend.databaseId, ...(backend.tenantId ? { tenantId: backend.tenantId } : {}), revision }
        } else if (component.placement === 'cloud' && ['storage', 'infrastructure'].includes(component.kind)) {
          destination = { id: `preset-${component.kind}`, placement: 'cloud', reference: component.kind === 'storage' ? 'oci-adb:objects' : 'oci-adb:stack', revision }
        }
        if (!destination && component.required !== false) throw new Error(`Preset requires an explicit binding for ${inv.owner}/${plugin.id}/${component.id}`)
        components[component.id] = destination ? [add(destination)] : []
      }
      if (override && Object.keys(override.components).some(c => !plugin.components.some(p => p.id === c))) throw new Error('Unknown preset component override')
      placements.plugins.push({ owner: inv.owner, pluginId: plugin.id, components })
    }
  }
  if (explicit?.plugins.some(p => !placements.plugins.some(q => q.owner === p.owner && q.pluginId === p.pluginId))) throw new Error('Unknown preset plugin override')
  resolveDeploymentPlacements(placements, inventories)
  const manifest = { ...expanded, packages, deployment: { ...expanded.deployment, placements } }
  return { manifest, resolved: resolveManifest(manifest), inventories: unique, npmArtifacts }
}
