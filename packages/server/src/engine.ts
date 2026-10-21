import { resolveLifecycleBackend, createLifecycleGuard, type LifecycleRuntime } from './lifecycle/index'
import { createMcpRouter, type McpRouterOptions } from './mcp'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PluginRegistry } from '@alneas/eaos-core'
import { McpGatekeeper } from '@alneas/eaos-core'
import { SecretResolver } from '@alneas/eaos-core'
import { createModuleGuard } from './middleware/module-guard'
import { createAuthMiddleware, type AuthSessionVerifier } from './middleware/auth'
import { createErrorHandler } from './middleware/error-handler'
import type { PluginManifest } from '@alneas/eaos-core'
import type { EaosEnv } from '@alneas/eaos-core'
import { createHealthRouter, type HealthRouterOptions } from './health/index'
import { createPluginEntitlementGuard, resolveEngineEntitlementPrincipal, type PluginEntitlementRuntime, type EntitlementPrincipalResolver } from './entitlements/index'

// ---------- Config 型 ----------

/**
 * Engine composition settings retained by {@link ErpEngine}; host adapters own authentication and persistence.
 */
export interface EaosConfig {
  /** Nonblank application label used by public health responses. */
  appName: string
  /** Trusted plugin manifests registered sequentially during initialize. */
  plugins: PluginManifest[]
  /** Optional host UI theme metadata retained in config; the server engine does not apply it. */
  theme?: {
    /** Optional host UI accent color; not interpreted by this engine. */
    primaryColor?: string
    /** Optional host UI logo URL; not fetched by this engine. */
    logoUrl?: string
  }
  /** Optional host driver metadata retained in config; this engine does not create a database connection. */
  database?: {
    /** Selected host database dialect; does not create or migrate a connection. */
    driver: 'oracle' | 'supabase' | 'postgres'
  }
  /** Optional exact browser allowOrigins list; empty/absent disables CORS middleware. */
  cors?: {
    /** Exact allowed browser origins; credentials are enabled for configured CORS. */
    allowOrigins: string[]
  }
  /** Optional verifier and skipped path prefixes; see AuthMiddlewareOptions. */
  auth?: {
    /** Optional verified session/API-key adapter; omission installs no authentication. */
    verifier?: AuthSessionVerifier
    /** Authentication-exempt path prefixes; defaults follow createAuthMiddleware. */
    skipPaths?: string[]
  }
  /** Validate each manifest's declared secrets unless exactly false. Defaults to true. */
  validateSecrets?: boolean
  /** Host composition callbacks invoked synchronously after shared authentication and before plugin route guards; each receives the app and returns no value. */
  middleware?: Array<(app: Hono<EaosEnv>) => void>
}

/**
 * Returns an engine configuration unchanged while checking its TypeScript shape.
 * @param config - Configuration to retain; no runtime validation or cloning occurs.
 * @returns The same object reference.
 * @example
 * ```typescript
 * import { defineConfig } from "@alneas/eaos-server/engine";
 * const config = defineConfig({ appName: "example-service", plugins: [] });
 * console.log(config.appName);
 * ```
 */
export function defineConfig(config: EaosConfig): EaosConfig {
  return config
}

// ---------- Engine ----------

/**
 * Per-application host authorization, route, and health adapters for {@link ErpEngine.createApp}.
 */
export interface CreateAppOptions {
  /** Optional shared runtime for declared commercial/usage entitlement admission. */
  entitlements?: PluginEntitlementRuntime
  /** Optional verified principal resolver; defaults to resolveEngineEntitlementPrincipal. */
  resolveEntitlementPrincipal?: EntitlementPrincipalResolver
  /** Optional current lifecycle/tenant/backend admission for plugin routes and MCP tools. */
  lifecycle?: LifecycleRuntime
  /** Optional module middleware factory called at composition for each plugin/extension requirement; defaults to createModuleGuard. */
  requireModule?: (moduleId: string) => any
  /** Optional authentication verifier overriding config.auth.verifier. */
  verifier?: AuthSessionVerifier
  /** Install module guards unless exactly false. Defaults to true. */
  enableModuleGuard?: boolean
  /** Per-plugin dependencies passed to the route factory. */
  pluginOptions?: Record<string, unknown>
  /** Optional MCP adapter configuration; prefix defaults to /api/mcp and shared entitlements take precedence. */
  mcp?: McpRouterOptions & { 
  /**
   * Optional mount path for the shared MCP router; defaults to /api/mcp when the engine composes routes.
   */
  prefix?: string }
  /** Additional host routers mounted after plugin/MCP routes; no plugin-specific guard is automatically added. */
  customRoutes?: Array<{
    /** Host-selected mount prefix passed directly to Hono route composition; this entry receives no automatic plugin/module-specific guard. */
    prefix: string
    /** Trusted Hono child router; host composition must install its route-specific authorization before exposing handlers. */
    router: Hono<any>
  }>
  /** Optional dependency readiness checks and clock; engine appName is supplied automatically. */
  health?: Omit<HealthRouterOptions, 'appName'>
}

/**
 * Registers plugin manifests and composes Hono routes with host authentication, entitlement, and lifecycle adapters.
 * @remarks Constructing the engine creates no HTTP listener or persistent store. Initialize once before composing apps. Configuration is retained by reference. Authentication is installed only when a verifier is supplied; custom routes need their own authorization policies beyond the shared middleware.
 * @example
 * ```typescript
 * import { createErpEngine } from "@alneas/eaos-server/engine";
 * const engine = createErpEngine({ appName: "example-service", plugins: [] });
 * await engine.initialize();
 * const app = engine.createApp();
 * console.log((await app.request("/health/live")).status); // 200
 * ```
 */
export class ErpEngine {
  /** Public plugin registry populated during initialize; external mutation affects subsequently composed apps. */
  readonly registry = new PluginRegistry()
  /** Shared MCP policy registry populated from plugin manifests during initialize. */
  readonly gatekeeper = new McpGatekeeper()
  private initialized = false
  private config: EaosConfig

  /**
   * Retains host composition configuration for registration and future app creation.
   * @param config - App label, plugin manifests, and optional host composition settings.
   */
  constructor(config: EaosConfig) {
    this.config = config
  }

  /**
   * Registers manifests and gatekeeper policies and validates declared plugin secrets by default.
   * @returns No value; resolves after registration and validation, or immediately after a prior successful initialization.
   * @throws Rejects duplicate plugin IDs, registry failures, or secret validation failures.
   * @remarks Registration occurs before secret validation, so failure can leave partial registry state. Concurrent initialization is not serialized and retrying a failed initialization may encounter already-registered IDs. Create a new engine after correcting failed setup. No migrations or plugin activation are performed.
   * @example
   * ```typescript
   * import { createErpEngine } from "@alneas/eaos-server/engine";
   * const engine = createErpEngine({ appName: "example-service", plugins: [] });
   * await engine.initialize();
   * console.log(engine.getRegisteredPlugins().length); // 0
   * ```
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    console.log(`[ErpEngine] Initializing ${this.config.appName}...`)

    for (const manifest of this.config.plugins) {
      if (this.registry.get(manifest.id)) throw new Error(`Duplicate plugin: ${manifest.id}`)
      this.registry.register(manifest)

      if (manifest.agentCapabilities?.gatekeeperPolicies) {
        for (const [toolName, policy] of Object.entries(
          manifest.agentCapabilities.gatekeeperPolicies
        )) {
          this.gatekeeper.registerPolicy(toolName, policy)
        }
      }

      if (
        this.config.validateSecrets !== false &&
        manifest.secrets &&
        manifest.secrets.length > 0
      ) {
        await SecretResolver.validatePluginSecrets(manifest.id, manifest.secrets)
      }
    }

    this.initialized = true
    console.log(
      `[ErpEngine] Successfully loaded ${this.registry.getAll().length} plugins.`
    )
  }

  /**
   * Composes registered plugin routes, shared middleware, optional MCP/custom routes, and public health endpoints.
   * @param options - Live host adapters and route settings; see {@link CreateAppOptions}.
   * @returns A new Hono app sharing this engine registry, gatekeeper, and configured adapters; it does not start a server.
   * @throws Before initialization, or for synchronous middleware, plugin route factory, or health setup failures. Request-time adapter errors pass through the app error handler.
   * @remarks Module guarding defaults on. Lifecycle enforcement is installed only when supplied, while declared plugin entitlements require their corresponding runtime checks. CORS uses configured origins with credentials enabled; unknown origins receive the first configured allow-origin value. Repeated calls create separate routers but may reuse host dependencies.
   * @example
   * ```typescript
   * import { createErpEngine } from "@alneas/eaos-server/engine";
   * const engine = createErpEngine({ appName: "example-service", plugins: [] });
   * await engine.initialize();
   * const app = engine.createApp();
   * console.log((await app.request("/health/live")).status);
   * ```
   */
  createApp(options?: CreateAppOptions): Hono<EaosEnv> {
    if (!this.initialized) throw new Error("Call initialize() before createApp()")
    const app = new Hono<EaosEnv>()

    // 1. エラーハンドラ登録
    app.onError(createErrorHandler())

    // 2. CORS
    if (this.config.cors?.allowOrigins && this.config.cors.allowOrigins.length > 0) {
      const allowed = this.config.cors.allowOrigins
      app.use(
        '*',
        cors({
          origin: (origin) =>
            allowed.includes(origin) ? origin : allowed[0],
          allowMethods: ['POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
          credentials: true,
        })
      )
    }

    // 3. 認証ミドルウェア (Ory Kratos / API Key / Bearer)
    const verifier = options?.verifier || this.config.auth?.verifier
    if (verifier) {
      app.use('*', createAuthMiddleware({ verifier, skipPaths: this.config.auth?.skipPaths }))
    }

    // 4. Config 層から注入された独自ミドルウェア
    if (this.config.middleware) {
      for (const mw of this.config.middleware) {
        mw(app)
      }
    }

    // 5. Plugin 層のルートを動的マウント & ライセンス認可ガード (requireModule)
    for (const plugin of this.registry.getAll()) {
      if (plugin.entitlement?.allowedTenants) {
        const conceal = async (c: any, next: () => Promise<void>) => {
          const principal = await (options?.resolveEntitlementPrincipal ?? resolveEngineEntitlementPrincipal)(c)
          if (!principal) return c.json({ error: 'Unauthorized' }, 401)
          if (!plugin.entitlement!.allowedTenants!.includes(principal.tenantId)) return c.json({ error: 'Plugin unavailable' }, 404)
          await next()
        }
        app.use(`${plugin.api.prefix}/*`, conceal)
      }
      if (options?.lifecycle) {
        const guard = createLifecycleGuard(options.lifecycle, plugin.id)
        app.use(plugin.api.prefix, guard)
        app.use(`${plugin.api.prefix}/*`, guard)
      }
      if (options?.enableModuleGuard !== false) {
        const guard = options?.requireModule ? options.requireModule(plugin.id) : createModuleGuard(plugin.id)
        app.use(`${plugin.api.prefix}/*`, guard)

        if (plugin.extensions) {
          for (const ext of plugin.extensions) {
            const requiredKey = ext.industry ? `industry_${ext.industry}` : ext.id
            const extGuard = options?.requireModule ? options.requireModule(requiredKey) : createModuleGuard(requiredKey)
            app.use(`${plugin.api.prefix}/${ext.id}/*`, extGuard)
          }
        }
      }

      if (plugin.entitlement) {
        const guard = createPluginEntitlementGuard(plugin.id, plugin.entitlement, options?.entitlements, options?.resolveEntitlementPrincipal)
        app.use(`${plugin.api.prefix}/*`, guard)
      }
      if (plugin.createRoutes) {
        app.route(plugin.api.prefix, plugin.createRoutes(options?.pluginOptions?.[plugin.id]))
      }
    }

    if (options?.mcp) app.route(options.mcp.prefix ?? '/api/mcp', createMcpRouter(this, {
      ...options.mcp,
      entitlements: options.entitlements ?? options.mcp.entitlements,
      isPluginEnabled: async (principal, id) =>
        (!options.lifecycle || await options.lifecycle.lifecycle.isEnabled(await resolveLifecycleBackend(options.lifecycle, principal.tenantId), principal.tenantId, id)) &&
        (!options.mcp?.isPluginEnabled || await options.mcp.isPluginEnabled(principal, id)),
    }))

    // 6. カスタムルートのマウント
    if (options?.customRoutes) {
      for (const { prefix, router } of options.customRoutes) {
        app.route(prefix, router)
      }
    }

    // 7. Liveness/readiness. Dependency checks are explicit host adapters.
    app.route('/', createHealthRouter({ appName: this.config.appName, ...options?.health }))

    return app
  }

  /**
   * Reads the manifests currently registered in this engine.
   * @returns Registry manifest list, empty before registration or with no configured plugins; objects are not deep-cloned by this method.
   * @example
   * ```typescript
   * import { createErpEngine } from "@alneas/eaos-server/engine";
   * const engine = createErpEngine({ appName: "example-service", plugins: [] });
   * await engine.initialize();
   * console.log(engine.getRegisteredPlugins()); // []
   * ```
   */
  getRegisteredPlugins(): PluginManifest[] {
    return this.registry.getAll()
  }

  /**
   * Collects MCP tool definitions from all currently registered manifests.
   * @returns Registry tool definitions, or an empty array when none exist; this list is not filtered for a request principal or tenant.
   * @example
   * ```typescript
   * import { createErpEngine } from "@alneas/eaos-server/engine";
   * const engine = createErpEngine({ appName: "example-service", plugins: [] });
   * await engine.initialize();
   * console.log(engine.getAllMcpTools()); // []
   * ```
   */
  getAllMcpTools() {
    return this.registry.getAllMcpTools()
  }

  /**
   * Reads the host configuration retained at construction.
   * @returns The original mutable configuration object; no cloning occurs.
   * @example
   * ```typescript
   * import { createErpEngine } from "@alneas/eaos-server/engine";
   * const engine = createErpEngine({ appName: "example-service", plugins: [] });
   * await engine.initialize();
   * console.log(engine.getConfig().appName);
   * ```
   */
  getConfig(): EaosConfig {
    return this.config
  }
}

/**
 * Creates an uninitialized engine retaining the supplied host configuration.
 * @param config - Engine composition settings; see {@link EaosConfig}.
 * @returns A new engine; await initialize before createApp.
 * @example
 * ```typescript
 * import { createErpEngine } from "@alneas/eaos-server/engine";
 * const engine = createErpEngine({ appName: "example-service", plugins: [] });
 * await engine.initialize();
 * const app = engine.createApp();
 * console.log((await app.request("/health/live")).status);
 * ```
 */
export function createErpEngine(config: EaosConfig): ErpEngine {
  return new ErpEngine(config)
}
