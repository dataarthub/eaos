import { createActionToolBridge, createExecutionSession, type ActionRegistry, type ActionToolDescriptor, type ActionToolBinding, type ActionToolCall } from '@alneas/appkit-core/ai/action'
import type { AIChatAdapter, AIChatMessage, AIChatPart } from '@alneas/appkit-core/ai/ai-chat'
import { createChatClient, type ChatClientOptions } from './chat'
import type { ExecutionPrincipal } from './index'

/** Host-registered Action binding and explicit automatic-execution policy.
 * @see createToolAgent
 */
export interface AgentTool {
 /** Existing Appkit Action/command binding; registration and input/output schemas remain Appkit-owned. */
 binding: ActionToolBinding
 /** Only host-verified read-only actions may run automatically; handoffs remain unexecuted. */
 mode: 'read' | 'handoff'
}
/** Current host policies and limits for a single-flight Appkit execution session.
 * @see createToolAgent
 */
export interface ToolAgentOptions extends Omit<ChatClientOptions, 'tools'> {
 /**
  * Resolve the current host registry and explicit tool execution policy.
  * @param principal - Copied verified tenant/user identity.
  * @returns Existing Action registry and at most 100 read/handoff bindings.
  * @throws Rejects missing host session or registry resolution failures.
  * @example
  * ```typescript
  * import type { ToolAgentOptions } from '@alneas/eaos-server/execution/tool-agent';
  * export function agentSession(resolve: ToolAgentOptions['session']) { return resolve; }
  * ```
  */
 session(principal: ExecutionPrincipal): Promise<{
  /** Existing host-owned Appkit Action registry for this authorized session. */
  registry: ActionRegistry
  /** Explicit read/handoff policy for every disclosed binding. */
  tools: readonly AgentTool[]
 }>
 /**
  * Check current permission to disclose a tool descriptor or result to the model.
  * @param principal - Copied verified actor.
  * @param name - Host-registered tool name.
  * @returns Exactly true permits disclosure; other results deny it.
  * @throws Host policy errors propagate into the execution outcome.
  * @example
  * ```typescript
  * import type { ToolAgentOptions } from '@alneas/eaos-server/execution/tool-agent';
  * export function disclosurePolicy(policy: ToolAgentOptions['disclose']) { return policy; }
  * ```
  */
 disclose(principal: ExecutionPrincipal, name: string): Promise<boolean>
 /**
  * Check exact resource/input permission before execution and before result disclosure.
  * @param principal - Copied verified actor; callback mutation cannot change the trusted identity.
  * @param call - Untrusted model request with correlated ID, name and arguments.
  * @returns Exactly true admits the call; it does not approve a handoff for execution.
  * @throws Host policy errors propagate into the execution outcome.
  * @example
  * ```typescript
  * import type { ToolAgentOptions } from '@alneas/eaos-server/execution/tool-agent';
  * export function callPolicy(policy: ToolAgentOptions['authorizeCall']) { return policy; }
  * ```
  */
 authorizeCall(principal: ExecutionPrincipal, call: ActionToolCall): Promise<boolean>
 /** Maximum model rounds; default 6, allowed integers 1–20. */
 maxRounds?: number
 /** Maximum automatic Action calls per run; default 10, allowed integers 1–100. */
 maxCalls?: number
}
/** Final in-memory conversational outcome, separate from Appkit execution status.
 * @see createToolAgent
 */
export interface ToolAgentResult {
 /** Completed chat, unexecuted handoff, bounded stop, or an Action validation/execution failure. */
 status: 'completed' | 'handoff' | 'limited' | 'tool-error'
 /** Detached correlated chat history, including only authorized projected tool results. */
 messages: AIChatMessage[]
 /** Unexecuted requests; the host must validate them through its existing Action/Proposal review path. */
 pending: ActionToolCall[]
 /** Number of attempted automatic Action calls, including a returned Action failure. */
 callsExecuted: number
}
/**
 * Orchestrate bounded model rounds through existing Appkit Action/Execution and scoped EAOS chat.
 * @param options - Current session/disclosure/call policies, Appkit adapter and chat/round/call limits.
 * @returns Single-flight run, cancel, close and summary subscription methods backed by Appkit ExecutionSession.
 * @throws Invalid policies or round/call limits reject construction. Concurrent/closed runs reject through
 * Appkit; asynchronous authorization/provider failures become failed execution outcomes. Cancellation is
 * cooperative and does not roll back previously completed Action effects.
 * @remarks Only explicitly host-verified read tools execute automatically. A batch containing any handoff
 * returns all its calls without executing them. No durable command engine, approval grant or transaction
 * is created; retained tool-call/result history and descriptors are reauthorized at the exact adapter
 * boundary after chat governance, including caller-supplied history and guard substitutions. Approved writes belong to the host's existing proposal/approval and owning command service.
 * @example
 * ```typescript
 * import { createToolAgent, type ToolAgentOptions } from '@alneas/eaos-server/execution/tool-agent';
 * export function connectAgent(options: ToolAgentOptions) { return createToolAgent(options); }
 * ```
 */
export function createToolAgent(options: ToolAgentOptions) {
 const { session: makeSession, disclose, authorizeCall, authorize } = options
 const maxRounds = options.maxRounds ?? 6, maxCalls = options.maxCalls ?? 10, maxChars = options.maxInputChars ?? 200000
 if (typeof makeSession !== 'function' || typeof disclose !== 'function' || typeof authorizeCall !== 'function' || typeof authorize !== 'function' || !Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > 20 || !Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 100) throw new Error('Agent policy and valid limits required')
 // Snapshot chat settings, while preserving the provider's existing transport implementation.
 const chatOptions = { ...options, parameters: structuredClone(options.parameters), modelAdapters: options.modelAdapters && Object.freeze({...options.modelAdapters}) }
 const execution = createExecutionSession()
 return {
  /**
   * Request cooperative cancellation of the current Appkit execution.
   * @returns No value; Appkit marks active work cancelling without rolling back completed effects.
   * @example
   * ```typescript
   * import { createToolAgent } from '@alneas/eaos-server/execution/tool-agent';
   * export function cancel(agent: ReturnType<typeof createToolAgent>) { return agent.cancel(); }
   * ```
   */
  cancel: () => execution.cancel(),
  /**
   * Read Appkit's summary-only in-memory execution history.
   * @returns Appkit execution summaries; raw model inputs/results are not stored in these summaries.
   * @example
   * ```typescript
   * import { createToolAgent } from '@alneas/eaos-server/execution/tool-agent';
   * export function snapshot(agent: ReturnType<typeof createToolAgent>) { return agent.getSnapshot(); }
   * ```
   */
  getSnapshot: () => execution.getSnapshot(),
  /**
   * Subscribe to Appkit execution summary changes.
   * @param listener - Callback notified when execution state changes; do not expose raw secrets in UI callbacks.
   * @returns Unsubscribe function owned by the subscribing host.
   * @example
   * ```typescript
   * import { createToolAgent } from '@alneas/eaos-server/execution/tool-agent';
   * export function observe(agent: ReturnType<typeof createToolAgent>, listener: () => void) { return agent.subscribe(listener); }
   * ```
   */
  subscribe: (listener: () => void) => execution.subscribe(listener),
  /**
   * Close the Appkit session and request cooperative cancellation.
   * @returns No value; the session no longer admits new runs.
   * @example
   * ```typescript
   * import { createToolAgent } from '@alneas/eaos-server/execution/tool-agent';
   * export function close(agent: ReturnType<typeof createToolAgent>) { agent.close(); }
   * ```
   */
  close: () => execution.close(),
  /**
   * Run a single authorized model/Action conversation.
   * @param principal - Verified current tenant/user identity, copied before host callbacks.
   * @param input - Detached initial messages and optional cooperative cancellation signal.
   * @returns Appkit execution outcome containing a ToolAgentResult on success; failed/cancelled outcomes omit it.
   * @throws Appkit rejects concurrent or closed session admission; run failures otherwise become outcomes.
   * @example
   * ```typescript
   * import { createToolAgent } from '@alneas/eaos-server/execution/tool-agent';
   * export function run(agent: ReturnType<typeof createToolAgent>, ...args: Parameters<typeof agent.run>) { return agent.run(...args); }
   * ```
   */
  async run(principal: ExecutionPrincipal, input: { messages: readonly AIChatMessage[]; signal?: AbortSignal }) {
   const p = structuredClone(principal), messages = structuredClone(input.messages) as AIChatMessage[]
   return execution.run('AI tool session', async context => {
    const externalAbort = () => execution.cancel()
    input.signal?.addEventListener('abort', externalAbort, { once: true })
    if (input.signal?.aborted) externalAbort()
    let bridge: ReturnType<typeof createActionToolBridge> | undefined
    let callsExecuted = 0
    const check = async () => {
     if (context.signal.aborted) throw new DOMException('Agent cancelled', 'AbortError')
     if (!p || [p.tenantId, p.userId].some(v => typeof v !== 'string' || !v.trim()) || await authorize(structuredClone(p), 'model:chat') !== true) throw new Error('Agent access denied')
     if (context.signal.aborted) throw new DOMException('Agent cancelled', 'AbortError')
     if (!Array.isArray(messages) || !messages.length || messages.length > 1000 || JSON.stringify(messages).length > maxChars) throw new Error('Agent history limit')
    }
    const allowed = async (call: ActionToolCall) => {
     await check()
     if (await disclose(structuredClone(p), call.name) !== true || await authorizeCall(structuredClone(p), structuredClone(call)) !== true) throw new Error('Agent tool access denied')
     await check()
    }
    const result = (status: ToolAgentResult['status'], pending: ActionToolCall[] = []): ToolAgentResult => ({ status, messages: structuredClone(messages), pending: structuredClone(pending), callsExecuted })
    try {
     await check()
     const session = await makeSession(structuredClone(p))
     await check()
     if (!Array.isArray(session.tools) || session.tools.length > 100 || session.tools.some(tool => !['read', 'handoff'].includes(tool.mode))) throw new Error('Invalid agent tool policy')
     const modes = new Map(session.tools.map(tool => [tool.binding.name, tool.mode]))
     const registrations = new Map(session.tools.filter(tool => tool.binding.kind === 'action').map(tool => {
      const binding = tool.binding as Extract<ActionToolBinding, { kind: 'action' }>
      return [binding.name, { id: binding.actionId, action: session.registry.getAction(binding.actionId) }]
     }))
     bridge = createActionToolBridge(session.registry, { tools: session.tools.map(tool => tool.binding), maxCalls })
     const activeBridge = bridge
     const authorizeHistory = async (history: readonly AIChatMessage[]) => {
      const prior = new Map<string, ActionToolCall>(), results = new Set<string>()
      for (const message of history) for (const part of message.parts) {
       if (part.type === 'tool-call') {
        if (prior.has(part.callId) || !modes.has(part.name)) throw new Error('Agent retained tool history is invalid')
        const call = {callId:part.callId,name:part.name,arguments:part.input}
        prior.set(call.callId,call)
        await allowed(call)
       } else if (part.type === 'tool-result') {
        const call = prior.get(part.callId)
        if (!call || call.name !== part.name || results.has(part.callId)) throw new Error('Agent retained tool result has no unique authorized call')
        results.add(part.callId)
        await allowed(call)
       }
      }
     }
     // A policy decorator checks the exact final request, including host-guard substitutions.
     // The existing Appkit adapter still owns transport, encoding and parsing.
     const authorizeAdapter = (transport: AIChatAdapter): AIChatAdapter => ({
      id:transport.id,capabilities:transport.capabilities,
      async *stream(request) {
       for (const descriptor of request.tools ?? []) {
        if (!modes.has(descriptor.name) || await disclose(structuredClone(p),descriptor.name) !== true) throw new Error('Agent tool descriptor disclosure denied')
       }
       await check()
       await authorizeHistory(request.messages)
       request.signal?.throwIfAborted()
       yield* transport.stream(request)
      },
     })
     const chat = createChatClient({ ...chatOptions,
      authorize:async (actor,operation) => {
       if (await authorize(actor,operation) !== true) return false
       await authorizeHistory(messages)
       return true
      },
      adapter:authorizeAdapter(chatOptions.adapter),
      ...(chatOptions.modelAdapters ? {modelAdapters:Object.fromEntries(Object.entries(chatOptions.modelAdapters).map(([model,adapter])=>[model,authorizeAdapter(adapter)]))} : {}),
      tools: async () => {
       const tools: ActionToolDescriptor[] = []
       for (const tool of activeBridge.listTools()) if (await disclose(structuredClone(p), tool.name) === true) tools.push(tool)
       return tools
      },
     })
     for (let round = 0; round < maxRounds; round++) {
      await check()
      const answer = await chat.complete(p, { messages, signal: context.signal, tools: 'catalog' })
      messages.push(answer.message)
      await check()
      if (answer.finishReason === 'stop') return result('completed')
      const calls = answer.message.parts.filter((part): part is Extract<AIChatPart, { type: 'tool-call' }> => part.type === 'tool-call').map(part => ({ callId: part.callId, name: part.name, arguments: part.input }))
      for (const call of calls) await allowed(call)
      if (calls.some(call => modes.get(call.name) === 'handoff')) return result('handoff', calls)
      if (callsExecuted + calls.length > maxCalls || round + 1 === maxRounds) return result('limited', calls)
      for (let index = 0; index < calls.length; index++) {
       const call = calls[index]
       await allowed(call)
       const registration = registrations.get(call.name)
       if (registration && session.registry.getAction(registration.id) !== registration.action) throw new Error('Agent action registration changed')
       const output = await activeBridge.execute(call, context)
       callsExecuted++
       await allowed(call)
       messages.push({ id: crypto.randomUUID(), role: 'tool', parts: [{ type: 'tool-result', callId: call.callId, name: call.name, output: output.ok ? output.data : { code: output.code, error: output.error }, ...(!output.ok ? { isError: true } : {}) }] })
       await check()
       context.reportProgress({ completed: callsExecuted, total: maxCalls })
       if (!output.ok) return result('tool-error', calls.slice(index + 1))
      }
     }
     return result('limited')
    } finally { bridge?.close(); input.signal?.removeEventListener('abort', externalAbort) }
   })
  },
 }
}
