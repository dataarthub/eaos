import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import Ajv from 'ajv'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { EntitlementError, requiresEntitlementRuntime, type PluginEntitlementRuntime } from './entitlements/index'
import type { AIExecutionContext, AIHostAdapters, McpGatekeeper, PluginRegistry, McpToolDefinition, PluginManifest } from '@alneas/eaos-core'

/**
 * Host-verified identity, roles, and enabled plugins used for MCP discovery and execution.
 * @see createMcpRouter.
 */
export interface McpPrincipal {
  /** Nonblank authenticated user identifier. */
  userId: string
  /** Nonblank authorized tenant identifier. */
  tenantId: string
  /** Verified role strings passed to the gatekeeper; an empty array is permitted. */
  roles: string[]
  /** Exact installed plugin IDs, resolved from the server's current tenant configuration. */
  enabledPluginIds: string[]
}
/**
 * Shared registry and policy/audit service used by {@link createMcpRouter}.
 */
export interface McpRuntime {
  /** Registry supplying trusted manifests and executable tool handlers. Duplicate tool names fail discovery/execution. */
  registry: PluginRegistry
  /** Current permission/approval policy and audit sink consulted for tool discovery and calls. */
  gatekeeper: McpGatekeeper
}
/**
 * Live host authorization, resource injection, and bounded SSE-session settings for {@link createMcpRouter}.
 */
export interface McpRouterOptions {
  /** Runtime for declared commercial/usage entitlements; required by plugins whose rules need external entitlement checks. */
  entitlements?: PluginEntitlementRuntime
  /** Additional current lifecycle gate; called on discovery and immediately before execution. */
  isPluginEnabled?: (principal: McpPrincipal, pluginId: string) => Promise<boolean>
  /** Must verify authentication, tenant membership and enabled plugins on every request. */
  resolvePrincipal: (context: Context) => Promise<McpPrincipal | null>
  /** Optional binding for a tenant-dedicated backend. */
  tenantId?: string
  /** Inject already tenant-scoped resources; never pass an unrestricted administrative DB. */
  createToolContext?: (principal: McpPrincipal, pluginId: string) => Promise<Record<string, unknown>>
  /** Resolve provider-neutral AI adapters after live authorization; the result is injected into the verified tool context. */
  resolveAIHostAdapters?: (input: {
  /**
   * Verified current request principal after membership and enabled-plugin resolution.
   */
  principal: McpPrincipal;
  /**
   * Owning plugin whose admitted tool needs host AI adapters.
   */
  pluginId: string;
  /**
   * Exact registered MCP tool name being executed.
   */
  toolName: string;
  /**
   * Verified AI execution identity, operation mcp:toolName, and generated trace ID; no client scope overrides are accepted here.
   */
  context: AIExecutionContext }) => Promise<AIHostAdapters | undefined>
  /** Operational errors only; request bodies/credentials are not passed. */
  onError?: (error: unknown) => void
  /** Maximum SSE session age and inactivity in milliseconds; finite values are floored and clamped to at least 1000. Defaults to 1800000 for absent/nonfinite input. */
  sseSessionTtlMs?: number
  /** Per-router SSE session capacity; finite values are floored and clamped to at least 1. Defaults to 1000 for absent/nonfinite input. */
  maxSseSessions?: number
}

/**
 * Creates authenticated MCP tool discovery/execution routes and an SSE JSON-RPC transport.
 * @param runtime - Trusted plugin/tool registry and gatekeeper with audit behavior.
 * @param options - Host principal verification, current lifecycle/entitlement checks, scoped dependencies, AI adapters, and SSE limits.
 * @returns A Hono router exposing GET /tools, POST /execute, GET /sse, and POST /message; no network listener is started.
 * @throws Router construction can propagate validator setup errors. Request-time callback, schema compilation, tool, or audit errors are passed to onError and normally rendered as a generic 500; a throwing onError can itself fail error handling.
 * @remarks Every request resolves current identity and enabled plugins. Tool discovery hides unavailable tools; calls validate arguments, recheck lifecycle before execution, and perform entitlement admission. Human-approval requirements return pending data without executing the handler; no client approval flag bypasses this. Request bodies are limited to 1 MiB. Host callbacks must supply tenant-scoped resources and enforce real membership and lifecycle checks; the router does not open databases or persist results. SSE session state is process-local, owner-bound, capacity-limited, and removed on stream cancellation or lazy expiry checks. Expiry removes the mapping without explicitly closing the existing stream; no heartbeat or cross-process session sharing is provided. Tool failures may occur after side effects, so retry/idempotency remains host-owned.
 * @example
 * ```typescript
 * import { createMcpRouter, type McpRuntime, type McpRouterOptions } from "@alneas/eaos-server/mcp";
 * export function mcpRoutes(runtime: McpRuntime, options: McpRouterOptions) {
 *   // options.resolvePrincipal must verify live identity, membership, and enabled plugins.
 *   // Supply only tenant-scoped resources through createToolContext.
 *   return createMcpRouter(runtime, options);
 * }
 * ```
 */
export function createMcpRouter(runtime: McpRuntime, options: McpRouterOptions): Hono {
  const router = new Hono()
  const ajv = new Ajv({ strict: false, allErrors: true })
  const ajv2020 = new Ajv2020({ strict: false, allErrors: true })
  addFormats(ajv); addFormats(ajv2020)
  const entitled = async (p: McpPrincipal, id: string) => {
    const rule = runtime.registry.get(id)?.entitlement
    return !rule || !requiresEntitlementRuntime(rule) || !!options.entitlements && (await options.entitlements.check(p, id, rule)).allowed
  }
  const admit = async (p: McpPrincipal, plugin: PluginManifest, operation: string) => {
    if (!plugin.entitlement || !requiresEntitlementRuntime(plugin.entitlement)) return
    if (!options.entitlements) throw Error('Entitlement service unavailable')
    await options.entitlements.admit(p, plugin.id, plugin.entitlement, operation)
  }
  const preview = async (p: McpPrincipal, plugin: PluginManifest) => {
    if (!plugin.entitlement || !requiresEntitlementRuntime(plugin.entitlement)) return null
    if (!options.entitlements) return { status: 503 as const, error: 'Entitlement service unavailable' }
    const decision = await options.entitlements.check(p, plugin.id, plugin.entitlement)
    return decision.allowed ? null : { status: decision.status, error: decision.reason }
  }
  router.use('*', bodyLimit({ maxSize: 1024 * 1024 }))
  router.onError((error, c) => {
    options.onError?.(error)
    return c.json({ error: 'MCP request failed' }, 500)
  })

  function tools(): Array<{ plugin: PluginManifest; tool: McpToolDefinition }> {
    const names = new Set<string>()
    return runtime.registry.getAll().flatMap(plugin => (plugin.mcp?.tools ?? []).map(tool => {
      if (names.has(tool.name)) throw new Error(`Duplicate MCP tool name: ${tool.name}`)
      names.add(tool.name)
      return { plugin, tool }
    }))
  }

  async function resolveAIAdapters(principal: McpPrincipal, pluginId: string, toolName: string, traceId: string): Promise<AIHostAdapters | undefined> {
    if (!options.resolveAIHostAdapters) return undefined
    return options.resolveAIHostAdapters({
      principal,
      pluginId,
      toolName,
      context: { tenantId: principal.tenantId, userId: principal.userId, operation: `mcp:${toolName}`, traceId },
    })
  }

  async function principal(c: Context): Promise<McpPrincipal | null> {
    const p = await options.resolvePrincipal(c)
    if (!p || typeof p.userId !== 'string' || !p.userId.trim() || typeof p.tenantId !== 'string' || !p.tenantId.trim()
      || !Array.isArray(p.roles) || !p.roles.every(v => typeof v === 'string')
      || !Array.isArray(p.enabledPluginIds) || !p.enabledPluginIds.every(v => typeof v === 'string')) return null
    if (options.tenantId && p.tenantId !== options.tenantId) return null
    return { userId: p.userId, tenantId: p.tenantId, roles: [...p.roles], enabledPluginIds: [...p.enabledPluginIds] }
  }

  router.get('/tools', async c => {
    const p = await principal(c)
    if (!p) return c.json({ error: 'Unauthorized' }, 401)
    const active = new Set<string>()
    for (const id of p.enabledPluginIds) if ((!options.isPluginEnabled || await options.isPluginEnabled(p, id)) && await entitled(p, id)) active.add(id)
    return c.json({ tools: tools().filter(({ plugin, tool }) =>
      active.has(plugin.id) && runtime.gatekeeper.validateCall({ toolName: tool.name, userRoles: p.roles, tenantId: p.tenantId }).allowed
    ).map(({ plugin, tool }) => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters, pluginId: plugin.id })) })
  })

  router.post('/execute', async c => {
    const p = await principal(c)
    if (!p) return c.json({ error: 'Unauthorized' }, 401)
    if (!/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')) return c.json({ error: 'JSON content type required' }, 415)
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.name !== 'string'
      || !body.args || typeof body.args !== 'object' || Array.isArray(body.args)
      || Object.keys(body).some(k => k !== 'name' && k !== 'args')) return c.json({ error: 'Expected { name, args }' }, 400)
    const entry = tools().find(({ tool }) => tool.name === body.name)
    // Do not reveal disabled plugin tools through discovery or execution.
    if (!entry || !p.enabledPluginIds.includes(entry.plugin.id) || (options.isPluginEnabled && !await options.isPluginEnabled(p, entry.plugin.id))) return c.json({ error: 'Tool unavailable' }, 404)
    const admission = await preview(p, entry.plugin)
    if (admission) return c.json({ error: admission.error }, admission.status)
    const traceId = crypto.randomUUID()
    const verdict = runtime.gatekeeper.validateCall({ toolName: entry.tool.name, userRoles: p.roles, tenantId: p.tenantId, traceId })
    const audit = { toolName: entry.tool.name, userId: p.userId, tenantId: p.tenantId, traceId,
      riskLevel: verdict.riskLevel, approvalLevel: verdict.approvalLevel }
    if (!verdict.allowed) {
      runtime.gatekeeper.logCall({ ...audit, status: 'BLOCKED', reason: verdict.reason })
      return c.json({ error: 'Forbidden', traceId }, 403)
    }
    const schema = entry.tool.parameters
    const validator = (String(schema.$schema ?? '').includes('2020-12') ? ajv2020 : ajv).compile(schema)
    if (!validator(body.args)) return c.json({ error: 'Invalid tool arguments', traceId }, 400)
    if (verdict.requireHumanApproval) {
      runtime.gatekeeper.logCall({ ...audit, status: 'PENDING_APPROVAL' })
      // No client-supplied approval flag or token can bypass this branch.
      return c.json({ requireHumanApproval: true, approvalLevel: verdict.approvalLevel, traceId }, 202)
    }
    if (options.isPluginEnabled && !await options.isPluginEnabled(p, entry.plugin.id)) return c.json({ error: 'Tool unavailable' }, 404)
    const dependencies = await options.createToolContext?.(p, entry.plugin.id) ?? {}
    const aiHostAdapters = await resolveAIAdapters(p, entry.plugin.id, entry.tool.name, traceId)
    if (options.isPluginEnabled && !await options.isPluginEnabled(p, entry.plugin.id)) return c.json({ error: 'Tool unavailable' }, 404)
    const context = Object.freeze({ ...dependencies, ...(aiHostAdapters ? { aiHostAdapters: Object.freeze(aiHostAdapters) } : {}), tenantId: p.tenantId, userId: p.userId,
      roles: Object.freeze([...p.roles]), pluginId: entry.plugin.id, traceId })
    try { await admit(p, entry.plugin, `mcp:${entry.tool.name}`) }
    catch (error) { if (error instanceof EntitlementError) { runtime.gatekeeper.logCall({ ...audit, status: 'BLOCKED', reason: error.message }); return c.json({ error: error.message }, error.decision.status) } throw error }
    runtime.gatekeeper.logCall({ ...audit, status: 'ALLOWED' })
    const result = await entry.tool.handler(body.args, context)
    return c.json({ result, traceId })
  })

  // ---------- MCP SSE (Server-Sent Events) & JSON-RPC 2.0 Transport ----------
  interface SseSession {
    userId: string
    tenantId: string
    createdAt: number
    lastActivityAt: number
    send: (chunk: string) => void
  }
  const sseSessions = new Map<string, SseSession>()
  const boundedNumber = (value: number | undefined, fallback: number, minimum: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback
  const sseSessionTtlMs = boundedNumber(options.sseSessionTtlMs, 30 * 60 * 1_000, 1_000)
  const maxSseSessions = boundedNumber(options.maxSseSessions, 1_000, 1)

  function purgeExpiredSseSessions(now = Date.now()): void {
    for (const [id, session] of sseSessions) {
      if (now - session.createdAt >= sseSessionTtlMs || now - session.lastActivityAt >= sseSessionTtlMs) sseSessions.delete(id)
    }
  }

  router.get('/sse', async c => {
    const p = await principal(c)
    if (!p) return c.json({ error: 'Unauthorized' }, 401)

    const now = Date.now()
    purgeExpiredSseSessions(now)
    if (sseSessions.size >= maxSseSessions) return c.json({ error: 'MCP SSE capacity exhausted' }, 503)

    const sessionId = crypto.randomUUID()
    const endpointUrl = `${new URL(c.req.url).pathname.replace(/\/sse$/, '')}/message?sessionId=${sessionId}`

    let cleanup: (() => void) | undefined
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        const send = (data: string) => {
          try {
            const session = sseSessions.get(sessionId)
            if (session) session.lastActivityAt = Date.now()
            controller.enqueue(encoder.encode(data))
          } catch {
            cleanup?.()
          }
        }
        sseSessions.set(sessionId, { userId: p.userId, tenantId: p.tenantId, createdAt: now, lastActivityAt: now, send })
        cleanup = () => sseSessions.delete(sessionId)

        // MCP SSE Initial Handshake: emit endpoint URL
        send(`event: endpoint\ndata: ${endpointUrl}\n\n`)
      },
      cancel() {
        cleanup?.()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  })

  router.post('/message', async c => {
    const p = await principal(c)
    if (!p) return c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Unauthorized' }, id: null }, 401)

    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return c.json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: body?.id ?? null }, 400)
    }

    const id = body.id ?? null
    const sessionId = c.req.query('sessionId')
    purgeExpiredSseSessions()
    const session = sessionId ? sseSessions.get(sessionId) : undefined
    if (sessionId && !session) return c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'MCP session unavailable' }, id }, 404)
    if (session && (session.userId !== p.userId || session.tenantId !== p.tenantId)) {
      return c.json({ jsonrpc: '2.0', error: { code: -32003, message: 'MCP session owner mismatch' }, id }, 403)
    }
    if (session) session.lastActivityAt = Date.now()

    const sendRpcResponse = (payload: object) => {
      const serialized = JSON.stringify(payload)
      if (session) {
        session.send(`event: message\ndata: ${serialized}\n\n`)
      }
      return c.json(payload)
    }

    // 1. tools/list
    if (body.method === 'tools/list') {
      const active = new Set<string>()
      for (const pid of p.enabledPluginIds) if ((!options.isPluginEnabled || await options.isPluginEnabled(p, pid)) && await entitled(p, pid)) active.add(pid)

      const available = tools()
        .filter(({ plugin, tool }) =>
          active.has(plugin.id) &&
          runtime.gatekeeper.validateCall({ toolName: tool.name, userRoles: p.roles, tenantId: p.tenantId }).allowed
        )
        .map(({ plugin, tool }) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters,
          pluginId: plugin.id,
        }))

      return sendRpcResponse({ jsonrpc: '2.0', result: { tools: available }, id })
    }

    // 2. tools/call
    if (body.method === 'tools/call') {
      const toolName = body.params?.name
      const toolArgs = body.params?.arguments ?? {}

      if (typeof toolName !== 'string' || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) {
        return sendRpcResponse({ jsonrpc: '2.0', error: { code: -32602, message: 'Invalid params' }, id })
      }

      const entry = tools().find(({ tool }) => tool.name === toolName)
      if (!entry || !p.enabledPluginIds.includes(entry.plugin.id) || (options.isPluginEnabled && !await options.isPluginEnabled(p, entry.plugin.id))) {
        return sendRpcResponse({ jsonrpc: '2.0', error: { code: -32601, message: 'Tool not found' }, id })
      }
      const admission = await preview(p, entry.plugin)
      if (admission) return sendRpcResponse({ jsonrpc: '2.0', error: { code: -32003, message: admission.error, data: { status: admission.status } }, id })

      const traceId = crypto.randomUUID()
      const verdict = runtime.gatekeeper.validateCall({ toolName: entry.tool.name, userRoles: p.roles, tenantId: p.tenantId, traceId })
      const audit = { toolName: entry.tool.name, userId: p.userId, tenantId: p.tenantId, traceId,
        riskLevel: verdict.riskLevel, approvalLevel: verdict.approvalLevel }

      if (!verdict.allowed) {
        runtime.gatekeeper.logCall({ ...audit, status: 'BLOCKED', reason: verdict.reason })
        return sendRpcResponse({ jsonrpc: '2.0', error: { code: -32003, message: 'Forbidden: tool execution denied' }, id })
      }

      const schema = entry.tool.parameters
      const validator = (String(schema.$schema ?? '').includes('2020-12') ? ajv2020 : ajv).compile(schema)
      if (!validator(toolArgs)) {
        return sendRpcResponse({ jsonrpc: '2.0', error: { code: -32602, message: 'Invalid tool arguments' }, id })
      }

      if (verdict.requireHumanApproval) {
        runtime.gatekeeper.logCall({ ...audit, status: 'PENDING_APPROVAL' })
        return sendRpcResponse({
          jsonrpc: '2.0',
          result: {
            content: [{ type: 'text', text: `Human approval required (${verdict.approvalLevel})` }],
            isError: true,
            requireHumanApproval: true,
            approvalLevel: verdict.approvalLevel,
            traceId,
          },
          id,
        })
      }

      if (options.isPluginEnabled && !await options.isPluginEnabled(p, entry.plugin.id)) {
        return sendRpcResponse({ jsonrpc: '2.0', error: { code: -32601, message: 'Tool not found' }, id })
      }
      const dependencies = await options.createToolContext?.(p, entry.plugin.id) ?? {}
      const aiHostAdapters = await resolveAIAdapters(p, entry.plugin.id, entry.tool.name, traceId)
      if (options.isPluginEnabled && !await options.isPluginEnabled(p, entry.plugin.id)) {
        return sendRpcResponse({ jsonrpc: '2.0', error: { code: -32601, message: 'Tool not found' }, id })
      }
      const context = Object.freeze({ ...dependencies, ...(aiHostAdapters ? { aiHostAdapters: Object.freeze(aiHostAdapters) } : {}), tenantId: p.tenantId, userId: p.userId,
        roles: Object.freeze([...p.roles]), pluginId: entry.plugin.id, traceId })

      try { await admit(p, entry.plugin, `mcp:${entry.tool.name}`) }
      catch (error) {
        if (error instanceof EntitlementError) { runtime.gatekeeper.logCall({ ...audit, status: 'BLOCKED', reason: error.message }); return sendRpcResponse({ jsonrpc: '2.0', error: { code: -32003, message: error.message, data: { status: error.decision.status } }, id }) }
        throw error
      }
      runtime.gatekeeper.logCall({ ...audit, status: 'ALLOWED' })
      const handlerResult = await entry.tool.handler(toolArgs, context)

      return sendRpcResponse({
        jsonrpc: '2.0',
        result: {
          content: [{ type: 'text', text: JSON.stringify(handlerResult) }],
          traceId,
        },
        id,
      })
    }

    return sendRpcResponse({ jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id })
  })
  return router
}
