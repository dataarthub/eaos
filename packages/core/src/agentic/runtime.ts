/**
 * Agentic Runtime & Hook Lifecycle Engine
 * Inspired by Cloudflare OS and AIWorker Architecture.
 */

import type { DatabaseAdapter } from '../db/adapter'
import type { RiskLevel } from '../plugin-sdk/types'

/**
 * Lifecycle hook names recognized by the agent runtime.
 * @see {@link AgentRuntime}
 */
export type HookType = 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'Stop'

/**
 * Host-provided tenant/user/session scope for tool hook execution.
 * @see {@link AgentRuntime}
 */
export interface AgentExecutionContext {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** User identity within the tenant supplied by the trusted host. */
  userId: string
  
/** Host session identity used to correlate lifecycle callbacks and operations. */
  sessionId: string
  
/** Trace correlation identity propagated through host execution and audit paths. */
  traceId: string
  
  /** Verified host role claims passed to gatekeeper/runtime evaluation. */
  userRoles: string[]
  
/** Optional host/provider metadata; callers remain responsible for sensitive content and validation. */
  metadata?: Record<string, unknown>
}

/**
 * Tool arguments and scope passed sequentially to pre-execution hooks.
 * @see {@link AgentRuntime}
 */
export interface PreToolHookPayload {
  
/** Registered tool identity used to resolve host execution policy. */
  toolName: string
  
  /** Operation arguments passed to hooks or bound into a proposed action; authorization and schema checks remain host-owned. */
  args: Record<string, unknown>
  
  /** Verified host execution scope propagated to adapters/guards/hooks; callers must establish identity and authorization before use. */
  context: AgentExecutionContext
}

/**
 * Hook admission result with optional argument replacement and review metadata.
 * @see {@link AgentRuntime}
 */
export interface PreToolHookResult {
  
/** Whether a pre-tool hook permits the next hook/executor to run. */
  proceed: boolean
  
/** Optional complete replacement argument object passed to later hooks and the executor. */
  modifiedArgs?: Record<string, unknown>
  
/** Optional human-readable explanation when the hook stops execution. */
  blockingReason?: string
  
/** Whether execution must wait for an explicit host approval workflow. */
  requireHumanApproval?: boolean
  
/** Declared operation risk used to determine review requirements; it does not itself grant authorization. */
  riskLevel?: RiskLevel
}

/**
 * Completed tool output, executed arguments and measured duration for observers.
 * @see {@link AgentRuntime}
 */
export interface PostToolHookPayload {
  
/** Registered tool identity used to resolve host execution policy. */
  toolName: string
  
  /** Operation arguments passed to hooks or bound into a proposed action; authorization and schema checks remain host-owned. */
  args: Record<string, unknown>
  
  
  /** Resolved executor output passed by reference to post-tool observers. */
  result: unknown
  
/** Measured elapsed duration in milliseconds. */
  durationMs: number
  
  /** Verified host execution scope propagated to adapters/guards/hooks; callers must establish identity and authorization before use. */
  context: AgentExecutionContext
}

/**
 * Session identity and optional host metadata for startup hooks.
 * @see {@link AgentRuntime}
 */
export interface SessionHookPayload {
  
/** Host session identity used to correlate lifecycle callbacks and operations. */
  sessionId: string
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** User identity within the tenant supplied by the trusted host. */
  userId: string
  
/** Optional host/provider metadata; callers remain responsible for sensitive content and validation. */
  metadata?: Record<string, unknown>
}

/**
 * Stopped session trajectory and host-reported success for cleanup hooks.
 * @see {@link AgentRuntime}
 */
export interface StopHookPayload {
  
/** Host session identity used to correlate lifecycle callbacks and operations. */
  sessionId: string
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** User identity within the tenant supplied by the trusted host. */
  userId: string
  
  /** Session turns supplied for lifecycle/extraction; sensitive content handling remains host-owned. */
  history: Array<{ 
  
  /** Host conversation-speaker label associated with this history turn. */
  role: string; 
  /** Loaded skill instructions, model response text or proposed file content; treat external text as untrusted input. */
  content: string; 
  
  /** Host-recorded turn timestamp carried to stop observers. */
  timestamp: string }>
  
  /** Reported completion flag; inspect status/receipt and reconcile any uncertain side effects before retrying. */
  success: boolean
}

/**
 * Ordered admission callback that may replace arguments or stop execution.
 * @see {@link AgentRuntime}
 * @param payload - Current tool name, possibly rewritten arguments and verified execution scope, passed before the executor.
 * @returns Admission decision directly or asynchronously; proceed false stops dispatch and modifiedArgs replaces the entire argument object. Throws/rejections propagate.
 * @example
 * ```typescript
 * import type { PreToolHookHandler } from "@alneas/eaos-core/agentic/runtime";
 * const hook: PreToolHookHandler = () => ({ proceed: true });
 * ```
 */
export type PreToolHookHandler = (payload: PreToolHookPayload) => Promise<PreToolHookResult> | PreToolHookResult
/**
 * Observer invoked after tool execution; its returned Promise is not awaited.
 * @see {@link AgentRuntime}
 * @param payload - Completed executor output, final arguments, scope and elapsed milliseconds.
 * @returns No value, or a Promise for observer completion. AgentRuntime does not await returned Promises and logs rejections; synchronous throws can turn its result into BLOCKED after an effect ran.
 * @example
 * ```typescript
 * import type { PostToolHookHandler } from "@alneas/eaos-core/agentic/runtime";
 * const hook: PostToolHookHandler = payload => { console.log(payload.durationMs); };
 * ```
 */
export type PostToolHookHandler = (payload: PostToolHookPayload) => Promise<void> | void
/**
 * Startup callback awaited in registration order with failures logged.
 * @see {@link AgentRuntime}
 * @param payload - Host session identity and optional metadata supplied to onSessionStart.
 * @returns No value, or a Promise for startup completion; AgentRuntime awaits hooks sequentially and logs failures.
 * @example
 * ```typescript
 * import type { SessionStartHookHandler } from "@alneas/eaos-core/agentic/runtime";
 * const hook: SessionStartHookHandler = payload => { console.log(payload.sessionId); };
 * ```
 */
export type SessionStartHookHandler = (payload: SessionHookPayload) => Promise<void> | void
/**
 * Stop callback awaited in registration order with failures logged.
 * @see {@link AgentRuntime}
 * @param payload - Host session history and reported success supplied to onStop.
 * @returns No value, or a Promise for cleanup completion; AgentRuntime awaits hooks sequentially and logs failures.
 * @example
 * ```typescript
 * import type { StopHookHandler } from "@alneas/eaos-core/agentic/runtime";
 * const hook: StopHookHandler = payload => { console.log(payload.success); };
 * ```
 */
export type StopHookHandler = (payload: StopHookPayload) => Promise<void> | void

/**
 * Sequence admission hooks around a tool executor and dispatch lifecycle observers.
 * @remarks Registers a heuristic secret scanner first. This is not comprehensive secret detection or host authorization. State is process-local; no unregister API, persistence, cancellation or retry is supplied. Session/stop failures are logged; post-tool Promises are not awaited. The optional database adapter is currently unused.
 *
 * @example
 * ```typescript
 * import { AgentRuntime } from "@alneas/eaos-core/agentic/runtime";
 * const runtime = new AgentRuntime();
 * const context = { tenantId: "tenant-demo", userId: "user-demo", sessionId: "session-1", traceId: "trace-1", userRoles: ["member"] };
 * console.log(await runtime.executeTool("notes.preview", {}, context, async () => ({ count: 0 })));
 * ```
 */
export class AgentRuntime {
  private preToolHooks: PreToolHookHandler[] = []
  private postToolHooks: PostToolHookHandler[] = []
  private sessionStartHooks: SessionStartHookHandler[] = []
  private stopHooks: StopHookHandler[] = []

  /**
   * Initialize hook lists and register the built-in argument secret scanner.
   * @param dbAdapter - Optional database adapter retained by the instance; not used by current execution methods.
   *
   * @example
   * ```typescript
   * import { AgentRuntime } from "@alneas/eaos-core/agentic/runtime";
   * const runtime = new AgentRuntime();
   * console.log(runtime);
   * ```
   */
  constructor(private dbAdapter?: DatabaseAdapter) {
    // Register built-in secretguard by default
    this.registerPreToolHook(this.builtInSecretScanner)
  }

  /**
   * Append a blocking admission hook.
   * @param handler - Called sequentially with current arguments and verified context before execution. Return proceed false to stop; modifiedArgs replaces arguments for subsequent hooks. Throws/rejections propagate.
   * @returns No value; callback is retained until this runtime is discarded.
   * @example
   * ```typescript
   * import { AgentRuntime } from "@alneas/eaos-core/agentic/runtime";
   * const runtime = new AgentRuntime();
   * runtime.registerPreToolHook(() => ({ proceed: true }));
   * ```
   */
  registerPreToolHook(handler: PreToolHookHandler): void {
    this.preToolHooks.push(handler)
  }

  /**
   * Append a completion observer.
   * @param handler - Called after executor resolves with output and elapsed milliseconds. Returned Promises are not awaited and rejections are logged; a synchronous throw is caught by executeTool and converts its result to BLOCKED even if the effect already ran.
   * @returns No value; callback is retained until this runtime is discarded.
   * @example
   * ```typescript
   * import { AgentRuntime } from "@alneas/eaos-core/agentic/runtime";
   * const runtime = new AgentRuntime();
   * runtime.registerPostToolHook(payload => { console.log(payload.durationMs); });
   * ```
   */
  registerPostToolHook(handler: PostToolHookHandler): void {
    this.postToolHooks.push(handler)
  }

  /**
   * Append a session startup hook.
   * @param handler - Called sequentially by onSessionStart with session identity/metadata; returns no value and failures are logged.
   * @returns No value; callback is retained until this runtime is discarded.
   * @example
   * ```typescript
   * import { AgentRuntime } from "@alneas/eaos-core/agentic/runtime";
   * const runtime = new AgentRuntime();
   * runtime.registerSessionStartHook(payload => { console.log(payload.sessionId); });
   * ```
   */
  registerSessionStartHook(handler: SessionStartHookHandler): void {
    this.sessionStartHooks.push(handler)
  }

  /**
   * Append a session stop hook.
   * @param handler - Called sequentially by onStop with session history and reported success; returns no value and failures are logged.
   * @returns No value; callback is retained until this runtime is discarded.
   * @example
   * ```typescript
   * import { AgentRuntime } from "@alneas/eaos-core/agentic/runtime";
   * const runtime = new AgentRuntime();
   * runtime.registerStopHook(payload => { console.log(payload.success); });
   * ```
   */
  registerStopHook(handler: StopHookHandler): void {
    this.stopHooks.push(handler)
  }

  /**
   * Await startup hooks in registration order and log their failures.
   * @param payload - Session scope and lifecycle data passed by reference to each hook.
   * @returns No value; all registered hooks have been awaited, including those that failed.
   * @remarks No retry or cancellation is supplied; hook errors are logged and do not stop later hooks.
   * @example
   * ```typescript
   * import { AgentRuntime } from "@alneas/eaos-core/agentic/runtime";
   * const runtime = new AgentRuntime();
   * await runtime.onSessionStart({ sessionId: "session-1", tenantId: "tenant-demo", userId: "user-demo" });
   * ```
   */
  async onSessionStart(payload: SessionHookPayload): Promise<void> {
    for (const hook of this.sessionStartHooks) {
      try {
        await hook(payload)
      } catch (err) {
        console.warn(`[AgentRuntime] SessionStart hook failed: ${(err as Error).message}`)
      }
    }
  }

  /**
   * Run ordered admission hooks, then the executor and completion observers.
   * @typeParam T - Resolved executor output type retained in successful result data; defaults to unknown.
   * @param toolName - Tool identifier supplied to hooks.
   * @param rawArgs - Arguments shallow-copied before hooks; nested values remain shared.
   * @param context - Verified host scope passed unchanged to hooks.
   * @param executor - Called once only if hooks proceed, with final arguments; resolves the domain result. Executor throws/rejections become BLOCKED data.
   * @returns COMPLETED with result, or BLOCKED/PENDING_APPROVAL with error and optional risk. Does not wait for asynchronous post hooks.
   * @throws Pre-tool hook throws/rejections propagate, including JSON serialization errors from the built-in scanner.
   * @remarks No authorization/approval is granted by COMPLETED. A synchronous post hook can report BLOCKED after the executor has already produced side effects; reconcile before retrying. No cancellation, timeout, persistence or retry is implemented.
   * @example
   * ```typescript
   * import { AgentRuntime } from "@alneas/eaos-core/agentic/runtime";
   * const runtime = new AgentRuntime();
   * const context = { tenantId: "tenant-demo", userId: "user-demo", sessionId: "session-1", traceId: "trace-1", userRoles: ["member"] };
   * console.log(await runtime.executeTool("notes.preview", {}, context, async () => ({ count: 0 })));
   * ```
   */
  async executeTool<T = unknown>(
    toolName: string,
    rawArgs: Record<string, unknown>,
    context: AgentExecutionContext,
    executor: (args: Record<string, unknown>) => Promise<T>
  ): Promise<{
    
    /** Reported completion flag; inspect status/receipt and reconcile any uncertain side effects before retrying. */
    success: boolean
    
    
  /** Optional executor result present when the returned status is COMPLETED. */
  result?: T
    
/** Optional human-readable failure detail; absence does not independently establish success. */
    error?: string
    
    /** COMPLETED after executor/initial post dispatch, BLOCKED for denied/executor failure, or PENDING_APPROVAL when a hook requests review. */
    status: 'COMPLETED' | 'BLOCKED' | 'PENDING_APPROVAL'
    
/** Declared operation risk used to determine review requirements; it does not itself grant authorization. */
    riskLevel?: RiskLevel
  }> {
    let currentArgs = { ...rawArgs }

    // 1. Run PreTool Hooks (Blocking)
    for (const hook of this.preToolHooks) {
      const hookResult = await hook({ toolName, args: currentArgs, context })
      if (!hookResult.proceed) {
        return {
          success: false,
          status: hookResult.requireHumanApproval ? 'PENDING_APPROVAL' : 'BLOCKED',
          error: hookResult.blockingReason ?? 'Blocked by runtime pre-tool hook',
          riskLevel: hookResult.riskLevel ?? 'high',
        }
      }
      if (hookResult.modifiedArgs) {
        currentArgs = hookResult.modifiedArgs
      }
    }

    // 2. Execute Tool Handler
    const startTime = Date.now()
    try {
      const result = await executor(currentArgs)
      const durationMs = Date.now() - startTime

      // 3. Run PostTool Hooks (Async non-blocking)
      const postPayload: PostToolHookPayload = {
        toolName,
        args: currentArgs,
        result,
        durationMs,
        context,
      }

      for (const hook of this.postToolHooks) {
        Promise.resolve(hook(postPayload)).catch((err) => {
          console.warn(`[AgentRuntime] PostTool hook error: ${(err as Error).message}`)
        })
      }

      return {
        success: true,
        result,
        status: 'COMPLETED',
      }
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
        status: 'BLOCKED',
      }
    }
  }

  /**
   * Await stop hooks in registration order and log their failures.
   * @param payload - Session scope and lifecycle data passed by reference to each hook.
   * @returns No value; all registered hooks have been awaited, including those that failed.
   * @remarks No retry or cancellation is supplied; hook errors are logged and do not stop later hooks.
   * @example
   * ```typescript
   * import { AgentRuntime } from "@alneas/eaos-core/agentic/runtime";
   * const runtime = new AgentRuntime();
   * await runtime.onStop({ sessionId: "session-1", tenantId: "tenant-demo", userId: "user-demo", history: [], success: true });
   * ```
   */
  async onStop(payload: StopHookPayload): Promise<void> {
    for (const hook of this.stopHooks) {
      try {
        await hook(payload)
      } catch (err) {
        console.warn(`[AgentRuntime] Stop hook failed: ${(err as Error).message}`)
      }
    }
  }

  /**
   * Default Built-in Secret Scanner PreTool Hook
   */
  private builtInSecretScanner: PreToolHookHandler = ({ args }) => {
    const serialized = JSON.stringify(args)
    // Basic high-entropy secret patterns (AWS, Bearer Tokens, Private Keys, Database Passwords)
    const secretPatterns = [
      /AKIA[0-9A-Z]{16}/,
      /bearer\s+[a-zA-Z0-9_\-.]{20,}/i,
      /-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----/,
      /(password|secret|apikey|api_key)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    ]

    for (const pattern of secretPatterns) {
      if (pattern.test(serialized)) {
        return {
          proceed: false,
          blockingReason: `Potential plaintext secret detected in tool arguments. Execution blocked.`,
          riskLevel: 'critical',
        }
      }
    }

    return { proceed: true }
  }
}
