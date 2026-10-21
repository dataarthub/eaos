import type { PluginManifest, ClientTarget, McpToolDefinition } from './types'
import type { SkillCatalogEntry, SkillDocument, SkillDocumentLoader } from '../ai/governance'
import type { SkillRuntimeAvailability } from '../ai/skills'
import { evaluateSkillEligibility, isSafeSkillDocumentPath } from '../ai/skills'
import { assertPluginEntitlement } from './entitlements'

/**
 * Keep plugin manifests in memory and expose discovery, tools, skills and help metadata.
 * @remarks Manifests and returned objects are stored by reference; no activation, persistence or tenant authorization occurs. Skill body loading is delegated to the host.
 *
 * @example
 * ```typescript
 * import { PluginRegistry } from "@alneas/eaos-core/plugin-sdk/registry";
 * const registry = new PluginRegistry();
 * console.log(registry.getAll()); // []
 * ```
 */
export class PluginRegistry {
  private plugins = new Map<string, PluginManifest>()

  /**
   * Validate entitlement/tier consistency and register a unique plugin ID.
   * @param manifest - Manifest stored by reference; commercial tiers require matching entitlement policies.
   * @returns No value; the plugin is registered.
   * @throws Error for invalid entitlement, mismatched tier or duplicate plugin ID.
   * @remarks Does not validate every manifest field or activate plugin capabilities.
   * @example
   * ```typescript
   * import { PluginRegistry } from "@alneas/eaos-core/plugin-sdk/registry";
   * import type { PluginManifest } from "@alneas/eaos-core/plugin-sdk/types";
   * function registerHostManifest(manifest: PluginManifest) {
   *  const registry = new PluginRegistry();
   *  registry.register(manifest);
   *  return registry;
   * }
   * ```
   */
  register(manifest: PluginManifest): void {
    if (manifest.entitlement) assertPluginEntitlement(manifest.entitlement)
    if (['public', 'pro', 'corporate'].includes(manifest.tier) && manifest.entitlement?.tier !== manifest.tier) throw new Error('Commercial tier requires a matching entitlement policy')
    if (manifest.entitlement && manifest.tier === 'standard' && manifest.entitlement.tier !== 'standard') throw new Error('Standard tier differs from entitlement policy')
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin with id '${manifest.id}' is already registered.`)
    }
    this.plugins.set(manifest.id, manifest)
  }

  /**
   * Find a registered manifest by its exact plugin ID.
   * @param id - Plugin registration key.
   * @returns Original manifest reference, or undefined when absent.
   * @example
   * ```typescript
   * import { PluginRegistry } from "@alneas/eaos-core/plugin-sdk/registry";
   * const registry = new PluginRegistry();
   * console.log(registry.get("notes")); // undefined
   * ```
   */
  get(id: string): PluginManifest | undefined {
    return this.plugins.get(id)
  }

  /**
   * List registered manifests in registration order.
   * @returns New array containing original manifest references; empty for a fresh registry.
   * @example
   * ```typescript
   * import { PluginRegistry } from "@alneas/eaos-core/plugin-sdk/registry";
   * const registry = new PluginRegistry();
   * console.log(registry.getAll()); // []
   * ```
   */
  getAll(): PluginManifest[] {
    return Array.from(this.plugins.values())
  }

  /**
   * Select manifests advertising one client channel.
   * @param target - Client channel to match against each manifest targets array.
   * @returns New array of original manifest references in registration order.
   * @example
   * ```typescript
   * import { PluginRegistry } from "@alneas/eaos-core/plugin-sdk/registry";
   * const registry = new PluginRegistry();
   * console.log(registry.getByTarget("web")); // []
   * ```
   */
  getByTarget(target: ClientTarget): PluginManifest[] {
    return this.getAll().filter(plugin => plugin.targets.includes(target))
  }

  /**
   * Sort registered manifests by ascending schema migration order.
   * @returns New array of original manifest references sorted by schema.migrationOrder.
   * @example
   * ```typescript
   * import { PluginRegistry } from "@alneas/eaos-core/plugin-sdk/registry";
   * const registry = new PluginRegistry();
   * console.log(registry.getSortedByMigrationOrder()); // []
   * ```
   */
  getSortedByMigrationOrder(): PluginManifest[] {
    return this.getAll().sort((a, b) => a.schema.migrationOrder - b.schema.migrationOrder)
  }

  /**
   * Collect tools from every registered manifest in registration order.
   * @returns New array of original MCP tool references; empty when none are declared.
   * @example
   * ```typescript
   * import { PluginRegistry } from "@alneas/eaos-core/plugin-sdk/registry";
   * const registry = new PluginRegistry();
   * console.log(registry.getAllMcpTools()); // []
   * ```
   */
  getAllMcpTools(): McpToolDefinition[] {
    const tools: McpToolDefinition[] = []
    for (const plugin of this.plugins.values()) {
      if (plugin.mcp?.tools) {
        tools.push(...plugin.mcp.tools)
      }
    }
    return tools
  }

  /**
   * Collect registered plugin skill metadata without loading or executing instructions.
   * @returns New pluginId/skill pairs containing original skill references.
   * @example
   * ```typescript
   * import { PluginRegistry } from "@alneas/eaos-core/plugin-sdk/registry";
   * const registry = new PluginRegistry();
   * console.log(registry.getAllAgentSkills()); // []
   * ```
   */
  getAllAgentSkills(): Array<{ 
/** Owning plugin identity used for capability scope and discovery. */
  pluginId: string; 
  /** Original catalog metadata associated with the loaded/discovered skill. */
  skill: SkillCatalogEntry }> {
    const skills: Array<{ 
/** Owning plugin identity used for capability scope and discovery. */
  pluginId: string; 
  /** Original catalog metadata associated with the loaded/discovered skill. */
  skill: SkillCatalogEntry }> = []
    for (const plugin of this.plugins.values()) {
      for (const skill of plugin.agentCapabilities?.skills ?? []) {
        skills.push({ pluginId: plugin.id, skill })
      }
    }
    return skills
  }

  /**
   * Filter discovered skill metadata using trusted host availability.
   * @param availability - Host OS, binaries, environment/config names and adapters; no process state is read.
   * @returns New pluginId/skill pairs for eligible skills in discovery order.
   * @example
   * ```typescript
   * import { PluginRegistry } from "@alneas/eaos-core/plugin-sdk/registry";
   * const registry = new PluginRegistry();
   * console.log(registry.getEligibleAgentSkills({ os: "linux" })); // []
   * ```
   */
  getEligibleAgentSkills(availability: SkillRuntimeAvailability): Array<{ 
/** Owning plugin identity used for capability scope and discovery. */
  pluginId: string; 
  /** Original catalog metadata associated with the loaded/discovered skill. */
  skill: SkillCatalogEntry }> {
    return this.getAllAgentSkills().filter(({ skill }) => evaluateSkillEligibility(skill, availability).eligible)
  }

  /**
   * Load eligible skill instruction bodies concurrently through a host package loader.
   * @param availability - Trusted facts used to filter skill prerequisites before loading.
   * @param loader - Host callback receiving plugin ID, safe relative path and metadata; return nonblank instruction text synchronously or asynchronously.
   * @returns Loaded documents in eligibility order, including original skill references and instruction text; empty when none qualify.
   * @throws Rejects for unsafe paths, empty/nonstring content or propagated loader failures.
   * @remarks Starts all eligible loads with Promise.all; rejection does not cancel other loads. Omitted documentPath derives skills/<last ID segment>/SKILL.md. The loader owns package resolution and access checks.
   * @example
   * ```typescript
   * import { PluginRegistry } from "@alneas/eaos-core/plugin-sdk/registry";
   * import type { SkillDocumentLoader } from "@alneas/eaos-core/ai/governance";
   * async function loadHostSkills(loader: SkillDocumentLoader) {
   *  const registry = new PluginRegistry();
   *  return registry.getEligibleAgentSkillDocuments({ os: "linux" }, loader);
   * }
   * ```
   */
  async getEligibleAgentSkillDocuments(
    availability: SkillRuntimeAvailability,
    loader: SkillDocumentLoader,
  ): Promise<SkillDocument[]> {
    const eligible = this.getEligibleAgentSkills(availability)
    return Promise.all(eligible.map(async ({ pluginId, skill }) => {
      const path = skill.documentPath ?? `skills/${skill.id.split('.').at(-1)}/SKILL.md`
      if (!path || !isSafeSkillDocumentPath(path)) throw new Error(`Skill '${pluginId}:${skill.id}' has no safe document path`)
      const content = await loader.load({ pluginId, path, skill })
      if (typeof content !== 'string' || content.trim().length === 0) throw new Error(`Skill '${pluginId}:${skill.id}' document is empty`)
      return { pluginId, skill, path, content }
    }))
  }

  /**
   * Find the first registered tool with an exact name match.
   * @param toolName - MCP tool identity to locate across manifests in registration order.
   * @returns Original tool reference or undefined when no match exists.
   * @example
   * ```typescript
   * import { PluginRegistry } from "@alneas/eaos-core/plugin-sdk/registry";
   * const registry = new PluginRegistry();
   * console.log(registry.getMcpTool("notes.list")); // undefined
   * ```
   */
  getMcpTool(toolName: string): McpToolDefinition | undefined {
    for (const plugin of this.plugins.values()) {
      const found = plugin.mcp?.tools?.find(t => t.name === toolName)
      if (found) return found
    }
    return undefined
  }

  /**
   * Resolve the first matching contextual-help entry across registered plugins.
   * @param contextKey - Exact help key, or a plugin ID followed by dot/colon and a local help key.
   * @returns Owning plugin ID and original help item reference, or undefined.
   * @example
   * ```typescript
   * import { PluginRegistry } from "@alneas/eaos-core/plugin-sdk/registry";
   * const registry = new PluginRegistry();
   * console.log(registry.getHelpContext("notes:overview")); // undefined
   * ```
   */
  getHelpContext(contextKey: string): { 
/** Owning plugin identity used for capability scope and discovery. */
  pluginId: string; 
  /** Original contextual-help item returned by registry discovery; mutating it affects the registered manifest. */
  item: import('./types').HelpContextItem } | undefined {
    for (const plugin of this.plugins.values()) {
      if (plugin.docs?.helpContexts) {
        if (plugin.docs.helpContexts[contextKey]) {
          return { pluginId: plugin.id, item: plugin.docs.helpContexts[contextKey] }
        }
        // Also check if prefixed with plugin id (e.g. `crm:pipeline`)
        const withoutPrefix = contextKey.replace(new RegExp(`^${plugin.id}[.:]` ), '')
        if (plugin.docs.helpContexts[withoutPrefix]) {
          return { pluginId: plugin.id, item: plugin.docs.helpContexts[withoutPrefix] }
        }
      }
    }
    return undefined
  }

  /**
   * Flatten contextual help entries for search and indexing.
   * @returns New pluginId/contextKey/item records containing original help references.
   * @example
   * ```typescript
   * import { PluginRegistry } from "@alneas/eaos-core/plugin-sdk/registry";
   * const registry = new PluginRegistry();
   * console.log(registry.getAllHelpContexts()); // []
   * ```
   */
  getAllHelpContexts(): Array<{ 
/** Owning plugin identity used for capability scope and discovery. */
  pluginId: string; 
  /** Exact contextual-help lookup key, optionally prefixed by plugin ID and dot/colon. */
  contextKey: string; 
  /** Original contextual-help item returned by registry discovery; mutating it affects the registered manifest. */
  item: import('./types').HelpContextItem }> {
    const contexts: Array<{ 
/** Owning plugin identity used for capability scope and discovery. */
  pluginId: string; 
  /** Exact contextual-help lookup key, optionally prefixed by plugin ID and dot/colon. */
  contextKey: string; 
  /** Original contextual-help item returned by registry discovery; mutating it affects the registered manifest. */
  item: import('./types').HelpContextItem }> = []
    for (const plugin of this.plugins.values()) {
      if (plugin.docs?.helpContexts) {
        for (const [key, item] of Object.entries(plugin.docs.helpContexts)) {
          contexts.push({ pluginId: plugin.id, contextKey: key, item })
        }
      }
    }
    return contexts
  }
}
