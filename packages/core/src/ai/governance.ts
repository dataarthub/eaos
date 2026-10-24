import type { AIChatMessage, AIChatPart } from '@alneas/appkit-core/ai'

/**
 * AI operational risk tier defining the level of autonomy and Human-in-the-Loop gating.
 *
 * - Level 1: Read-only query, analytics, navigation (Zero risk -> AI immediate execution).
 * - Level 2: Routine draft generation (Medium risk -> AI-to-UI draft + human confirmation).
 * - Level 3: Critical financial / master data mutations (High risk -> AI execution strictly prohibited, advisory/simulation only).
 */
export type AIRiskLevel = 1 | 2 | 3

/**
 * Data classification used to select an approved model route.
 * @see {@link evaluateSkillEligibility}
 */
export type AIDataSensitivityLevel = 'level1_public' | 'level2_internal' | 'level3_strict'

/**
 * Provider-neutral adapter names that a Host may expose to a Skill.
 * @see {@link evaluateSkillEligibility}
 */
export type AIHostAdapterName = 'calendar' | 'email' | 'workspace' | 'travel' | 'browser' | 'messaging' | 'workflow' | 'retrieval'

/**
 * Verified tenant/user operation scope and optional session/model classification.
 * @see {@link evaluateSkillEligibility}
 */
export interface AIExecutionContext {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** User identity within the tenant supplied by the trusted host. */
  userId: string
  
/** Operation identity whose meaning and permission are controlled by the host. */
  operation: string
  
/** Trace correlation identity propagated through host execution and audit paths. */
  traceId: string
  
/** Host session identity used to correlate lifecycle callbacks and operations. */
  sessionId?: string
  
/** Optional model selection metadata associated with this execution scope. */
  model?: string
  
/** Classification used by the host to constrain eligible execution routes. */
  sensitivityLevel?: AIDataSensitivityLevel

/** Operational risk tier governing AI execution autonomy and Human-in-the-Loop gating. */
  riskLevel?: AIRiskLevel
}

/**
 * Execution context, chat messages and tool names evaluated before model execution.
 * @see {@link evaluateSkillEligibility}
 */
export interface AIGuardInput {
  
  /** Verified host execution scope propagated to adapters/guards/hooks; callers must establish identity and authorization before use. */
  context: AIExecutionContext
  
  /** Chat messages evaluated by a host guard, or optional rewritten messages returned by it. */
  messages: readonly AIChatMessage[]
  
/** Tool identities presented to a guard for policy evaluation. */
  toolNames: readonly string[]
}

/**
 * Guard admission decision with optional rewritten messages and classification/redaction data.
 * @see {@link evaluateSkillEligibility}
 */
export interface AIGuardResult {
  
  /** Admission/check decision; consumers must inspect it before using the associated result or performing an effect. */
  allowed: boolean
  
/** Human-readable explanation of the decision or requested action. */
  reason?: string
  
  /** Chat messages evaluated by a host guard, or optional rewritten messages returned by it. */
  messages?: readonly AIChatMessage[]
  
/** Classification used by the host to constrain eligible execution routes. */
  sensitivityLevel?: AIDataSensitivityLevel
  
/** Optional host-produced redaction mapping; may itself contain sensitive source values. */
  redactions?: Readonly<Record<string, string>>
}

/**
 * Optional input/output guard. Implementations belong to the host or an optional package.
 * @see {@link evaluateSkillEligibility}
 */
export interface AIGuard {
  
  /**
   * Evaluate model input before provider execution.
   * @param input - Verified scope, original messages and tool identities to review.
   * @returns Admission data and optional replacement messages/classification/redactions, directly or through a Promise.
   * @throws Guard errors/rejections propagate to its caller.
   * @remarks Optional host policy port; the caller must honor allowed and decide how failures affect execution.
   * @example
   * ```typescript
   * import type { AIGuard } from "@alneas/eaos-core/ai/governance";
   * async function reviewInput(guard: AIGuard, input: Parameters<NonNullable<AIGuard["before"]>>[0]) {
   *  if (!guard.before) throw new Error("Host input guard is unavailable");
   *  return guard.before(input);
   * }
   * ```
   */
  before?(input: AIGuardInput): Promise<AIGuardResult> | AIGuardResult
  
  /**
   * Evaluate a provider message before exposing it to the caller.
   * @param input - Verified execution scope and generated chat message.
   * @returns Admission data and optional host replacements/classification/redactions.
   * @throws Guard errors/rejections propagate to its caller.
   * @remarks Optional host policy port; it does not undo provider calls or already-performed effects.
   * @example
   * ```typescript
   * import type { AIGuard } from "@alneas/eaos-core/ai/governance";
   * async function reviewOutput(guard: AIGuard, input: Parameters<NonNullable<AIGuard["after"]>>[0]) {
   *  if (!guard.after) throw new Error("Host output guard is unavailable");
   *  return guard.after(input);
   * }
   * ```
   */
  after?(input: { 
  /** Verified host execution scope propagated to adapters/guards/hooks; callers must establish identity and authorization before use. */
  context: AIExecutionContext; 
  /** Human-readable provider/failure explanation; do not include secrets in surfaced diagnostics. */
  message: AIChatMessage }): Promise<AIGuardResult> | AIGuardResult
}

/**
 * Provider-reported token counts and optional cost/currency metadata.
 * @see {@link evaluateSkillEligibility}
 */
export interface AIUsage {
  
/** Optional count of tokens consumed as model/runtime input. */
  inputTokens?: number
  
/** Optional count of generated model/runtime tokens. */
  outputTokens?: number
  
/** Optional total token count reported by the provider/runtime. */
  totalTokens?: number
  
/** Optional provider-reported cost in the supplied currency; accounting remains host-owned. */
  cost?: number
  
  /** Currency identifier for reported cost/price; its units are defined by the provider/host contract. */
  currency?: string
}

/**
 * Host budget admission decision with optional throttle/retry guidance.
 * @see {@link evaluateSkillEligibility}
 */
export interface AIBudgetDecision {
  
  /** Admission/check decision; consumers must inspect it before using the associated result or performing an effect. */
  allowed: boolean
  
/** Human-readable explanation of the decision or requested action. */
  reason?: string
  
/** Optional indication that budget/capacity policy temporarily deferred execution. */
  throttled?: boolean
  
/** Optional host guidance for when capacity/budget may be retried, in milliseconds. */
  retryAfterMs?: number
}

/**
 * Budget enforcement is a policy port; Redis/SQL/accounting remain host-owned.
 * @see {@link evaluateSkillEligibility}
 */
export interface AIBudgetGate {
  
  /**
   * Ask host budget policy whether model work may proceed.
   * @param input - Verified scope and optional estimated/reported usage.
   * @returns Admission/throttle/retry guidance, directly or asynchronously.
   * @throws Host policy errors/rejections propagate.
   * @remarks Host owns reservation/accounting, concurrency and enforcement; an allowed decision alone is not a framework reservation.
   * @example
   * ```typescript
   * import type { AIBudgetGate } from "@alneas/eaos-core/ai/governance";
   * async function checkHostBudget(gate: AIBudgetGate, input: Parameters<AIBudgetGate["authorize"]>[0]) { return gate.authorize(input); }
   * ```
   */
  authorize(input: { 
  /** Verified host execution scope propagated to adapters/guards/hooks; callers must establish identity and authorization before use. */
  context: AIExecutionContext; 
  /** Optional token/cost telemetry reported by a host/runtime; absence does not mean zero use. */
  usage?: AIUsage }): Promise<AIBudgetDecision> | AIBudgetDecision
  
  /**
   * Report usage to optional host accounting after execution.
   * @param input - Verified scope and measured/reported usage to record.
   * @returns No value; returned Promise completion means the host accounting callback completed.
   * @throws Host accounting errors/rejections propagate.
   * @remarks Optional host accounting port; retry/deduplication semantics must be defined by the implementation.
   * @example
   * ```typescript
   * import type { AIBudgetGate } from "@alneas/eaos-core/ai/governance";
   * async function recordHostUsage(gate: AIBudgetGate, input: Parameters<NonNullable<AIBudgetGate["recordUsage"]>>[0]) {
   *  if (!gate.recordUsage) throw new Error("Host usage accounting is unavailable");
   *  await gate.recordUsage(input);
   * }
   * ```
   */
  recordUsage?(input: { 
  /** Verified host execution scope propagated to adapters/guards/hooks; callers must establish identity and authorization before use. */
  context: AIExecutionContext; 
  /** Optional token/cost telemetry reported by a host/runtime; absence does not mean zero use. */
  usage: AIUsage }): Promise<void> | void
}

/**
 * Execution lifecycle markers delivered to observability sinks.
 * @see {@link evaluateSkillEligibility}
 */
export type AIObservationPhase = 'started' | 'event' | 'completed' | 'blocked' | 'failed'

/**
 * Contextual execution observation with optional inputs, outputs, usage and errors.
 * @see {@link evaluateSkillEligibility}
 */
export interface AIObservation {
  
  
  /** Lifecycle observation stage: started, event, completed, blocked or failed. */
  phase: AIObservationPhase
  
  /** Verified host execution scope propagated to adapters/guards/hooks; callers must establish identity and authorization before use. */
  context: AIExecutionContext
  
/** Optional provider/runtime event name associated with this observation. */
  eventType?: string
  
  /** Domain request value passed to the admitted operation; no domain-schema proof is implied solely by this type. */
  input?: unknown
  
  /** Optional domain output; validate it separately and inspect the accompanying status/receipt. */
  output?: unknown
  
  /** Optional token/cost telemetry reported by a host/runtime; absence does not mean zero use. */
  usage?: AIUsage
  
/** Optional human-readable failure detail; absence does not independently establish success. */
  error?: string
  
/** Optional host/provider metadata; callers remain responsible for sensitive content and validation. */
  metadata?: Readonly<Record<string, unknown>>
}

/**
 * Observability is deliberately best-effort and must never become a second execution engine.
 * @see {@link evaluateSkillEligibility}
 */
export interface AIObservabilitySink {
  
  /**
   * Deliver one execution observation to host telemetry.
   * @param observation - Execution phase, verified scope and optional result/error/usage metadata; redact sensitive content before delivery.
   * @returns No value; any returned Promise completes when the host telemetry callback completes.
   * @throws Host telemetry errors/rejections are exposed to the direct caller.
   * @remarks Intended as best-effort telemetry; callers decide how to isolate telemetry failures from execution.
   * @example
   * ```typescript
   * import type { AIObservabilitySink } from "@alneas/eaos-core/ai/governance";
   * async function observeHost(sink: AIObservabilitySink, observation: Parameters<AIObservabilitySink["record"]>[0]) { await sink.record(observation); }
   * ```
   */
  record(observation: AIObservation): Promise<void> | void
}

/**
 * Host OS, executable, environment/config-name and adapter prerequisites for a skill.
 * @see {@link evaluateSkillEligibility}
 */
export interface SkillRequirement {
  
/** Executable names that must all be present in trusted host availability. */
  bins?: readonly string[]
  
/** Alternative executable names; at least one must be available when this list is nonempty. */
  anyBins?: readonly string[]
  
/** Required/available environment variable names only; secret values are not stored here. */
  env?: readonly string[]
  
/** Host configuration metadata; plugin/node configuration is data and does not execute code by itself. */
  config?: readonly string[]
  
/** Required/available host capability families used during skill eligibility checks. */
  adapters?: readonly AIHostAdapterName[]
  
/** Supported/current host operating system used by skill eligibility. */
  os?: readonly ('darwin' | 'linux' | 'win32')[]
}

/**
 * Provider-neutral skill metadata. The executable binding remains a plugin action/MCP tool.
 * @see {@link evaluateSkillEligibility}
 */
export interface SkillCatalogEntry {
  
  /** Stable skill discovery identity; omitted document paths use its final dot-separated segment. */
  id: string
  
  /** Human-readable display name supplied by the plugin/provider catalog; distinct from the stable ID. */
  name: string
  
  /** Human-readable metadata describing the capability, workflow node or requirement to host users. */
  description: string
  /** Relative path to the packaged instruction document, resolved by the host loader. */
  documentPath?: string
  
  /** Optional packaged skill version advertised for host discovery. */
  version?: string
  
  
  /** Optional host discovery category for filtering/grouping skills. */
  category?: string
  
  /** Optional discovery/search labels carried as metadata. */
  tags?: readonly string[]
  
/** Discovery phrases or events advertised for skill selection; execution remains action-bound. */
  triggers?: readonly string[]
  
  /** Declared prerequisites; shared data contracts use ID-to-semver ranges and plugin/skill metadata uses identity lists. */
  dependencies?: readonly string[]
  
/** Optional prerequisite declaration used by trusted host availability checks. */
  requirements?: SkillRequirement
  
/** Advertised operation/capability names; presence alone does not authorize execution. */
  capabilities?: readonly string[]
  
/** Host action names a skill may use after normal authorization. */
  actionNames?: readonly string[]
  
/** Named host checks expected before treating the skill result as accepted. */
  verificationGates?: readonly string[]
}

/**
 * Loaded instruction body with its owning plugin, metadata and package-relative path.
 * @see {@link evaluateSkillEligibility}
 */
export interface SkillDocument {
  
/** Owning plugin identity used for capability scope and discovery. */
  pluginId: string
  
  /** Original catalog metadata associated with the loaded/discovered skill. */
  skill: SkillCatalogEntry
  
  /** Host-resolved package-relative instruction document path. */
  path: string
  
  /** Loaded skill instructions, model response text or proposed file content; treat external text as untrusted input. */
  content: string
}

/**
 * Host-owned package/document access; core never reads the filesystem or process state.
 * @see {@link evaluateSkillEligibility}
 */
export interface SkillDocumentLoader {
  
  /**
   * Read a packaged skill document through host-controlled access.
   * @param input - Plugin ID, validated package-relative path and original skill metadata.
   * @returns Instruction text, directly or asynchronously; registry loading rejects blank/nonstring content.
   * @throws Host access/read errors/rejections propagate to the registry/caller.
   * @remarks Host owns safe filesystem/package resolution, access control and resource cleanup; Core reads no filesystem here.
   * @example
   * ```typescript
   * import type { SkillDocumentLoader } from "@alneas/eaos-core/ai/governance";
   * async function loadHostDocument(loader: SkillDocumentLoader, input: Parameters<SkillDocumentLoader["load"]>[0]) { return loader.load(input); }
   * ```
   */
  load(input: { 
/** Owning plugin identity used for capability scope and discovery. */
  pluginId: string; 
  /** Safe relative packaged instruction path supplied by the registry; the loader must prevent resolution escapes. */
  path: string; 
  /** Original catalog metadata associated with the loaded/discovered skill. */
  skill: SkillCatalogEntry }): Promise<string> | string
}

/**
 * Tenant/user-scoped host discovery boundary for skill metadata.
 * @see {@link evaluateSkillEligibility}
 */
export interface SkillCatalog {
  
  /**
   * List skill metadata visible to a verified tenant/user.
   * @param context - Trusted tenant/user identities used by the host discovery implementation.
   * @returns Visible catalog entries, possibly empty.
   * @throws Host discovery failures reject the Promise.
   * @remarks Host owns authorization/discovery sources; catalog metadata does not authorize executing a skill.
   * @example
   * ```typescript
   * import type { SkillCatalog } from "@alneas/eaos-core/ai/governance";
   * async function listHostSkills(catalog: SkillCatalog) { return catalog.list({ tenantId: "tenant-demo", userId: "user-demo" }); }
   * ```
   */
  list(context: Pick<AIExecutionContext, 'tenantId' | 'userId'>): Promise<readonly SkillCatalogEntry[]>
}

/**
 * Keep the import visible in generated declarations for consumers that work with chat parts.
 * @see {@link evaluateSkillEligibility}
 */
export type AITextOrToolPart = Extract<AIChatPart, { 
  /** Chat-part discriminator selecting text, tool-call or tool-result payload fields. */
  type: 'text' | 'tool-call' | 'tool-result' }>

/**
 * Evaluates whether an operation or tool execution is allowed under its AI risk tier.
 *
 * @param riskLevel - Operational risk tier (1: Read-only, 2: Routine draft, 3: Critical mutation).
 * @param options - Execution context options.
 * @returns Evaluation decision indicating whether immediate automated execution is permitted.
 */
export function evaluateAIRiskPolicy(
  riskLevel: AIRiskLevel,
  options?: { isDirectMutation?: boolean; hasHumanConfirmation?: boolean }
): { allowed: boolean; humanConfirmationRequired: boolean; reason?: string } {
  if (riskLevel === 1) {
    return { allowed: true, humanConfirmationRequired: false }
  }
  if (riskLevel === 2) {
    if (options?.isDirectMutation && !options?.hasHumanConfirmation) {
      return {
        allowed: false,
        humanConfirmationRequired: true,
        reason: 'Level 2 operations require human review (AI-to-UI draft pattern) before committing mutations.',
      }
    }
    return { allowed: true, humanConfirmationRequired: false }
  }
  // Level 3: Strictly prohibited from direct AI execution
  return {
    allowed: false,
    humanConfirmationRequired: true,
    reason: 'Level 3 operations are critical and strictly forbid direct AI execution. Operator action via designated UI is required.',
  }
}
