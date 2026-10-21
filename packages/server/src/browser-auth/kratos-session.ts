/**
 * Creates a public Kratos whoami verifier without using the Admin API or minting sessions.
 * @param options - publicUrl is an HTTP(S) origin with root path and no embedded credentials/query/fragment; fetch defaults to global fetch and timeoutMs to 10000 milliseconds.
 * @returns An async verifier accepting cookie/sessionToken credentials and resolving userId plus provider identity, or null for absent credentials, 401/403 responses, inactive sessions, or missing identity IDs. sessionToken takes precedence over cookie.
 * @throws Synchronously for an invalid provider URL. Verification rejects transport, abort, invalid timeout, non-OK provider responses other than 401/403, and JSON parsing failures.
 * @remarks Credentials are forwarded only to the configured origin with redirects disabled and no-store caching. The host must trust this origin and separately resolve memberships and tenant lifecycle. This verifier creates no listeners or background work.
 * @example
 * ```typescript
 * import { createKratosSessionVerifier } from "@alneas/eaos-server/browser-auth/kratos-session";
 * const verify = createKratosSessionVerifier({ publicUrl: "https://identity.example.com" });
 * export async function authenticate(cookie: string | undefined) {
 *   return verify({ cookie });
 * }
 * ```
 */
export function createKratosSessionVerifier(options: {
  /**
 * Trusted HTTP(S) Kratos origin with a root path and no embedded credentials, query, or fragment.
 */
publicUrl: string;
  /**
 * Host transport for public whoami calls; defaults to global fetch, with redirects disabled and no-store caching.
 */
fetch?: typeof fetch;
  /**
 * AbortSignal timeout in milliseconds for each whoami request; defaults to 10000 and invalid values fail when invoked.
 */
timeoutMs?: number }) {
  const base = new URL(options.publicUrl)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Invalid Kratos endpoint')
  const request = options.fetch ?? fetch
  return async (credentials: { cookie?: string; sessionToken?: string }) => {
    if (!credentials.cookie && !credentials.sessionToken) return null
    const headers: Record<string, string> = { Accept: 'application/json' }
    // Do not mix potentially different identities from two transports.
    if (credentials.sessionToken) headers['X-Session-Token'] = credentials.sessionToken
    else if (credentials.cookie) headers.Cookie = credentials.cookie
    const response = await request(new URL('/sessions/whoami', base), { headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) })
    if (response.status === 401 || response.status === 403) return null
    if (!response.ok) throw new Error('Identity provider unavailable')
    const session = await response.json() as any
    if (session.active !== true || typeof session.identity?.id !== 'string' || !session.identity.id.trim()) return null
    return { userId: session.identity.id as string, identity: session.identity as Record<string, unknown> }
  }
}
