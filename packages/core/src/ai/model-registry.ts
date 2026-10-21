import type { AIDataSensitivityLevel, AIExecutionContext } from './governance'

/**
 * Capability exposed by a host-controlled model route.
 * @see {@link createAIModelRegistry}
 */
export type AIModelCapability = 'chat' | 'tools' | 'structured-output' | 'embedding' | 'rerank'

/**
 * Public, provider-neutral model metadata.
 *
 * A route contains no endpoint, SDK, credential or provider secret. Those remain
 * host-owned. `adapterId` binds the selected route to the host adapter that will
 * actually execute it, preventing a request from silently switching providers.
 * @see {@link createAIModelRegistry}
 */
export interface AIModelRoute {
  
/** Registered model route identity; unknown selections fail closed in the model registry. */
  modelId: string
  
/** Host adapter identity that binds routing/receipts to the implementation actually used. */
  adapterId: string
  
/** Advertised operation/capability names; presence alone does not authorize execution. */
  capabilities: readonly AIModelCapability[]
  
/** Data classifications the host advertises as permitted on this model/route. */
  allowedSensitivity: readonly AIDataSensitivityLevel[]
  
/** Declared no-training policy requirement; the host must verify and enforce the provider agreement. */
  requiresNoTraining?: boolean
  
/** Optional positive input character ceiling, at most 1000000 when registry-validated. */
  maxInputChars?: number
  
/** Optional positive output character ceiling, at most 1000000 when registry-validated. */
  maxOutputChars?: number
}

/**
 * Execution scope and capability with optional explicit model and sensitivity requirement.
 * @see {@link createAIModelRegistry}
 */
export interface AIModelResolveInput {
  
  /** Verified host execution scope propagated to adapters/guards/hooks; callers must establish identity and authorization before use. */
  context: Pick<AIExecutionContext, 'tenantId' | 'userId' | 'operation'>
  
  /** Required model capability used as a hard route filter. */
  capability: AIModelCapability
  
/** Registered model route identity; unknown selections fail closed in the model registry. */
  modelId?: string
  
/** Classification used by the host to constrain eligible execution routes. */
  sensitivityLevel?: AIDataSensitivityLevel
}

/**
 * List and resolve approved model routes without executing providers.
 * @see {@link createAIModelRegistry}
 */
export interface AIModelRegistry {
  
  /**
   * Return detached copies of every registered model route.
   * @returns A new array with copied routes/capability/sensitivity lists.
   * @remarks The built-in registry does not query provider availability.
   * @example
   * ```typescript
   * import type { AIModelRegistry } from "@alneas/eaos-core/ai/model-registry";
   * function listRoutes(registry: AIModelRegistry) { return registry.list(); }
   * ```
   */
  list(): readonly AIModelRoute[]
  
  /**
   * Resolve an approved route for verified context, capability and optional sensitivity.
   * @param input - Scope and required capability plus optional model ID/sensitivity; omitted model uses the configured default.
   * @returns A detached matching route, never a provider connection.
   * @throws The built-in registry throws Error for invalid context, missing/unknown model or incompatible capability/sensitivity.
   * @remarks The built-in registry checks shape/compatibility; host tenant/user authorization remains separate.
   * @example
   * ```typescript
   * import type { AIModelRegistry } from "@alneas/eaos-core/ai/model-registry";
   * function resolveRoute(registry: AIModelRegistry) { return registry.resolve({ context: { tenantId: "tenant-demo", userId: "user-demo", operation: "preview" }, capability: "chat", sensitivityLevel: "level1_public" }); }
   * ```
   */
  resolve(input: AIModelResolveInput): AIModelRoute
}

/**
 * Approved routes and optional host-selected default route identity.
 * @see {@link createAIModelRegistry}
 */
export interface AIModelRegistryOptions {
  
  /** Approved model/route declarations or synchronous plugin-registration callback; plugin callbacks run once during definePlugin. */
  routes: readonly AIModelRoute[]
  /** Optional host-selected default. Requests cannot select an unregistered route. */
  defaultModelId?: string
}

const SENSITIVITY_LEVELS: readonly AIDataSensitivityLevel[] = ['level1_public', 'level2_internal', 'level3_strict']
const CAPABILITIES: readonly AIModelCapability[] = ['chat', 'tools', 'structured-output', 'embedding', 'rerank']

/**
 * Creates an immutable registry for approved model routes.
 *
 * Tenant and user policy still belongs to the host (`AIModelResolveInput.context`
 * is deliberately passed to the resolver contract). This registry only validates
 * the host's approved route set and fails closed on unknown or incompatible routes.
 * @param options - One to 100 unique routes and an optional registered default model ID; route limits must be positive safe integers up to 1,000,000 characters.
 * @returns A registry whose list/resolve results are fresh route copies; resolution validates capability and any supplied sensitivity level.
 * @throws Error for invalid routes/defaults; resolve throws for invalid context, missing/unknown model or incompatible capability/sensitivity.
 * @remarks No provider calls or authorization checks occur. The host owns tenant/user authorization and must supply sensitivity to enforce that restriction.
 * @example
 * ```typescript
 * import { createAIModelRegistry } from "@alneas/eaos-core/ai/model-registry";
 * const registry = createAIModelRegistry({ routes: [{ modelId: "local-chat", adapterId: "local", capabilities: ["chat"], allowedSensitivity: ["level1_public"] }], defaultModelId: "local-chat" });
 * console.log(registry.resolve({ context: { tenantId: "tenant-demo", userId: "user-demo", operation: "preview" }, capability: "chat" }).modelId);
 * ```
 */
export function createAIModelRegistry(options: AIModelRegistryOptions): AIModelRegistry {
  if (!options || !Array.isArray(options.routes) || options.routes.length === 0 || options.routes.length > 100) throw new Error('At least one AI model route is required')
  const routes = options.routes.map(validateRoute)
  const ids = new Set(routes.map(route => route.modelId))
  if (ids.size !== routes.length) throw new Error('Duplicate AI model route')
  if (options.defaultModelId !== undefined && !ids.has(options.defaultModelId)) throw new Error('Default AI model route is not registered')
  const byId = new Map(routes.map(route => [route.modelId, route]))
  return {
    list: () => routes.map(cloneRoute),
    resolve(input) {
      if (!input?.context || !validContext(input.context) || !CAPABILITIES.includes(input.capability)) throw new Error('Invalid AI model resolution context')
      const modelId = input.modelId ?? options.defaultModelId
      if (!modelId || typeof modelId !== 'string' || !modelId.trim()) throw new Error('AI model route is required')
      const route = byId.get(modelId)
      if (!route) throw new Error('AI model route is not registered')
      if (!route.capabilities.includes(input.capability)) throw new Error('AI model route does not support capability')
      if (input.sensitivityLevel !== undefined && !route.allowedSensitivity.includes(input.sensitivityLevel)) throw new Error('AI model route does not permit sensitivity level')
      return cloneRoute(route)
    },
  }
}

function validateRoute(route: AIModelRoute): AIModelRoute {
  if (!route || typeof route !== 'object' || !validId(route.modelId) || !validId(route.adapterId)) throw new Error('Invalid AI model route')
  if (!Array.isArray(route.capabilities) || !route.capabilities.length || route.capabilities.some(capability => !CAPABILITIES.includes(capability)) || new Set(route.capabilities).size !== route.capabilities.length) throw new Error('Invalid AI model capabilities')
  if (!Array.isArray(route.allowedSensitivity) || !route.allowedSensitivity.length || route.allowedSensitivity.some(level => !SENSITIVITY_LEVELS.includes(level)) || new Set(route.allowedSensitivity).size !== route.allowedSensitivity.length) throw new Error('Invalid AI model sensitivity policy')
  for (const [value, max] of [[route.maxInputChars, 1_000_000], [route.maxOutputChars, 1_000_000]] as const) if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > max)) throw new Error('Invalid AI model route limit')
  return {
    modelId: route.modelId,
    adapterId: route.adapterId,
    capabilities: [...route.capabilities],
    allowedSensitivity: [...route.allowedSensitivity],
    ...(route.requiresNoTraining === undefined ? {} : { requiresNoTraining: route.requiresNoTraining === true }),
    ...(route.maxInputChars === undefined ? {} : { maxInputChars: route.maxInputChars }),
    ...(route.maxOutputChars === undefined ? {} : { maxOutputChars: route.maxOutputChars }),
  }
}

function validId(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 200 }
function validContext(value: Pick<AIExecutionContext, 'tenantId' | 'userId' | 'operation'>): boolean { return [value.tenantId, value.userId, value.operation].every(validId) }
function cloneRoute(route: AIModelRoute): AIModelRoute { return { ...route, capabilities: [...route.capabilities], allowedSensitivity: [...route.allowedSensitivity] } }
