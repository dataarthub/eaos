import type { AIChatAdapter, AIChatMessage, AIChatPart, AIChatEvent } from '@alneas/appkit-core/ai/ai-chat'
import type { ActionToolDescriptor, ActionToolObject } from '@alneas/appkit-core/ai/action'
import type { AIBudgetGate, AIGuard, AIExecutionContext, AIModelRegistry, AIObservabilitySink, AIUsage } from '@alneas/eaos-core'
import type { ExecutionPolicy, ExecutionPrincipal } from './index'

/** Host-injected model guards, usage budgets and telemetry.
 * @see createChatClient
 */
export interface ChatGovernanceOptions {
 /** Optional pre-input and post-output checks; replacement messages remain host-owned. */
 guard?: AIGuard
 /** Optional request admission and once-per-started-attempt accounting; accounting failures propagate. */
 budget?: AIBudgetGate
 /** Awaited started/event/completed telemetry within the deadline; sink errors are ignored. */
 observability?: AIObservabilitySink
 /** Telemetry operation label; authorization always checks model:chat. */
 operation?: string
 /** Host-selected registry model ID; without a registry this is metadata, not provider selection. */
 model?: string
 /** Optional host session identity recorded in governance context. */
 sessionId?: string
}
/** Host-configured adapter, current admission and bounded chat policy.
 * @see createChatClient
 */
export interface ChatClientOptions extends ExecutionPolicy {
 /** Existing Appkit transport configured with the host endpoint, model and credentials. */
 adapter: AIChatAdapter
 /** Host-owned provider parameters cloned at creation; model/messages/tools/stream keys are reserved and rejected. */
 parameters?: ActionToolObject
 /**
  * Resolve descriptors only when the caller explicitly requests tools: catalog.
  * @param principal - Copied verified actor whose current disclosure permission the host must check.
  * @returns At most 100 unique descriptors; omission advertises no tools.
  * @throws Host resolution failures reject completion before the provider starts.
  * @example
  * ```typescript
  * import type { ChatClientOptions } from '@alneas/eaos-server/execution/chat';
  * export function disclosedTools(resolve: NonNullable<ChatClientOptions['tools']>) { return resolve; }
  * ```
  */
 tools?(principal: ExecutionPrincipal): Promise<readonly ActionToolDescriptor[]>
 /** Positive integer deadline in milliseconds; default 30000, maximum 3600000. */
 timeoutMs?: number
 /** Serialized request character ceiling; default 200000, maximum 7000000. */
 maxInputChars?: number
 /** Serialized event and final assistant-message character ceiling; default 100000, maximum 10000000. */
 maxOutputChars?: number
 /** Maximum stream event count; default 10000, maximum 100000. */
 maxEvents?: number
 /** Host-approved route registry; requests cannot select a model or bypass sensitivity limits. */
 modelRegistry?: AIModelRegistry
 /** Required with modelRegistry: host-approved logical model to configured adapter bindings, snapshotted at creation. */
 modelAdapters?: Readonly<Record<string, AIChatAdapter>>
 /** Optional host guards, budgets and telemetry; final current authorization follows their completion. */
 governance?: ChatGovernanceOptions
}
/** Completed assistant message and optional host-governance metadata.
 * @see createChatClient
 */
export interface ChatCompletion {
 /** Detached assistant response; tool-call parts are unexecuted requests. */
 message: AIChatMessage
 /** Successful provider finish reason; truncated or inconsistent streams reject. */
 finishReason: 'stop' | 'tool-calls'
 /** Unique request trace identity generated before governance callbacks. */
 traceId?: string
 /** Recognized nonnegative adapter metadata; undefined means unknown, including Appkit OpenAI SSE without usage events. */
 usage?: AIUsage
 /** Sensitivity label supplied by the input guard. */
 sensitivityLevel?: AIExecutionContext['sensitivityLevel']
}
/**
 * Complete scoped chat through the existing Appkit adapter with live admission and host governance.
 * @param options - Trusted adapter, current authorization, optional routes/governance and bounded limits.
 * @returns A client whose complete method returns detached, finally authorized assistant data.
 * @throws Rejects invalid limits or missing adapter/policy during construction. Completion rejects
 * invalid histories/catalogs, denied or revoked admission, guard/budget/route denial, provider failures,
 * incomplete streams, exceeded limits, cancellation, deadline expiry and host accounting failure. Telemetry errors are ignored.
 * @remarks Every completion authorizes model:chat before disclosure, between events and after awaited
 * output guard, usage recording and completion telemetry. This client never executes model tool calls.
 * The host must configure real endpoint credentials in the Appkit adapter. Abort is cooperative for a
 * custom transport; the request promise remains bounded even if its iterator ignores cancellation.
 * With modelRegistry, provide modelAdapters mapping each approved logical model to its host-configured
 * Appkit adapter; generic adapter IDs alone do not select or prove the provider model. Binding entries
 * and stream methods are snapshotted at creation. Reserved transport parameters are rejected in 0.2.
 * Accounting runs once after each started adapter attempt, including output blocks, revocation and provider
 * failure. Unknown usage is passed as undefined, never zero. Appkit's OpenAI SSE adapter currently emits
 * no usage metadata event even for provider include_usage chunks; hosts must reconcile measured usage
 * through their existing accounting port using trace/session context. Accounting callback errors reject
 * completion in 0.2; a stalled callback remains bounded by the request deadline.
 * @example
 * ```typescript
 * import { createChatClient, type ChatClientOptions } from '@alneas/eaos-server/execution/chat';
 * export function connectChat(options: ChatClientOptions) { return createChatClient(options); }
 * ```
 */
export function createChatClient(options: ChatClientOptions) {
 const adapter = options.adapter, authorize = options.authorize, tools = options.tools
 const parameters = structuredClone(options.parameters), governance = options.governance, registry = options.modelRegistry
 const modelAdapters = Object.freeze(Object.fromEntries(Object.entries(options.modelAdapters ?? {}).map(([model,transport]) => {
  if (typeof transport?.stream !== 'function') throw new Error('Invalid AI model adapter binding')
  return [model,Object.freeze({id:transport.id,capabilities:Object.freeze({...transport.capabilities}),stream:transport.stream.bind(transport)})]
 })))
 if (registry && !options.modelAdapters) throw new Error('AI model adapter bindings required')
 if (parameters !== undefined && (!parameters || typeof parameters !== 'object' || Array.isArray(parameters) || Object.keys(parameters).some(key => ['model','messages','tools','stream'].includes(key)))) throw new Error('Invalid or reserved chat parameters')
 const timeout = options.timeoutMs ?? 30000, maxInput = options.maxInputChars ?? 200000, maxOutput = options.maxOutputChars ?? 100000, maxEvents = options.maxEvents ?? 10000
 for (const [value, max] of [[timeout,3600000],[maxInput,7000000],[maxOutput,10000000],[maxEvents,100000]] as const) if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('Invalid chat limit')
 if (typeof adapter?.stream !== 'function' || typeof authorize !== 'function' || tools !== undefined && typeof tools !== 'function') throw new Error('Chat adapter and authorization required')
 return {
  /**
   * Request one bounded completion for the current actor.
   * @param principal - Verified nonblank tenant/user identity; copied before invoking host callbacks.
   * @param input - One to 1000 messages, optional cancellation, and explicit none/catalog tool disclosure.
   * @returns Assistant data only after final live authorization; tools remain unexecuted requests.
   * @throws Rejects invalid requests, governance/provider failure, revocation, limits or cancellation.
   * @example
   * ```typescript
   * import { createChatClient } from '@alneas/eaos-server/execution/chat';
   * export function complete(client: ReturnType<typeof createChatClient>, ...args: Parameters<typeof client.complete>) {
   *   return client.complete(...args);
   * }
   * ```
   */
  async complete(principal: ExecutionPrincipal, input: { messages: readonly AIChatMessage[]; signal?: AbortSignal; tools?: 'none' | 'catalog' }): Promise<ChatCompletion> {
   const p = structuredClone(principal)
   if (!p || [p.tenantId,p.userId].some(v => typeof v !== 'string' || !v.trim())) throw new Error('Chat access denied')
   if (!Array.isArray(input?.messages) || !input.messages.length || input.messages.length > 1000 || Object.keys(input).some(k => !['messages','signal','tools'].includes(k)) || input.tools !== undefined && !['none','catalog'].includes(input.tools)) throw new Error('Invalid chat history or options')
   let messages: AIChatMessage[] = structuredClone(input.messages) as AIChatMessage[]
   const toolMode = input.tools, traceId = crypto.randomUUID()
   let sensitivityLevel: AIExecutionContext['sensitivityLevel'], usage: AIUsage | undefined, selectedModelId: string | undefined
   let attemptStarted = false, usageRecord: Promise<void> | undefined
   const context = (): AIExecutionContext => ({ tenantId: p.tenantId, userId: p.userId, operation: governance?.operation ?? 'model:chat', traceId, ...(governance?.sessionId ? { sessionId: governance.sessionId } : {}), ...((selectedModelId ?? governance?.model) ? { model: selectedModelId ?? governance?.model } : {}), ...(sensitivityLevel ? { sensitivityLevel } : {}) })
   const observe = async (phase: Parameters<AIObservabilitySink['record']>[0]['phase'], extra: Omit<Parameters<AIObservabilitySink['record']>[0], 'phase' | 'context'> = {}) => {
    try { await governance?.observability?.record({ phase, context: context(), ...extra }) } catch { /* Telemetry is best-effort within the request deadline. */ }
   }
   const controller = new AbortController(); let iterator: AsyncIterator<AIChatEvent> | undefined, timer: ReturnType<typeof setTimeout> | undefined
   const abort = () => controller.abort()
   input.signal?.addEventListener('abort', abort, { once: true })
   if (input.signal?.aborted) abort()
   const check = () => { if (controller.signal.aborted) throw new Error('Chat cancelled or timed out') }
   const allow = async () => { check(); if (await authorize(structuredClone(p), 'model:chat') !== true) throw new Error('Chat access denied'); check() }
   const recordAttemptUsage = (): Promise<void> => {
    if (!attemptStarted || !governance?.budget?.recordUsage) return Promise.resolve()
    return usageRecord ??= Promise.resolve().then(() => governance.budget!.recordUsage!({context:context(),usage:usage && structuredClone(usage)}))
   }
   const work = async (): Promise<ChatCompletion> => {
    await allow()
    const catalog = toolMode === 'catalog' ? structuredClone(await tools?.(structuredClone(p)) ?? []) : []
    await allow()
    if (catalog.length > 100 || new Set(catalog.map(t => t.name)).size !== catalog.length) throw new Error('Invalid chat tool catalog')
    if (JSON.stringify({ messages, tools: catalog, parameters }).length > maxInput) throw new Error('Chat input limit')
    if (governance?.guard?.before) {
     const guarded = await governance.guard.before({ context: context(), messages, toolNames: catalog.map(tool => tool.name) })
     if (!guarded.allowed) throw new Error(`Chat blocked${guarded.reason ? `: ${guarded.reason}` : ''}`)
    if (guarded.messages !== undefined) messages = structuredClone(guarded.messages) as AIChatMessage[]
    sensitivityLevel = guarded.sensitivityLevel
   }
    await allow()
    const route = registry?.resolve({ context: context(), capability: 'chat', ...(governance?.model ? { modelId: governance.model } : {}), ...(sensitivityLevel ? { sensitivityLevel } : {}) })
    let selectedAdapter = adapter
    if (route) {
     selectedModelId = route.modelId
     if (!Object.hasOwn(modelAdapters,route.modelId) || typeof modelAdapters[route.modelId]?.stream !== 'function') throw new Error('AI model adapter binding missing')
     selectedAdapter = modelAdapters[route.modelId]
     if (selectedAdapter.id !== route.adapterId) throw new Error('AI model adapter does not match the approved route')
     if (toolMode === 'catalog' && !route.capabilities.includes('tools')) throw new Error('AI model route does not support tools')
    }
    if (catalog.length && !selectedAdapter.capabilities.tools) throw new Error('Invalid chat tool catalog')
    const inputLimit = Math.min(maxInput, route?.maxInputChars ?? maxInput), outputLimit = Math.min(maxOutput, route?.maxOutputChars ?? maxOutput)
    if (JSON.stringify({ messages, tools: catalog, parameters }).length > inputLimit) throw new Error('Chat input limit')
    await allow()
    if (governance?.budget) {
     const decision = await governance.budget.authorize({ context: context() })
     if (!decision.allowed) throw new Error(`Chat budget denied${decision.reason ? `: ${decision.reason}` : ''}`)
    }
    await allow()
    await observe('started', { input: { messageCount: messages.length, toolCount: catalog.length }, metadata: { adapter: selectedAdapter.id, ...(route ? { modelId: route.modelId } : {}) } })
    await allow()
    attemptStarted = true
    iterator = selectedAdapter.stream({ messages, ...(catalog.length ? { tools: catalog } : {}), parameters: structuredClone(parameters), signal: controller.signal })[Symbol.asyncIterator]()
    const parts: AIChatPart[] = [], calls = new Set<string>(), names = new Set(catalog.map(t => t.name))
    let size = 0, events = 0
    while (true) {
     check()
     const next = await iterator.next(); check()
     if (next.done) throw new Error('Chat stream ended without completion')
     await allow()
     const event = next.value
     await observe('event', { eventType: event.type })
     if (++events > maxEvents || (size += JSON.stringify(event).length) > outputLimit) throw new Error('Chat output limit')
     if (event.type === 'metadata') usage = mergeUsage(usage, readUsage(event.metadata))
     if (event.type === 'finish') {
      if (!['stop','tool-calls'].includes(event.reason) || (event.reason === 'tool-calls') !== (calls.size > 0)) throw new Error('Chat response incomplete or inconsistent')
      let message: AIChatMessage = { id: crypto.randomUUID(), role: 'assistant', parts }
      if (governance?.guard?.after) {
       const guarded = await governance.guard.after({ context: context(), message })
       if (!guarded.allowed) throw new Error(`Chat output blocked${guarded.reason ? `: ${guarded.reason}` : ''}`)
       if (guarded.messages !== undefined) {
        if (guarded.messages.length !== 1) throw new Error('Chat output guard returned invalid message count')
        message = structuredClone(guarded.messages[0])
       }
      }
      if (JSON.stringify(message).length > outputLimit) throw new Error('Chat output limit after guard')
      await allow()
      return { message, finishReason: event.reason as ChatCompletion['finishReason'], traceId, usage, sensitivityLevel }
     }
     if (event.type === 'text-delta') {
      if (typeof event.text !== 'string') throw new Error('Invalid chat text')
      const previous = parts.at(-1)
      if (previous?.type === 'text') parts[parts.length - 1] = { type: 'text', text: previous.text + event.text }
      else parts.push({ type: 'text', text: event.text })
     } else if (event.type === 'tool-call') {
      if (!names.has(event.name) || typeof event.callId !== 'string' || !event.callId.trim() || calls.has(event.callId) || calls.size >= 100 || !event.input || typeof event.input !== 'object' || Array.isArray(event.input)) throw new Error('Invalid or unregistered chat tool call')
      calls.add(event.callId); parts.push(structuredClone(event))
     } else if (event.type === 'data') parts.push(structuredClone(event))
     else if (event.type !== 'metadata') throw new Error('Unexpected chat event')
    }
   }
   let rejectAbort: (() => void) | undefined
   const stopped = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new Error('Chat cancelled or timed out'))
    controller.signal.addEventListener('abort', rejectAbort, { once: true })
    if (controller.signal.aborted) rejectAbort()
    timer = setTimeout(abort, timeout)
   })
   const accountedWork = async () => {
    let result: ChatCompletion
    try { result = await work() }
    catch (error) { await recordAttemptUsage(); throw error }
    await recordAttemptUsage()
    await allow()
    await observe('completed', {output:result.message,usage})
    await allow()
    return result
   }
   try { return await Promise.race([accountedWork(), stopped]) }
   catch (error) {
    let failure = error
    // A deadline can win while a started provider/output guard is pending. Account that attempt once.
    try { await Promise.race([recordAttemptUsage(),stopped]) }
    catch (accountingError) { if (!controller.signal.aborted) failure = accountingError }
    void observe('failed', { error: failure instanceof Error ? failure.message : String(failure), usage })
    throw failure
   }
   finally {
    clearTimeout(timer); input.signal?.removeEventListener('abort', abort)
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort)
    controller.abort()
    try { void Promise.resolve(iterator?.return?.()).catch(() => {}) } catch { /* Preserve the original outcome. */ }
   }
  },
 }
}

function readUsage(value: unknown): AIUsage | undefined {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
 const record = value as Record<string, unknown>, raw = record.usage && typeof record.usage === 'object' && !Array.isArray(record.usage) ? record.usage as Record<string, unknown> : record
 const inputTokens = number(raw.inputTokens ?? raw.promptTokens ?? raw.input_tokens), outputTokens = number(raw.outputTokens ?? raw.completionTokens ?? raw.output_tokens), totalTokens = number(raw.totalTokens ?? raw.total_tokens), cost = number(raw.cost), currency = typeof raw.currency === 'string' ? raw.currency : undefined
 if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined && cost === undefined) return undefined
 return { ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }), ...(totalTokens === undefined ? {} : { totalTokens }), ...(cost === undefined ? {} : { cost }), ...(currency ? { currency } : {}) }
}

function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined }
function mergeUsage(previous: AIUsage | undefined, next: AIUsage | undefined): AIUsage | undefined { return next ? { ...(previous ?? {}), ...next } : previous }
