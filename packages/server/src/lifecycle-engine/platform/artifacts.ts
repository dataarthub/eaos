import type { PluginManifest } from '@alneas/eaos-core/plugin-sdk'
import type { LifecyclePlugin } from '../index'
import type { DeploymentPlugin } from './deployment'

/**
 * Trusted code contributions restricted to explicit tenant IDs; registration never activates a plugin.
 * 
 * 
 * Trusted package contributions; code registration does not grant tenant activation.
 * @see PluginLifecycle for canonical integration usage.
 */
export interface PlatformContribution {
  /**
   * Contribution contract discriminator; currently 1.
   */
  apiVersion: 1
  /**
   * Contribution/package identity.
   */
  id: string
  /**
   * Concrete admitted tenant catalog; never wildcard authorization.
   */
  tenantIds: string[]
  /**
   * Optional public plugin manifests contributed by the trusted package.
   */
  manifests?: PluginManifest[]
  /**
   * Optional trusted lifecycle release definitions.
   */
  lifecycle?: LifecyclePlugin[]
  /**
   * Optional plugin ID to allowed route-prefix contributions.
   */
  routePrefixes?: Record<string, string[]>
}
/**
 * Checksummed artifact metadata and explicit per-plugin deployment work, separate from runtime admission.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface DeploymentInventory {
  /**
   * Inventory discriminator; currently 1.
   */
  apiVersion: 1
  /**
   * Stable package/contribution owner used to bind receipts.
   */
  owner: string
  /**
   * Optional package release version.
   */
  version?: string
  /**
   * Optional declared execution runtime descriptor.
   */
  runtime?: string
  /**
   * Optional ordered lifecycle plugin IDs; required for classified plugin work.
   */
  lifecycleBundle?: string[]
  /**
   * Tenant-scoped function source declarations and required tenant bindings.
   */
  functions: Array<{ 
    /**
     * Unique tenant-scoped function identity.
     */
    id: string; 
    /**
     * Project-relative packaged function/database source path.
     */
    source: string; 
    /**
     * Function scope discriminator; must be tenant.
     */
    scope: 'tenant'; 
    /**
     * Explicit binding names that the host must resolve separately for each tenant.
     */
    requiredTenantBindings: string[] }>
  /**
   * Optional adopted existing-history database declaration; never an instruction to recreate history.
   */
  database?: { 
    /**
     * Project-relative packaged function/database source path.
     */
    source: string; 
    /**
     * Database history policy; adopt-existing-history never recreates historical migrations.
     */
    mode: 'adopt-existing-history'; 
    /**
     * Canonical tenant isolation column; currently tenant_id.
     */
    tenantColumn: 'tenant_id' }
  /**
   * Exact project-relative packaged asset paths and SHA-256 digests.
   */
  assets: Array<{ 
    /**
     * Exact project-relative packaged asset path.
     */
    path: string; 
    /**
     * Lowercase SHA-256 digest of the asset bytes.
     */
    sha256: string }>
  /**
   * Optional classified component/task declarations; absence is legacy-unclassified.
   * 
   * Explicit per-plugin composition and required work. Omission is legacy/unclassified.
   */
  plugins?: DeploymentPlugin[]
}
/**
 * Trusted project-relative artifact/module registration with explicit tenant/plugin scopes.
 * 
 * 
 * Paths are project-relative. Settings are non-secret; use host-resolved references for credentials.
 * @see PluginLifecycle for canonical integration usage.
 */
export interface PlatformPackage {
  /**
   * Unique nonblank registration ID.
   */
  id: string
  /**
   * Project-relative inventory path without absolute/traversal/backslash segments.
   */
  inventory: string
  /**
   * Project-relative entry module path without traversal.
   */
  module: string
  /**
   * Nonempty concrete trimmed tenant IDs; wildcard is forbidden.
   */
  tenantIds: string[]
  /**
   * Nonempty unique plugin IDs contributed by this package.
   */
  pluginIds: string[]
  /**
   * Optional nonsecret host configuration object; resolve credentials by host references.
   */
  settings?: Record<string, unknown>
}
/**
 * Validates explicit checksummed package registrations and concrete tenant/plugin scope metadata.
 * @param value - Untrusted package registration array, or undefined for no packages.
 * @returns The original accepted array, or a new empty array for undefined.
 * @throws Error for nonarray input, unknown fields, duplicate package IDs, invalid paths, empty/duplicate plugin IDs or invalid tenant scopes.
 * 
 * @remarks
 * Checks project-relative nontraversing inventory/module paths and nonsecret settings shape. It does not load files, verify checksums, resolve membership or activate plugins.
 * 
 * @example
 * ```typescript
 * import { validatePlatformPackages } from '@alneas/eaos-server/platform/artifacts';
 * const packages = validatePlatformPackages([{ id: 'reports', inventory: '.eaos/packages/reports/deployment.json', module: '.eaos/packages/reports/index.js', tenantIds: ['sample'], pluginIds: ['reports'] }]);
 * ```
 */
export function validatePlatformPackages(value: unknown): PlatformPackage[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Platform packages must be an array')
  const ids = new Set<string>()
  const path = (v: unknown) => typeof v === 'string' && v.length > 0 && !v.startsWith('/') && !v.includes('\\') && v.split('/').every(p => p && p !== '.' && p !== '..')
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).some(k => !['id', 'inventory', 'module', 'tenantIds', 'pluginIds', 'settings'].includes(k))
      || typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id) || !path(entry.inventory) || !path(entry.module)
      || !Array.isArray(entry.pluginIds) || !entry.pluginIds.length || entry.pluginIds.some((p: unknown) => typeof p !== 'string' || !p.trim()) || new Set(entry.pluginIds).size !== entry.pluginIds.length
      || !Array.isArray(entry.tenantIds) || !entry.tenantIds.length || entry.tenantIds.some((t: unknown) => typeof t !== 'string' || !t.trim() || t !== t.trim() || t === '*')
      || (entry.settings !== undefined && (!entry.settings || typeof entry.settings !== 'object' || Array.isArray(entry.settings)))) throw new Error('Invalid platform package registration')
    ids.add(entry.id)

  }
  return value
}
