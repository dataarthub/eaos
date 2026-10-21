import type { WorkflowAgentFailureCode } from '@alneas/eaos-core'
import { ServerAgentExecutionError, type ServerAgentExecutor, type ServerAgentTaskRequest } from './types'

/**
 * Versioned JSON envelope POSTed by {@link createHttpAgentExecutor}.
 */
export interface HttpAgentRuntimeRequest {
  /** Wire protocol version; must be 1.0. */
  protocolVersion: '1.0'
  /** Cloned host-admitted task to execute. */
  task: ServerAgentTaskRequest
}

/**
 * Runtime reply validated by {@link createHttpAgentExecutor}; failed replies are converted to execution errors.
 */
export interface HttpAgentRuntimeResponse {
  /** Wire protocol version; must match 1.0. */
  protocolVersion: '1.0'
  /** Must match the submitted task ID. */
  taskId: string
  /** COMPLETED requires string output; FAILED is converted to a rejected execution. */
  status: 'COMPLETED' | 'FAILED'
  /** Required string result for COMPLETED replies; ignored on FAILED. */
  output?: string
  /** Optional failure description; a blank/missing value uses a generic message. */
  error?: string
  /** Optional recognized classification; unrecognized values become RUNTIME_FAILED. */
  failureCode?: WorkflowAgentFailureCode
  /** Optional retry advice on failures; otherwise unavailable/timeout/runtime failure default to retryable. */
  retryable?: boolean
}

/**
 * Trusted endpoint, credentials, transport, and limits for {@link createHttpAgentExecutor}.
 */
export interface HttpAgentExecutorOptions {
  /** Private host or ARM runtime endpoint. Credentials must be host-configured. */
  url: string
  /** Host-configured headers, including any runtime credentials; Content-Type is always application/json. */
  headers?: Record<string, string>
  /** Default timeout in milliseconds, safe integer 1–3600000; task.timeoutMs overrides this. @defaultValue 60000 */
  timeoutMs?: number
  /** Maximum response bytes, safe integer 1–134217728; content length and streaming bytes are checked. @defaultValue 8388608 */
  maxResponseBytes?: number
  /** Host transport implementation; defaults to global fetch. */
  fetch?: typeof fetch
}

const failureCodes = new Set<WorkflowAgentFailureCode>([
  'AGENT_UNAVAILABLE',
  'TIMEOUT',
  'OUTPUT_LIMIT',
  'RUNTIME_FAILED',
  'INVALID_PROPOSAL',
])

function assertEndpoint(value: string): void {
  const url = new URL(value)
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !local)) || url.username || url.password || url.hash) {
    throw new Error('HTTPS agent runtime endpoint required')
  }
}

function failureCode(value: unknown): WorkflowAgentFailureCode | undefined {
  return typeof value === 'string' && failureCodes.has(value as WorkflowAgentFailureCode) ? value as WorkflowAgentFailureCode : undefined
}

function retryable(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new ServerAgentExecutionError('Agent runtime response exceeds configured limit', 'OUTPUT_LIMIT', false)
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    if (Buffer.byteLength(text) > maxBytes) throw new ServerAgentExecutionError('Agent runtime response exceeds configured limit', 'OUTPUT_LIMIT', false)
    try {
      return JSON.parse(text) as unknown
    } catch (error) {
      throw new ServerAgentExecutionError('Agent runtime returned invalid JSON', 'RUNTIME_FAILED', false, { cause: error })
    }
  }
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        throw new ServerAgentExecutionError('Agent runtime response exceeds configured limit', 'OUTPUT_LIMIT', false)
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch (error) {
    throw new ServerAgentExecutionError('Agent runtime returned invalid JSON', 'RUNTIME_FAILED', false, { cause: error })
  }
}

function transportFailure(status: number): ServerAgentExecutionError {
  const retry = status === 408 || status === 425 || status === 429 || status >= 500
  return new ServerAgentExecutionError(`Agent runtime request failed (${status})`, retry ? 'AGENT_UNAVAILABLE' : 'RUNTIME_FAILED', retry)
}

/**
 * Creates the standard private HTTP boundary from application-worker to an
 * ARM/remote agent runtime. The runtime returns text only; workflow proposal
 * parsing and all business side effects stay in EAOS/server/plugin code.
 * @param options - Trusted endpoint, headers, fetch implementation, and limits.
 * @returns An executor resolving runtime output text after checking protocolVersion, taskId, status, and output type.
 * @throws Synchronously for missing/invalid endpoint or limits. Invocations reject with ServerAgentExecutionError for transport, timeout, HTTP status, output size, JSON/contract errors, or reported runtime failure; clone/serialization errors can also reject.
 * @remarks HTTPS is required except localhost/127.0.0.1/IPv6 loopback HTTP; URL credentials and fragments are rejected. Each task uses one POST with redirects disabled, cookies omitted, and an AbortSignal timeout. No retries or business authorization occur here. Remote side effects may have happened before transport failure; the host must define safe idempotency before retrying. Response readers are released and oversized streams are cancelled.
 * @example
 * ```typescript
 * import { createHttpAgentExecutor, type HttpAgentExecutorOptions } from "@alneas/eaos-server/agentic/remote-executor";
 * export function remoteExecutor(hostConfiguration: HttpAgentExecutorOptions) {
 *   // Provision/authenticate the runtime separately and keep its headers server-side.
 *   return createHttpAgentExecutor(hostConfiguration);
 * }
 * ```
 */
export function createHttpAgentExecutor(options: HttpAgentExecutorOptions): ServerAgentExecutor {
  if (!options || typeof options.url !== 'string' || !options.url.trim()) throw new Error('Agent runtime URL is required')
  assertEndpoint(options.url)
  const timeoutMs = options.timeoutMs ?? 60_000
  const maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 128 * 1024 * 1024) throw new Error('Invalid HTTP agent executor limits')
  const request = options.fetch ?? fetch

  return async task => {
    const taskTimeoutMs = task.timeoutMs ?? timeoutMs
    if (!Number.isSafeInteger(taskTimeoutMs) || taskTimeoutMs < 1 || taskTimeoutMs > 3_600_000) throw new ServerAgentExecutionError('Invalid agent runtime timeout', 'RUNTIME_FAILED', false)
    const body: HttpAgentRuntimeRequest = { protocolVersion: '1.0', task: structuredClone(task) }
    let response: Response
    try {
      response = await request(options.url, {
        method: 'POST',
        headers: { ...options.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(taskTimeoutMs),
        redirect: 'error',
        credentials: 'omit',
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new ServerAgentExecutionError('Agent runtime request timed out', 'TIMEOUT', true, { cause: error })
      throw new ServerAgentExecutionError('Agent runtime is unavailable', 'AGENT_UNAVAILABLE', true, { cause: error })
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw transportFailure(response.status)
    }

    let value: unknown
    try {
      value = await readJson(response, maxResponseBytes)
    } catch (error) {
      if (error instanceof ServerAgentExecutionError) throw error
      throw new ServerAgentExecutionError('Agent runtime response could not be read', 'AGENT_UNAVAILABLE', true, { cause: error })
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServerAgentExecutionError('Agent runtime returned an invalid response', 'RUNTIME_FAILED', false)
    const result = value as Partial<HttpAgentRuntimeResponse>
    if (result.protocolVersion !== '1.0' || result.taskId !== task.id || (result.status !== 'COMPLETED' && result.status !== 'FAILED')) throw new ServerAgentExecutionError('Agent runtime response contract mismatch', 'RUNTIME_FAILED', false)
    if (result.status === 'FAILED') {
      const code = failureCode(result.failureCode) ?? 'RUNTIME_FAILED'
      throw new ServerAgentExecutionError(typeof result.error === 'string' && result.error.trim() ? result.error : 'Agent runtime failed', code, retryable(result.retryable) ?? (code === 'AGENT_UNAVAILABLE' || code === 'TIMEOUT' || code === 'RUNTIME_FAILED'))
    }
    if (typeof result.output !== 'string') throw new ServerAgentExecutionError('Agent runtime completed without output', 'RUNTIME_FAILED', false)
    return result.output
  }
}
