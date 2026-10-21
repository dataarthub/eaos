/**
 * Trusted browser OIDC configuration with explicit authentication and redirect origins.
 *
 * @see createKratosBrowserAuth for a complete host integration example.
 */
export interface BrowserAuthConfig {
  /**
 * Credential-free HTTPS Kratos origin without path/query/fragment.
 */
  publicUrl: string
  /**
 * Configured OIDC provider identifier containing only letters, digits, underscores or hyphens.
 */
  provider: string
  /**
 * Credential-free HTTPS destination; omitted uses current browser origin root.
 */
  returnTo?: string
  /**
 * Explicit HTTPS origins permitted for the login redirect, in addition to publicUrl.
 */
  redirectOrigins: string[]
}
/**
 * Validates the HTTPS Kratos origin, provider identifier and trusted redirect origins.
 * @param config - Authentication origin and provider with optional HTTPS returnTo and explicit origin allowlist.
 * @returns A shallow config copy with normalized publicUrl and a copied redirectOrigins array.
 * @throws Error or URL parsing error for invalid origin, credentials, fragments, provider or redirect origins.
 *
 * @example
 * ```typescript
 * import { validateBrowserAuthConfig } from '@alneas/eaos-react/client/browser-auth';
 * const config = validateBrowserAuthConfig({ publicUrl: 'https://auth.example.com', provider: 'oidc', returnTo: 'https://app.example.com/', redirectOrigins: ['https://identity.example.com'] });
 * ```
 */
export function validateBrowserAuthConfig(config: BrowserAuthConfig): BrowserAuthConfig {
  const validUrl = (value: string) => {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Authentication requires a credential-free HTTPS URL')
    return url
  }
  const base = validUrl(config.publicUrl)
  if (base.search || base.pathname !== '/') throw new Error('Authentication publicUrl must be an origin')
  if (config.returnTo !== undefined) validUrl(config.returnTo)
  if (!/^[a-zA-Z0-9_-]+$/.test(config.provider) || !Array.isArray(config.redirectOrigins)) throw new Error('Invalid authentication configuration')
  for (const origin of config.redirectOrigins) if (validUrl(origin).origin !== origin) throw new Error('Invalid redirect origin')
  return { ...config, publicUrl: base.origin, redirectOrigins: [...config.redirectOrigins] }
}
/**
 * Creates cookie-based Kratos OIDC login/logout actions with CSRF flow validation and redirect allowlists.
 *
 * Browser OIDC uses Kratos cookies, CSRF and provider callbacks. No native API/token impersonation.
 * @param options - BrowserAuthConfig plus host navigate callback and optional fetch; returnTo defaults to the current browser origin root.
 * @returns login() and logout() actions resolving without a value after requesting navigation; failures reject.
 * @throws Invalid configuration throws immediately; actions reject on transport/JSON failures, rejected flows or untrusted redirects; navigate errors propagate.
 *
 * @remarks
 * Requires browser window when returnTo is omitted. Requests include cookies, disable caching/redirect following and time out after 15 seconds. Host must configure Kratos cookies/CORS and allowed identity-provider origins. Neither action confirms destination completion.
 *
 * @example
 * ```typescript
 * import { createKratosBrowserAuth } from '@alneas/eaos-react/client/browser-auth';
 * export const auth = createKratosBrowserAuth({ publicUrl: 'https://auth.example.com', provider: 'oidc', returnTo: 'https://app.example.com/', redirectOrigins: ['https://identity.example.com'], navigate: url => window.location.assign(url) });
 * // Call auth.login() or auth.logout() from a user action after configuring the host auth service.
 * ```
 */
export function createKratosBrowserAuth(options: BrowserAuthConfig & {
/**
 * Optional fetch implementation; defaults to global fetch.
 */
  fetch?: typeof fetch;
/**
 * Host navigation callback receiving a validated absolute redirect URL; no value is returned.
 */
  navigate: (url: string) => void }) {
  const config = validateBrowserAuthConfig(options), request = options.fetch ?? fetch
  const returnTo = config.returnTo ?? new URL('/', window.location.origin).href
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
  async function send(path: string, init: RequestInit = {}) {
    return request(`${config.publicUrl}${path}`, { ...init, headers, credentials: 'include', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) })
  }
  function navigate(value: unknown, origins: string[]) {
    if (typeof value !== 'string') throw new Error('Missing authentication redirect')
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || !origins.includes(url.origin)) throw new Error('Untrusted authentication redirect')
    options.navigate(url.href)
  }
  return {
    /**
 * Begins the Kratos browser OIDC flow using the current CSRF token and trusted redirect origins.
 * @returns Resolves without a value after requesting provider or return navigation.
 * @throws Rejects failed HTTP/JSON flows, untrusted redirects, timeout or propagated navigate errors.
 * @example
 * ```typescript
 * import { createKratosBrowserAuth } from '@alneas/eaos-react/client/browser-auth';
 * export const auth = createKratosBrowserAuth({ publicUrl: 'https://auth.example.com', provider: 'oidc', returnTo: 'https://app.example.com/', redirectOrigins: ['https://identity.example.com'], navigate: url => window.location.assign(url) });
 * // Call auth.login() or auth.logout() from a user action after configuring the host auth service.
 * ```
 */
async login(): Promise<void> {
      const response = await send(`/self-service/login/browser?return_to=${encodeURIComponent(returnTo)}&refresh=true`)
      if (!response.ok) throw new Error('Cannot initialize browser authentication')
      const flow = await response.json() as any
      const csrf = flow.ui?.nodes?.find((node: any) => node.attributes?.name === 'csrf_token')?.attributes?.value
      if (typeof flow.id !== 'string' || !flow.id || typeof csrf !== 'string' || !csrf) throw new Error('Invalid browser authentication flow')
      const result = await send(`/self-service/login?flow=${encodeURIComponent(flow.id)}`, { method: 'POST', body: JSON.stringify({ method: 'oidc', provider: config.provider, csrf_token: csrf }) })
      const body = await result.json() as any
      if (result.status === 422 && body.error?.id === 'browser_location_change_required') {
        navigate(body.redirect_browser_to, [config.publicUrl, ...config.redirectOrigins]); return
      }
      if (result.ok && body.session?.active === true) { navigate(returnTo, [new URL(returnTo).origin]); return }
      throw new Error('Browser authentication was rejected')
    },
    /**
 * Requests a Kratos browser logout URL and navigates only to the configured auth origin.
 * @returns Resolves without a value after requesting logout navigation; destination completion is not confirmed.
 * @throws Rejects HTTP/JSON/transport failures, untrusted logout URL or navigate failure.
 * @example
 * ```typescript
 * import { createKratosBrowserAuth } from '@alneas/eaos-react/client/browser-auth';
 * export const auth = createKratosBrowserAuth({ publicUrl: 'https://auth.example.com', provider: 'oidc', returnTo: 'https://app.example.com/', redirectOrigins: ['https://identity.example.com'], navigate: url => window.location.assign(url) });
 * // Call auth.login() or auth.logout() from a user action after configuring the host auth service.
 * ```
 */
async logout(): Promise<void> {
      const result = await send('/self-service/logout/browser')
      if (!result.ok) throw new Error('Cannot initialize logout')
      const body = await result.json() as any
      navigate(body.logout_url, [config.publicUrl])
    },
  }
}
