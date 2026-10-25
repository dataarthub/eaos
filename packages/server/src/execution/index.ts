import { Hono, type Context } from 'hono'
/**
 * Authenticated host identity supplied to {@link createPluginExecutionRouter}.
 */
export interface ExecutionIdentity {
 /** Nonblank verified tenant ID. */
 tenantId: string
 /** Nonblank verified user ID. */
 userId: string
}
/**
 * Routes authenticated, authorized JSON requests to a fixed plugin/action operation map.
 * @param options - resolveIdentity receives Hono context and resolves verified identity/null; authorize receives that identity, pluginId, action, and parsed payload and must check current membership, activation, and resource permissions; operations maps pluginId:action to async handlers receiving identity/payload. maxBodyBytes defaults to 1048576; allowedOrigins permits exact Origin values and defaults to none.
 * @returns A router serving POST /:pluginId/:action with no-store responses. It returns handler output as JSON or explicit 400/401/403/404/413/415 failures; callback/transport/serialization failures become 503.
 * @throws Synchronously for a nonpositive or unsafe-integer body limit.
 * @remarks The operation map is shallow-copied at creation. Plugin IDs must be lowercase kebab-case; actions allow letters/digits/underscore/hyphen. Origin is checked only when present and is not authentication. Body readers are released and oversized streams cancelled. No transaction, idempotency, cancellation, or retry is supplied; operation side effects may precede a 503 response.
 * @example
 * ```typescript
 * import { createPluginExecutionRouter } from "@alneas/eaos-server/execution";
 * export function executionRouter(options: Parameters<typeof createPluginExecutionRouter>[0]) {
 *   // Host adapters authenticate, authorize, validate payloads, and persist operation results.
 *   return createPluginExecutionRouter(options);
 * }
 * ```
 */
export function createPluginExecutionRouter(options: {
  /**
   * Authenticates the Hono request and resolves nonblank verified tenant/user IDs or null; callback failure becomes a 503 response.
   */
  resolveIdentity: (context: Context) => Promise<ExecutionIdentity | null>
  /** Must check current tenant membership, plugin activation and resource permissions. */
  authorize: (identity: ExecutionIdentity, pluginId: string, action: string, payload: unknown) => Promise<boolean>
  /**
   * Fixed pluginId:action handlers shallow-copied at creation; each receives admitted identity and parsed JSON and resolves JSON-serializable output.
   */
  operations: Record<string, (identity: ExecutionIdentity, payload: unknown) => Promise<unknown>>
  /**
   * Positive safe-integer request body limit in bytes, enforced while reading; defaults to 1048576.
   */
  maxBodyBytes?: number
  /**
   * Optional exact Origin allowlist; any present Origin is denied unless included, while an absent Origin skips this check.
   */
  allowedOrigins?: string[]
}) {
  const router = new Hono(), operations = { ...options.operations }, maxBytes = options.maxBodyBytes ?? 1_048_576
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid request limit')
  router.post('/:pluginId/:action', async c => {
    c.header('Cache-Control', 'no-store')
    try {
      if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return c.json({ error: 'JSON required' }, 415)
      const origin = c.req.header('Origin')
      if (origin && !options.allowedOrigins?.includes(origin)) return c.json({ error: 'Origin denied' }, 403)
      const identity = await options.resolveIdentity(c)
      if (!identity?.tenantId?.trim() || !identity.userId?.trim()) return c.json({ error: 'Authentication required' }, 401)
      const { pluginId, action } = c.req.param()
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pluginId) || !/^[a-zA-Z0-9_-]+$/.test(action) || !Object.hasOwn(operations, `${pluginId}:${action}`)) return c.json({ error: 'Unknown operation' }, 404)
      const reader = c.req.raw.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0
      if (reader) try {
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) { await reader.cancel(); return c.json({ error: 'Request too large' }, 413) }; chunks.push(value) }
      } finally { reader.releaseLock() }
      const bytes = new Uint8Array(size); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      let payload: unknown
      try { payload = JSON.parse(new TextDecoder().decode(bytes)) } catch { return c.json({ error: 'Invalid JSON' }, 400) }
      if (!await options.authorize(identity, pluginId, action, payload)) return c.json({ error: 'Execution denied' }, 403)
      return c.json(await operations[`${pluginId}:${action}`](identity, payload))
    } catch { return c.json({ error: 'Execution unavailable' }, 503) }
  })
  return router
}

/** Verified generic execution identity; policy checks remain host-owned.
 * @see createChatClient
 */
export type ExecutionPrincipal = ExecutionIdentity
/** Current admission policy used by model and action orchestration.
 * @see createChatClient
 */
export interface ExecutionPolicy {
 /**
  * Check current membership, activation and operation permission.
  * @param principal - Trusted tenant/user identity copied before calling the host.
  * @param operation - Host operation identity; chat uses model:chat.
  * @returns Exactly true to admit; any other value denies execution.
  * @throws Host policy failures propagate to the caller.
  * @example
  * ```typescript
  * import type { ExecutionPolicy } from '@alneas/eaos-server/execution';
  * export function currentPolicy(policy: ExecutionPolicy) { return policy; }
  * ```
  * @see createChatClient
  */
 authorize(principal: ExecutionPrincipal, operation: string): Promise<boolean>
}
export {createChatClient, type ChatGovernanceOptions, type ChatClientOptions, type ChatCompletion} from './chat'
export {createToolAgent, type AgentTool, type ToolAgentOptions, type ToolAgentResult} from './tool-agent'
