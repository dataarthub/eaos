import type { DefinedPlugin, PluginContext } from './plugin-sdk/define-plugin'
import { evaluatePluginEntitlement, type TenantEntitlements } from './plugin-sdk/entitlements'
/**
 * Cloned test identity and optional role/subscription fixture for SDK route execution.
 * @see {@link createPluginTestHarness}
 */
export interface TestPersona { 
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string; 
/** User identity within the tenant supplied by the trusted host. */
  userId?: string; 
/** Role claims supplied by the host after identity verification. */
  roles?: readonly string[]; 
  /** Commercial entitlement category or model resource tier, interpreted by its owning policy. */
  tier?: 'free' | 'standard' | 'pro'; 
/** Addon identities present in the host entitlement snapshot. */
  addons?: readonly string[] }
/**
 * Optional real host capability factory and explicit data-isolation probe.
 * @see {@link createPluginTestHarness}
 */
export interface PluginTestHarnessOptions {
  
  /**
   * Create real host capabilities for one persona/plugin route request.
   * @param persona - Cloned test identity whose tenant/subscription defaults are interpreted by the harness.
   * @param pluginId - Defined plugin identity receiving scoped host capabilities.
   * @returns Host capabilities without principal/pluginId; the harness supplies those verified fixture fields after this callback resolves.
   * @throws Host adapter construction failures reject the request.
   * @remarks Called per request, after entitlement preview. The host owns connection lifecycle and tenant isolation; no automatic disposal is provided.
   * @see {@link createPluginTestHarness}
   *
   * @example
   * ```typescript
   * import type { PluginTestHarnessOptions, TestPersona } from "@alneas/eaos-core/testing";
   * async function createHostContext(options: PluginTestHarnessOptions, persona: TestPersona) {
   *  if (!options.createContext) throw new Error("Configure real host adapters");
   *  return options.createContext(persona, "notes");
   * }
   * ```
   */
  createContext?: (persona: TestPersona, pluginId: string) => Promise<Omit<PluginContext<any>, 'principal' | 'pluginId'>>
  
  /**
   * Prove tenant isolation using real host-backed writes and foreign-tenant reads.
   * @param harness - Configured harness used to exercise the real adapters under distinct personas.
   * @returns No value; successful completion means the explicit assertions in this host probe passed.
   * @throws Probe assertion/errors reject expectTenantIsolation.
   * @remarks Implement actual create/read assertions; an empty callback does not establish isolation.
   * @see {@link createPluginTestHarness}
   *
   * @example
   * ```typescript
   * import type { PluginTestHarnessOptions, PluginTestHarness } from "@alneas/eaos-core/testing";
   * async function runHostProbe(options: PluginTestHarnessOptions, harness: PluginTestHarness) {
   *  if (!options.isolationProbe) throw new Error("Configure a real isolation probe");
   *  await options.isolationProbe(harness);
   * }
   * ```
   */
  isolationProbe?: (harness: PluginTestHarness) => Promise<void>
}
/**
 * GET/POST route invocation and explicit isolation verification for a defined plugin.
 * @see {@link createPluginTestHarness}
 */
export interface PluginTestHarness {
  
  /**
   * Create a route client using a cloned test persona.
   * @param persona - Tenant fixture; defaults are test-user, member role, free tier and empty addons, except omitted pro addons infer the plugin addon.
   * @returns GET/POST route client using the captured persona for each request.
   * @throws Error for invalid tenant identity or uncloneable persona.
   * @remarks No live host authentication/activation is performed; use createContext and a real isolationProbe for data-boundary verification.
   * @example
   * ```typescript
   * import { createPluginTestHarness } from "@alneas/eaos-core/testing";
   * import { definePlugin } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * const plugin = definePlugin({ id: "notes", routes(router) { router.get("/status", () => ({ ready: true })); router.post("/preview", (_ctx, input) => ({ input })); } });
   * const harness = await createPluginTestHarness(plugin);
   * const client = harness.as({ tenantId: "tenant-demo" });
   * console.log(await client.get("/status"));
   * ```
   */
  as(persona: TestPersona): { 
  /**
   * Invoke an exact GET route using the captured test persona.
   * @param path - Exact declared GET route path; no URL parsing is performed.
   * @returns Resolved route handler output.
   * @throws Rejects on missing route, entitlement denial, unavailable host capability or context/handler failure.
   * @remarks Checks declared entitlement preview before host context construction; unconfigured capabilities fail on use.
   * @example
   * ```typescript
   * import { createPluginTestHarness } from "@alneas/eaos-core/testing";
   * import { definePlugin } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * const plugin = definePlugin({ id: "notes", routes(router) { router.get("/status", () => ({ ready: true })); router.post("/preview", (_ctx, input) => ({ input })); } });
   * const harness = await createPluginTestHarness(plugin);
   * const client = harness.as({ tenantId: "tenant-demo" });
   * console.log(await client.get("/status"));
   * ```
   */
  get(path: string): Promise<unknown>; 
  /**
   * Invoke an exact POST route using the captured test persona.
   * @param path - Exact declared POST route path.
   * @param input - Decoded handler input passed unchanged; the harness does not apply a domain schema.
   * @returns Resolved route handler output.
   * @throws Rejects on missing route, entitlement denial, unavailable host capability or context/handler failure.
   * @remarks Checks declared entitlement preview before host context construction; unconfigured capabilities fail on use.
   * @example
   * ```typescript
   * import { createPluginTestHarness } from "@alneas/eaos-core/testing";
   * import { definePlugin } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * const plugin = definePlugin({ id: "notes", routes(router) { router.get("/status", () => ({ ready: true })); router.post("/preview", (_ctx, input) => ({ input })); } });
   * const harness = await createPluginTestHarness(plugin);
   * const client = harness.as({ tenantId: "tenant-demo" });
   * console.log(await client.post("/preview", { title: "hello" }));
   * ```
   */
  post(path: string, input: unknown): Promise<unknown> }
  
  /**
   * Run the explicitly configured host data-isolation probe.
   * @returns No value; configured probe has completed without failure.
   * @throws Rejects if isolationProbe is absent or that probe rejects.
   * @remarks A real create/foreign-read probe is required; route names and personas alone cannot prove tenant isolation.
   * @example
   * ```typescript
   * import { createPluginTestHarness } from "@alneas/eaos-core/testing";
   * import type { PluginTestHarnessOptions } from "@alneas/eaos-core/testing";
   * import type { DefinedPlugin } from "@alneas/eaos-core/plugin-sdk/define-plugin";
   * async function verifyHostIsolation(plugin: DefinedPlugin, options: PluginTestHarnessOptions) {
   *  const harness = await createPluginTestHarness(plugin, options);
   *  await harness.expectTenantIsolation();
   * }
   * ```
   */
  expectTenantIsolation(): Promise<void>
}
const unavailable = (name: string) => new Proxy({}, { get() { throw Error(`Test host must configure ${name}`) } })
/**
 * Pure SDK harness. No database, server or lifecycle dependency is introduced into Core.
 * @param plugin - Definition built by definePlugin; the harness looks up exact GET/POST route paths.
 * @param options - Optional host context factory and real isolation probe; omission supplies capabilities that throw on property access.
 * @returns A harness whose as(persona) clones the persona and exposes GET/POST calls; expectTenantIsolation requires an explicit isolationProbe.
 * @throws Returned operations throw/reject on invalid persona tenant, missing route, entitlement denial, unconfigured capabilities or host/handler errors. Isolation checks reject without a probe or when that probe rejects.
 * @remarks No database/server/lifecycle is connected automatically. Defaults: free plan, test-user identity, member role and no addons, except pro personas receive the plugin addon when addons are omitted. Entitlement checks are previews; this harness does not independently prove tenant isolation.
 * @example
 * ```typescript
 * import { createPluginTestHarness } from "@alneas/eaos-core/testing";
 * import { definePlugin } from "@alneas/eaos-core/plugin-sdk/define-plugin";
 * const plugin = definePlugin({ id: "notes", routes(router) { router.get("/status", () => ({ ready: true })); } });
 * const harness = await createPluginTestHarness(plugin);
 * console.log(await harness.as({ tenantId: "tenant-demo" }).get("/status"));
 * ```
 */
export async function createPluginTestHarness(plugin: DefinedPlugin, options: PluginTestHarnessOptions = {}): Promise<PluginTestHarness> {
  const harness: PluginTestHarness = {
    as(input) {
      const persona = structuredClone(input)
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(persona.tenantId)) throw Error('Invalid test tenant')
      const request = async (method: string, path: string, input?: unknown) => {
        const route = plugin.routeDefinitions.find(r => r.method === method && r.path === path)
        if (!route) throw Error('Test route unavailable')
        const entitlements: TenantEntitlements = { tenantId: persona.tenantId, plan: persona.tier ?? 'free', status: 'active', addons: persona.addons ?? (persona.tier === 'pro' && plugin.entitlement?.addonId ? [plugin.entitlement.addonId] : []) }
        if (plugin.entitlement) {
          const decision = evaluatePluginEntitlement(plugin.id, plugin.entitlement, persona.tenantId, entitlements)
          if (!decision.allowed) throw Error(decision.reason)
        }
        const dependencies = await options.createContext?.(persona, plugin.id) ?? Object.fromEntries(['db', 'storage', 'secrets', 'jobs', 'webhooks', 'audit', 'services'].map(name => [name, unavailable(name)])) as unknown as Omit<PluginContext, 'principal' | 'pluginId'>
        return route.handler(Object.freeze({ ...dependencies, pluginId: plugin.id, principal: Object.freeze({ tenantId: persona.tenantId, userId: persona.userId ?? 'test-user', roles: Object.freeze([...(persona.roles ?? ['member'])]), entitlements }) }), input)
      }
      return { get: path => request('GET', path), post: (path, input) => request('POST', path, input) }
    },
    async expectTenantIsolation() { if (!options.isolationProbe) throw Error('Configure an isolationProbe with a real foreign-tenant read; no isolation proof can be inferred from a manifest'); await options.isolationProbe(harness) },
  }
  return harness
}
