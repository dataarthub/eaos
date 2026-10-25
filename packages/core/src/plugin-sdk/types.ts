import type { AIRiskLevel, SkillCatalogEntry } from '../ai/governance'
import type { AIHostAdapters } from '../ai/host-adapters'
import type { PluginStoragePolicy } from './storage-policy'

/**
 * Client channels a plugin advertises to hosts.
 * @see {@link PluginRegistry}
 */
export type ClientTarget = 'web' | 'line' | 'ios'

/**
 * Tenant and user identity plus role and optional permission claims supplied by the host.
 * @see {@link PluginRegistry}
 */
export interface UserContext {
  
/** User identity within the tenant supplied by the trusted host. */
  userId: string
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** Role claims supplied by the host after identity verification. */
  roles: string[]
  
/** Optional explicit permission names interpreted and enforced by the host. */
  permissions?: string[]
}


/**
 * One child navigation link with its display label and optional icon.
 * @see {@link PluginRegistry}
 */
export interface NavigationItem {
  
  /** Client route destination interpreted by the host navigation layer. */
  path: string
  
  /** Human-readable navigation/node/setting label displayed by the host. */
  label: string
  
  /** Host UI icon identifier for displaying the plugin/navigation item. */
  icon?: string
}

/**
 * A labeled navigation group with sorting order and child links.
 * @see {@link PluginRegistry}
 */
export interface NavigationConfig {
  
  /** Human-readable navigation/node/setting label displayed by the host. */
  label: string
  
  /** Host UI icon identifier for displaying the plugin/navigation item. */
  icon: string
  
/** Numeric navigation sorting order interpreted by the host UI. */
  order: number
  
/** Ordered child navigation links displayed in this group. */
  children: NavigationItem[]
}

/**
 * Optional navigation groups for web and LINE clients.
 * @see {@link PluginRegistry}
 */
export interface TargetNavigationConfig {
  
/** Optional navigation configuration for the browser client. */
  web?: NavigationConfig
  
/** Optional navigation configuration for the LINE client. */
  line?: NavigationConfig
}

/**
 * Plugin table ownership, shared data dependencies, migration order and storage policy metadata.
 * @see {@link PluginRegistry}
 */
export interface SchemaConfig {
  /** Legacy private schema ownership. Shared tables belong to data contracts. */
  ownedTables: string[]
  
/** Optional shared contract IDs mapped to accepted semantic-version ranges. */
  dataContracts?: Record<string, string>
  
/** Referenced table/resource names grouped by owning external component. */
  externalReferences: Record<string, string[]>
  
/** Numeric plugin migration order used by registry sorting; lower values sort first. */
  migrationOrder: number
  /** Physical record table and namespace used when several plugins share a foundation table. */
  storage?: PluginStorageConfig
  /** Required per-plugin payload, object-storage, history and archive policy. */
  storagePolicy: PluginStoragePolicy
}

/**
 * Bind plugin records to a versioned shared table contract and namespace.
 * @see {@link PluginRegistry}
 */
export interface PluginStorageConfig {
  /** Required JSON document IDs in the owning data contract; omitted during explicit legacy adoption. */
  jsonDocuments?: string[]
  
/** Physical table name declared by the owning data contract. */
  table: string
  
/** Logical provider/plugin namespace used to prevent ownership collisions. */
  namespace: string
  
/** Owning shared data-contract identity; not a plugin activation grant. */
  contractId: string
  
  /** Accepted version/range of the shared data contract supplying this record table. */
  version: string
}

/**
 * Describe an optional industry or tenant extension and its private schema ownership.
 * @see {@link PluginRegistry}
 */
export interface PluginExtensionConfig {
  
  /** Host extension identity distinct from the owning plugin ID. */
  id: string
  
  /** Human-readable display name supplied by the plugin/provider catalog; distinct from the stable ID. */
  name: string
  
/** Optional industry classification for an extension. */
  industry?: string
  
  /** JSON Schema defining owned table/document structure; schema declarations do not apply migrations by themselves. */
  schema?: {
    
/** Legacy plugin/extension-owned tables; shared table ownership belongs to data contracts. */
    ownedTables: string[]
    
/** Referenced table/resource names grouped by owning external component. */
    externalReferences?: Record<string, string[]>
  }
}

/**
 * URL prefix used by the host when mounting plugin APIs.
 * @see {@link PluginRegistry}
 */
export interface ApiConfig {
  
  /** API mount path or public API-key lookup prefix; neither value grants authorization. */
  prefix: string
}

/**
 * Build metadata for a host-managed Go handler extension.
 * @see {@link PluginRegistry}
 */
export interface GoExtensionConfig {
  
  /** Topic-keyed callbacks or Go handler names; outbox callbacks resolve without a value after effect completion and must tolerate replay. */
  handlers: string[]
  
/** Host build path for the Go extension container definition. */
  dockerfile: string
}

/**
 * Declare an environment secret needed by a plugin at boot.
 * @see {@link PluginRegistry}
 */
export interface PluginSecretRequirement {
  
  /** Exact environment variable name to resolve; declarations contain names rather than secret values. */
  envKey: string
  
  /** Human-readable metadata describing the capability, workflow node or requirement to host users. */
  description: string
  
  /** Whether an unresolved environment secret must fail validation; resolver calls default to true when the flag is omitted. */
  required: boolean
}

/**
 * Describe one plugin setting field for a host settings UI.
 * @see {@link PluginRegistry}
 */
export interface PluginSettingConfig {
  
  /** Stable setting or procedure-unit lookup key interpreted by the host. */
  key: string
  
  /** Human-readable navigation/node/setting label displayed by the host. */
  label: string
  
  /** Settings UI control kind; select fields use options and secret handling is separately declared. */
  type: 'text' | 'password' | 'boolean' | 'number' | 'select'
  
  /** Human-readable metadata describing the capability, workflow node or requirement to host users. */
  description?: string
  
/** Optional instruction to treat the setting as secret; storage/protection remain host-owned. */
  isSecret?: boolean
  
/** Optional initial setting value when the host has no configured value. */
  defaultValue?: any
  
/** Optional label/value choices for select-type settings. */
  options?: Array<{ 
  /** Human-readable navigation/node/setting label displayed by the host. */
  label: string; 
  
  /** Actual configured value represented by this select option. */
  value: any }>
}

/**
 * Contextual help text and optional navigation/search metadata.
 * @see {@link PluginRegistry}
 */
export interface HelpContextItem {
  
  /** Human-readable draft, task, file or event title displayed by the host. */
  title: string
  
  /** Human-readable review/result description suitable for host presentation. */
  summary: string
  
/** Optional anchor within the associated documentation page. */
  docAnchor?: string
  
/** Optional documentation path used for contextual help navigation. */
  guidePath?: string
  
  /** Optional discovery/search labels carried as metadata. */
  tags?: string[]
}

/**
 * Paths and searchable help metadata for plugin documentation.
 * @see {@link PluginRegistry}
 */
export interface PluginDocConfig {
  
  
  /** Optional host documentation navigation/search category. */
  category?: string
  
/** Optional plugin technical specification path. */
  specPath?: string
  
/** Optional plugin user-guide path. */
  userGuidePath?: string
  
/** Optional plugin maintenance-guide path. */
  maintainerGuidePath?: string
  
/** Context-keyed help entries used for discovery and search. */
  helpContexts?: Record<string, HelpContextItem>
  
/** Optional question/answer entries for host help UI. */
  faq?: Array<{ 
/** User-facing FAQ question text. */
  question: string; 
/** User-facing FAQ answer text. */
  answer: string }>
}

/**
 * Host-executed tool metadata, argument schema and asynchronous handler.
 * @see {@link PluginRegistry}
 */
export interface McpToolDefinition {
  
  /** Exact registered tool identity; parsing/discovery does not authorize its execution. */
  name: string
  
  /** Human-readable metadata describing the capability, workflow node or requirement to host users. */
  description: string
  
/** JSON Schema describing tool arguments; the host validates arguments before execution. */
  parameters: Record<string, any>
  /** Optional versioned meaning used for approval and saved-workflow compatibility checks. */
  contract?: {
    
    /** Version of the tool meaning used for approval/compatibility snapshots. */
    version: string
    
/** Host permission identity required for this operation. */
    permission: string
    
/** Classify whether the operation reads, writes local state or affects an external service. */
    sideEffect: 'read' | 'write' | 'external'
    
/** Optional JSON Schema describing operation output; absent means no output contract is declared here. */
    outputSchema?: Record<string, unknown>
  }
  
  /**
   * Execute an admitted host tool with domain arguments and optional host context.
   * @param args - Decoded tool input; the host must validate parameters before invocation.
   * @param context - Optional verified host scope/capabilities; PluginToolContext is the preferred EAOS host contract.
   * @returns Asynchronous domain result serialized by the host; failures reject.
   * @remarks Host owns live authorization, approval, deadlines, idempotency and side effects.
   * @see {@link PluginRegistry.getMcpTool}
   *
   * @example
   * ```typescript
   * import type { McpToolDefinition, PluginToolContext } from "@alneas/eaos-core/plugin-sdk/types";
   * async function invokeAdmittedTool(tool: McpToolDefinition, args: unknown, context: PluginToolContext) {
   *  return tool.handler(args, context);
   * }
   * ```
   */
  handler: (args: any, context?: any) => Promise<any>
}

/**
 * Verified runtime context supplied by the EAOS MCP host to a plugin tool.
 * @see {@link PluginRegistry}
 */
export interface PluginToolContext {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** User identity within the tenant supplied by the trusted host. */
  userId: string
  
/** Role claims supplied by the host after identity verification. */
  roles: readonly string[]
  
/** Owning plugin identity used for capability scope and discovery. */
  pluginId: string
  
/** Trace correlation identity propagated through host execution and audit paths. */
  traceId: string
  /** Host-scoped providers; absent when the host did not configure one. */
  aiHostAdapters?: AIHostAdapters
  [key: string]: unknown
}

/**
 * Browser-executed tool metadata with an optional local handler.
 * @see {@link PluginRegistry}
 */
export interface WebMcpToolDefinition {
  
  /** Exact registered tool identity; parsing/discovery does not authorize its execution. */
  name: string
  
  /** Human-readable metadata describing the capability, workflow node or requirement to host users. */
  description: string
  
/** JSON Schema describing tool arguments; the host validates arguments before execution. */
  parameters: Record<string, any>
  
/** Marks this definition as a browser-side tool rather than a host MCP handler. */
  clientSide: true
  
  /**
   * Optionally execute the tool in the browser host.
   * @param args - Decoded input validated against parameters by the host before invocation.
   * @returns No value or an asynchronous domain result, depending on the registered handler.
   * @remarks Requires the browser host to bind and authorize execution; model tool metadata is not permission.
   * @see {@link PluginRegistry}
   *
   * @example
   * ```typescript
   * import type { WebMcpToolDefinition } from "@alneas/eaos-core/plugin-sdk/types";
   * async function invokeBrowserTool(tool: WebMcpToolDefinition, validatedArgs: unknown) {
   *  if (!tool.handler) throw new Error("Browser host has not bound this tool");
   *  return tool.handler(validatedArgs);
   * }
   * ```
   */
  handler?: (args: any) => Promise<any> | void
}

/**
 * Risk labels used by approval and execution policies.
 * @see {@link PluginRegistry}
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

/**
 * Role, risk and human-review requirements for one registered tool.
 * @see {@link PluginRegistry}
 */
export interface GatekeeperPolicy {
  /** Optional AI tier setting minimum risk, organizational approval and human review requirements. */
  aiRiskLevel?: AIRiskLevel

  
/** Optional single role or alternatives; matching admin/SUPER_ADMIN roles bypass the named role requirement. */
  requiredRole?: string | string[]
  
/** Declared operation risk used to determine review requirements; it does not itself grant authorization. */
  riskLevel?: RiskLevel
  
/** Whether execution must wait for an explicit host approval workflow. */
  requireHumanApproval?: boolean
}

/**
 * Plugin-advertised agent role, model tier, budget and capability limits.
 * @see {@link PluginRegistry}
 */
export interface ProvidedAgentConfig {
  
  /** Stable advertised agent identity used by the consuming host. */
  id: string
  
  /** Human-readable display name supplied by the plugin/provider catalog; distinct from the stable ID. */
  name: string
  
  
  /** Organizational role advertised for the provided agent. */
  role: 'ceo' | 'executive' | 'manager' | 'worker' | 'red_team'
  
  /** Advertised agent model capability/cost tier; host routing applies actual policy. */
  tierLevel: 'tier1_cloud_premium' | 'tier2_edge_local' | 'tier3_embedding_rerank'
  
/** Highest/declared sensitivity classification accepted by this agent according to host policy. */
  allowedSensitivityLevel: 'level1_public' | 'level2_internal' | 'level3_strict'
  
/** Maximum advertised daily spending allowance in US dollars; accounting/enforcement belongs to the host. */
  dailyBudgetCapUsd: number
  
/** Advertised operation/capability names; presence alone does not authorize execution. */
  capabilities: string[]
  
/** Optional advertised skill identities associated with this agent. */
  skillIds?: string[]
  
/** Explicit tool-name allowlist to enforce at the host execution boundary. */
  allowedToolNames?: string[]
  
/** Optional host policy profile name governing the agent approval path. */
  approvalProfile?: string
}

/**
 * Agent/skill/tool discovery metadata and per-tool policy declarations.
 * @see {@link PluginRegistry}
 */
export interface AgentCapabilitiesConfig {
  
/** Optional agent metadata advertised by the plugin. */
  providedAgents?: ProvidedAgentConfig[]
  /** Runtime-discoverable skill metadata; execution remains bound to MCP/actions. */
  skills?: SkillCatalogEntry[]
  
/** Optional browser-side tools advertised by the plugin. */
  webMcpTools?: WebMcpToolDefinition[]
  
/** Tool-name keyed security policies registered by the host. */
  gatekeeperPolicies?: Record<string, GatekeeperPolicy>
}


/**
 * The ordered set of MCP tools advertised by a plugin.
 * @see {@link PluginRegistry}
 */
export interface McpConfig {
  
  /** Ordered tool definitions used for discovery/compatibility; declaration does not execute them. */
  tools: McpToolDefinition[]
}

/**
 * Locale resources and optional default locale supplied by a plugin.
 * @see {@link PluginRegistry}
 */
export interface PluginI18nConfig {
  
/** Optional default locale chosen by host internationalization integration. */
  defaultLocale?: string
  
/** Locale-keyed translation resources consumed by the host i18n layer. */
  resources: Record<string, Record<string, any>> // { ja: { ... }, en: { ... } }
}

/**
 * Plugin discovery, compatibility, schema, integration and UI metadata consumed by a host.
 * @see {@link PluginRegistry}
 */
export interface PluginManifest {
  /** Explicit commercial policy; hosts must provide live admission for declared policies. */
  entitlement?: import('./entitlements').PluginEntitlement
  
  /** Unique plugin registration identity; used as the registry lookup key. */
  id: string
  
  /** Human-readable display name supplied by the plugin/provider catalog; distinct from the stable ID. */
  name: string
  
  /** Plugin release version used by host discovery and contract snapshots. */
  version: string
  
  /** Human-readable metadata describing the capability, workflow node or requirement to host users. */
  description: string
  
  /** Host UI icon identifier for displaying the plugin/navigation item. */
  icon: string
  
  
  /** Host plugin discovery category. */
  category: string
  
/** Optional host discovery recommendation hint. */
  recommended?: boolean
  
/** Supported client channels advertised by the plugin. */
  targets: ClientTarget[]  // ['web', 'line'], ['line'], ['web'] 等
  
  /** Declared prerequisites; shared data contracts use ID-to-semver ranges and plugin/skill metadata uses identity lists. */
  dependencies: string[]
  
/** Optional plugin dependencies that need not be present for discovery. */
  optionalDependencies?: string[]
  
  /** Commercial entitlement category or model resource tier, interpreted by its owning policy. */
  tier: 'public' | 'standard' | 'pro' | 'corporate' | 'free' | 'premium'
  
/** Industry classifications used by host plugin discovery. */
  industries: string[]
  
  
  /** Host discovery/compatibility labels advertised by this plugin; these do not install shared data contracts. */
  contracts: string[]
  
/** Domain event names the plugin declares it consumes. */
  subscribes: string[]
  
/** Domain event names the plugin declares it emits. */
  publishes: string[]
  
/** Per-client plugin navigation metadata. */
  navigation: TargetNavigationConfig
  
  /** JSON Schema defining owned table/document structure; schema declarations do not apply migrations by themselves. */
  schema: SchemaConfig
  
/** Optional industry/tenant extension definitions. */
  extensions?: PluginExtensionConfig[] // ★ 業界特有・テナント特化サブ拡張
  
  /** API mount metadata or derived backend routing; host renders and enforces these routes. */
  api: ApiConfig
  
  /** Host secret capability or declarations; Core does not provision an external secret store. */
  secrets?: PluginSecretRequirement[]  // 必要とするシークレット宣言
  
/** Optional plugin settings fields exposed to host configuration UI. */
  settings?: PluginSettingConfig[]     // プラグイン設定項目
  
/** Optional host-executed MCP tool catalog. */
  mcp?: McpConfig                      // 自己完結型 MCP ツール定義
  
/** Optional agent/skill/browser-tool discovery metadata and gatekeeper policies. */
  agentCapabilities?: AgentCapabilitiesConfig // Cloudflare OS / WebMCP 思想 Agent Capabilities
  
/** Optional plugin translation resources and default locale. */
  i18n?: PluginI18nConfig              // 自己完結型 多言語リソース定義
  
/** Optional plugin documentation paths and contextual help metadata. */
  docs?: PluginDocConfig
  
/** Optional Go handler build metadata. */
  goExtension?: GoExtensionConfig
  /**
   * Optional host route factory used when mounting backend routes.
   * @param options - Host-specific route construction options; this manifest does not validate their shape.
   * @returns Host router/application value interpreted by the consuming server.
   * @throws Host factory errors propagate to its caller.
   * @remarks Declaring this callback does not mount or authorize routes; the server owns lifecycle and live admission.
   * @see {@link PluginRegistry.register}
   *
   * @example
   * ```typescript
   * import type { PluginManifest } from "@alneas/eaos-core/plugin-sdk/types";
   * function constructHostRoutes(manifest: PluginManifest, hostOptions: unknown) {
   *  if (!manifest.createRoutes) throw new Error("Plugin declares no backend route factory");
   *  return manifest.createRoutes(hostOptions);
   * }
   * ```
   */
  createRoutes?: (options?: any) => any
}
