/**
 * Select tenant-specific strategy references with an optional module guard.
 * @typeParam T - Strategy value shared by default and tenant overrides; returned values are not cloned.
 * @remarks Stores references in memory; does not persist registrations or establish tenant authentication.
 *
 * @example
 * ```typescript
 * import { TenantStrategyRegistry } from "@alneas/eaos-core/plugin-sdk/tenant-strategy-registry";
 * const registry = new TenantStrategyRegistry({ mode: "default" });
 * registry.registerTenantStrategy("tenant-demo", { mode: "custom" });
 * console.log(registry.resolve("tenant-demo").mode);
 * ```
 */
export class TenantStrategyRegistry<T> {
  private defaultStrategy: T
  private tenantStrategies = new Map<string, T>()
  private moduleGuard?: (tenantId: string, enabledModules?: string[]) => boolean

  /**
   * Initialize the default and optional authorization callback.
   * @param defaultStrategy - Fallback returned when no truthy override is available or guard denies it.
   * @param moduleGuard - Optional synchronous callback invoked only for a truthy override with tenant ID and supplied modules; false selects default.
   *
   * @example
   * ```typescript
   * import { TenantStrategyRegistry } from "@alneas/eaos-core/plugin-sdk/tenant-strategy-registry";
   * const registry = new TenantStrategyRegistry({ mode: "default" }, (_tenantId, modules) => modules?.includes("custom") === true);
   * console.log(registry.resolve("tenant-demo"));
   * ```
   */
  constructor(defaultStrategy: T, moduleGuard?: (tenantId: string, enabledModules?: string[]) => boolean) {
    this.defaultStrategy = defaultStrategy
    this.moduleGuard = moduleGuard
  }

  /**
   * Replace the in-memory strategy for a tenant key.
   * @param tenantId - Exact tenant lookup key.
   * @param strategy - Override stored by reference; falsy values resolve to the default.
   * @returns No value; registration has been replaced.
   * @example
   * ```typescript
   * import { TenantStrategyRegistry } from "@alneas/eaos-core/plugin-sdk/tenant-strategy-registry";
   * const registry = new TenantStrategyRegistry("default");
   * registry.registerTenantStrategy("tenant-demo", "custom");
   * ```
   */
  registerTenantStrategy(tenantId: string, strategy: T): void {
    this.tenantStrategies.set(tenantId, strategy)
  }

  /**
   * Resolve an authorized override or the original default reference.
   * @param tenantId - Exact tenant lookup key.
   * @param enabledModules - Optional module list forwarded unchanged to moduleGuard.
   * @returns Override when truthy and permitted, otherwise defaultStrategy.
   * @throws Errors thrown by moduleGuard propagate.
   * @remarks A denied override writes a console warning.
   * @example
   * ```typescript
   * import { TenantStrategyRegistry } from "@alneas/eaos-core/plugin-sdk/tenant-strategy-registry";
   * const registry = new TenantStrategyRegistry("default");
   * console.log(registry.resolve("tenant-demo")); // default
   * ```
   */
  resolve(tenantId: string, enabledModules?: string[]): T {
    const override = this.tenantStrategies.get(tenantId)
    if (!override) return this.defaultStrategy

    if (this.moduleGuard && !this.moduleGuard(tenantId, enabledModules)) {
      console.warn(`[TenantStrategyRegistry] Strategy override for tenant '${tenantId}' is not enabled by license. Falling back to default.`)
      return this.defaultStrategy
    }

    return override
  }

  /**
   * Check whether a tenant key is registered regardless of guard eligibility.
   * @param tenantId - Exact registration key.
   * @returns Whether the registry contains the key, even if the stored strategy is falsy.
   * @example
   * ```typescript
   * import { TenantStrategyRegistry } from "@alneas/eaos-core/plugin-sdk/tenant-strategy-registry";
   * const registry = new TenantStrategyRegistry("default");
   * console.log(registry.hasTenantStrategy("tenant-demo")); // false
   * ```
   */
  hasTenantStrategy(tenantId: string): boolean {
    return this.tenantStrategies.has(tenantId)
  }
}
