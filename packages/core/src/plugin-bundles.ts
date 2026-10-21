/**
 * A plugin-shaped value that can be included in an operator bundle.
 * @see {@link selectPluginBundles}
 */
export interface BundlePlugin { 
  /** Plugin identity used for bundle ID projection and deduplication. */
  id: string }

/**
 * A catalog of user-facing bundles. The values stay ordered for install and removal.
 * @see {@link selectPluginBundles}
 * @typeParam T - Plugin-shaped values extending BundlePlugin; defaults to BundlePlugin.
 */
export type PluginBundleCatalog<T extends BundlePlugin = BundlePlugin> = Readonly<Record<string, readonly T[]>>

/**
 * Convert a manifest catalog into the ID map accepted by LifecycleProject.bundles.
 * @typeParam T - Plugin-shaped values with an ID.
 * @typeParam C - Catalog whose keys are preserved in the result type.
 * @param catalog - Named ordered plugin lists; IDs are copied without validation or deduplication.
 * @returns A new object with the same enumerable bundle keys and fresh arrays of plugin IDs.
 * @example
 * ```typescript
 * import { bundlePluginIds } from "@alneas/eaos-core/plugin-bundles";
 * console.log(bundlePluginIds({ basic: [{ id: "notes" }] })); // { basic: ["notes"] }
 * ```
 */
export function bundlePluginIds<T extends BundlePlugin, C extends PluginBundleCatalog<T>>(catalog: C): {
  [K in keyof C]: readonly string[]
} {
  return Object.fromEntries(Object.entries(catalog).map(([name, plugins]) => [name, plugins.map(plugin => plugin.id)])) as unknown as {
    [K in keyof C]: readonly string[]
  }
}

/**
 * Select and de-duplicate plugins from one or more user-facing bundles.
 * @typeParam T - Plugin-shaped values whose original references are returned.
 * @param catalog - Bundle-name to ordered plugin references.
 * @param names - Bundle names visited in supplied order; repeats are allowed.
 * @returns A new array ordered by first occurrence of each ID, containing its last encountered plugin reference; empty names yield an empty result.
 * @throws Error when a requested bundle name is unknown.
 * @example
 * ```typescript
 * import { selectPluginBundles } from "@alneas/eaos-core/plugin-bundles";
 * console.log(selectPluginBundles({ basic: [{ id: "notes" }] }, ["basic"]).map(plugin => plugin.id));
 * ```
 */
export function selectPluginBundles<T extends BundlePlugin>(catalog: PluginBundleCatalog<T>, names: readonly string[]): readonly T[] {
  const selected = new Map<string, T>()
  for (const name of names) {
    const plugins = catalog[name]
    if (!plugins) throw new Error(`Unknown plugin bundle: ${name}`)
    for (const plugin of plugins) selected.set(plugin.id, plugin)
  }
  return [...selected.values()]
}
