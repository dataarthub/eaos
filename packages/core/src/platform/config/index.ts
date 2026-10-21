/**
 * Pure configuration contract. No environment, filesystem, network or provider access.
 * @see {@link resolvePlatformConfig}
 */
export const PLATFORM_DEFAULTS_VERSION = '1' as const
/**
 * Provenance labels recorded for normalized inputs and derived outputs.
 * @see {@link resolvePlatformConfig}
 */
export type ConfigSource = 'default' | 'app' | 'environment' | 'derived'
/**
 * Cookie SameSite policy names accepted by platform configuration.
 * @see {@link resolvePlatformConfig}
 */
export type SameSite = 'Lax' | 'Strict' | 'None'
/**
 * Optional service name and listener-port overrides.
 * @see {@link resolvePlatformConfig}
 */
export interface ServiceConfig { 
  /** Optional lowercase DNS service label; service-specific defaults are resolved by resolvePlatformConfig. */
  name?: string; 
  
  /** Optional integer listener port from 1 to 65535; defaults are backend 3000, frontend 80 and Kratos public 4433. */
  port?: number }
/**
 * Exact DNS route mapped to a managed or host-owned HTTP upstream.
 * @see {@link resolvePlatformConfig}
 */
export interface IngressHostRoute {
  /** Exact public DNS name; inherits the app scheme and listener port. */
  host: string
  /** Managed services follow their resolved name/port; custom HTTP services stay host-owned. */
  target: 'backend' | 'frontend' | { 
  /** Exact DNS route or HTTP upstream name; managed route hosts must remain under baseDomain. */
  host: string; 
  
  /** Required integer TCP port from 1 to 65535 for the host-owned custom HTTP upstream. */
  port: number; 
  /** Upstream hostname resolution strategy, docker by default for resolved host routes. */
  resolution?: 'docker' | 'system' }
  
  /** Per-route ingress settings; default read/send timeouts are 180 seconds and buffering is false. */
  proxy?: { 
  /** Ingress upstream read timeout in seconds; defaults to 180. */
  readTimeoutSeconds?: number; 
  /** Ingress upstream send timeout in seconds; defaults to 180. */
  sendTimeoutSeconds?: number; 
  /** Ingress proxy buffering selection; defaults to false. */
  buffering?: boolean }
}
/**
 * Host-owned project-relative JSON identity schema and its stable ID.
 * @see {@link resolvePlatformConfig}
 */
export interface IdentitySchemaFile { 
  /** Stable identity schema ID referenced by the configured default schema. */
  id: string; 
  /** Project-relative .json file path without traversal; the host reads it during rendering/bootstrap. */
  path: string }
/**
 * Built-in verified-email mapper selection or host-owned Jsonnet mapper path.
 * @see {@link resolvePlatformConfig}
 */
export type GoogleOidcMapper = 'google-verified-email-v1' | { 
  /** Project-relative .jsonnet mapper path without traversal; the host loads the mapper. */
  path: string }
/**
 * Google OIDC provider identity, scopes and mapping; credentials remain runtime bindings.
 * @see {@link resolvePlatformConfig}
 */
export interface GoogleOidcConfig {
  /** Preserve existing IDs: they identify provider credentials and callback routes. */
  id?: string
  
/** Exact API permission scope names associated with the verified identity/key. */
  scopes?: string[]
  
  /** Google claim mapping; defaults to google-verified-email-v1, which requires an email scope. */
  mapper?: GoogleOidcMapper
}
/**
 * Preserve default body behavior, select the built-in identity-email mapping or use host Jsonnet.
 * @see {@link resolvePlatformConfig}
 */
export type RegistrationHookBody = false | 'identity-email-v1' | { 
  /** Project-relative standalone .jsonnet body mapping path without traversal. */
  path: string }
/**
 * Host callback path and optional authentication header/session/body mapping.
 * @see {@link resolvePlatformConfig}
 */
export interface RegistrationHookConfig {
  
  /** Absolute simple callback URL path mounted on the internal backend; host owns its implementation. */
  path: string
  /** Non-secret X-* header name. The value is supplied only at runtime. */
  authHeader?: string
  /** Position of the session hook relative to web_hook; omitted/false adds no session hook. */
  session?: false | 'before' | 'after'
  /** Omitted/false preserves Kratos's body behavior; files are host-owned, standalone Jsonnet. */
  body?: RegistrationHookBody
}
/**
 * Declarative public origins, ingress, service and authentication settings without credentials.
 * @see {@link resolvePlatformConfig}
 */
export interface PlatformConfig {
  
  /** Lowercase DNS label identifying the application and derived network settings. */
  appName: string
  
  /** DNS domain with at least two valid lowercase labels; scopes cookie and managed ingress hosts. */
  baseDomain: string
  
  /** Supported platform defaults version; omission selects PLATFORM_DEFAULTS_VERSION. */
  defaultsVersion?: typeof PLATFORM_DEFAULTS_VERSION
  
  /** Production or development configuration mode; defaults to production with HTTPS/secure-cookie requirements. */
  environment?: 'production' | 'development'
  
  /** Host network identity; defaults to appName followed by -network. */
  networkName?: string
  
  /** Distinct public application and authentication origins; defaults to HTTPS app/auth subdomains of baseDomain. */
  origins?: { 
  
  /** Optional public application origin; defaults to HTTPS app.<baseDomain>. */
  app?: string; 
  
  /** Optional public authentication API origin; defaults to HTTPS auth.<baseDomain> and must differ from app origin. */
  auth?: string }
  /** Additional exact DNS names for the same app listener/routes; not Docker aliases or CORS grants. */
  ingress?: { 
  /** Additional exact app DNS names; must stay inside the shared cookie domain and may not claim the auth hostname. */
  appAliases?: string[]; 
  /** Additional exact DNS-to-upstream routes; conflicting/reserved host claims are rejected. */
  hostRoutes?: IngressHostRoute[]; 
  /** Optional additional lowercase absolute API paths without trailing slashes; may not overlap /api or each other. */
  additionalApiPrefixes?: string[] }
  
  
  /** Optional backend/frontend/Kratos service names and listener/admin port overrides. */
  services?: {
    
    /** Backend service name/port or resolved service; defaults to hono-server on port 3000. */
    backend?: ServiceConfig
    
    /** Frontend service name/port or resolved service; defaults to frontend on port 80. */
    frontend?: ServiceConfig
    
    /** Kratos public/admin service configuration or resolved authentication settings. */
    kratos?: ServiceConfig & { 
  /** Kratos administration port; defaults to 4434 and must differ from the public listener port. */
  adminPort?: number }
  }
  
  /** Optional extra-origin declarations separated into shared, application-only and Kratos-only grants. */
  cors?: {
    /** Extra browser origins shared by Hono and Kratos. */
    additionalOrigins?: string[]
    /** Extra origins for the application API only; does not expand Kratos access. */
    honoAdditionalOrigins?: string[]
    /** Extra origins for Kratos only; does not expand application API access. */
    kratosAdditionalOrigins?: string[]
  }
  
  
  /** Optional authentication UI, schema, cookie, callback and OIDC settings without runtime credentials. */
  auth?: {
    /** External authentication UI; defaults to origins.app and does not add an nginx listener. */
    uiOrigin?: string
    /** Absolute HTTP(S) URL with an optional simple path; defaults to origins.app + '/'. */
    defaultBrowserReturnUrl?: string
    
  /**
   * Optional nonempty list of project-relative identity schema files; omission uses builtin default/email-v1.
   */
  identitySchemas?: IdentitySchemaFile[]
    
    /** Identity-schema ID selected for registration; defaults to the first configured schema or builtin default. */
    defaultSchemaId?: string
    
    /** Shared auth cookie settings; defaults to secure persistent Lax at root path with a domain covering app/auth/UI/return hosts. */
    cookie?: {
      
      /** Auth session cookie name; defaults to ory_kratos_session and special __Host-/__Secure- prefixes have additional constraints. */
      name?: string
      
      
  /** Optional shared cookie DNS domain; defaults to baseDomain and must cover app/auth/UI/return hosts while staying within baseDomain. */
  domain?: string
      
      /** Cookie path; defaults to / and defaults version 1 rejects other values. */
      path?: string
      
      /** Auth cookie cross-site policy; defaults to Lax. None requires secure true. */
      sameSite?: SameSite
      
      /** Auth cookie HTTPS-only flag; defaults to true and is required in production or with SameSite None. */
      secure?: boolean
      
      /** Whether auth cookies persist, or whether a workspace survives execution; cookie default is true and runtime workspace is always false. */
      persistent?: boolean
    }
    
    /** Authentication UI flow paths or derived absolute URLs; no UI routes are deployed by resolution. */
    ui?: Partial<Record<AuthUiFlow, string>>
    /** Internal callback only; the host must supply hook authentication and business handling. */
    registrationHook?: false | RegistrationHookConfig
    /** Explicit opt-in; client ID and secret are host runtime bindings, never config values. */
    oidc?: false | { 
  /** Explicit Google OIDC provider configuration; credentials are separate host runtime bindings. */
  google: GoogleOidcConfig }
  }
}
/**
 * Optional top-level overrides applied after application configuration.
 * @see {@link resolvePlatformConfig}
 */
export type PlatformConfigOverrides = Partial<PlatformConfig>
/**
 * Authentication UI flows whose routes may be overridden.
 * @see {@link resolvePlatformConfig}
 */
export type AuthUiFlow = 'login' | 'registration' | 'error' | 'settings' | 'recovery' | 'verification' | 'logout'
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T
interface ResolvedService { name: string; port: number; url: string }
/**
 * Deeply readonly resolved service, ingress and authentication configuration with provenance.
 * @see {@link resolvePlatformConfig}
 */
export type ResolvedPlatformConfig = DeepReadonly<{
  
  /** Supported platform defaults version; omission selects PLATFORM_DEFAULTS_VERSION. */
  defaultsVersion: typeof PLATFORM_DEFAULTS_VERSION
  
  /** Lowercase DNS label identifying the application and derived network settings. */
  appName: string
  
  /** DNS domain with at least two valid lowercase labels; scopes cookie and managed ingress hosts. */
  baseDomain: string
  
  /** Production or development configuration mode; defaults to production with HTTPS/secure-cookie requirements. */
  environment: 'production' | 'development'
  
  /** Host network identity; defaults to appName followed by -network. */
  networkName: string
  
  /** Distinct public application and authentication origins; defaults to HTTPS app/auth subdomains of baseDomain. */
  origins: { 
  
  /** Normalized public application origin used by ingress/CORS/return defaults. */
  app: string; 
  
  /** Normalized public authentication API origin, separate from app and authentication UI origins. */
  auth: string }
  
  
  /** Resolved internal service names, ports and URLs; resolver does not connect or deploy services. */
  services: {
    
    /** Backend service name/port or resolved service; defaults to hono-server on port 3000. */
    backend: ResolvedService
    
    /** Frontend service name/port or resolved service; defaults to frontend on port 80. */
    frontend: ResolvedService
    
    /** Kratos public/admin service configuration or resolved authentication settings. */
    kratos: ResolvedService & { 
  /** Kratos administration port; defaults to 4434 and must differ from the public listener port. */
  adminPort: number; 
  /** Derived internal administration URL; hosts must keep it outside public ingress. */
  adminUrl: string }
  }
  
  /** Derived ingress routing metadata; resolver does not write nginx files or deploy listeners. */
  nginx: {
    
    /** Normalized public application origin used by ingress rendering. */
    appOrigin: string
    
    /** Unique public app hostnames, including the canonical app hostname and configured aliases. */
    appServerNames: string[]
    
    /** Additional exact DNS-to-upstream routes; conflicting/reserved host claims are rejected. */
    hostRoutes: Array<{
      
      /** Exact DNS route or HTTP upstream name; managed route hosts must remain under baseDomain. */
      host: string; 
  
  /** Derived public route origin inheriting application scheme/listener port with the configured exact hostname. */
  origin: string; 
  /** Derived internal HTTP service URL used for ingress routing. */
  upstream: string; 
  /** Upstream hostname resolution strategy, docker by default for resolved host routes. */
  resolution: 'docker' | 'system'
      
      /** Resolved route target classification: backend, frontend or host-owned external service. */
      service: 'backend' | 'frontend' | 'external'
      
      /** Per-route ingress settings; default read/send timeouts are 180 seconds and buffering is false. */
      proxy: { 
  /** Ingress upstream read timeout in seconds; defaults to 180. */
  readTimeoutSeconds: number; 
  /** Ingress upstream send timeout in seconds; defaults to 180. */
  sendTimeoutSeconds: number; 
  /** Ingress proxy buffering selection; defaults to false. */
  buffering: boolean }
    }>
    
    /** Normalized public Kratos/API origin distinct from the application and auth UI origins. */
    authOrigin: string
    
    /** API mount metadata or derived backend routing; host renders and enforces these routes. */
    api: { 
  /** Canonical backend path fixed to /api/. */
  path: '/api/'; 
  /** Distinct API route prefixes assigned to the backend, starting with /api. */
  prefixes: string[]; 
  /** Derived internal HTTP service URL used for ingress routing. */
  upstream: string }
    
    /** Derived internal frontend URL used by ingress rendering. */
    frontendUpstream: string
    
    /** Derived internal Kratos public-service upstream used by ingress. */
    authUpstream: string
  }
  
  /** Resolved application API listener, CORS and Kratos connection metadata. */
  hono: { 
  
  /** Resolved backend listener port, default 3000. */
  port: number; 
  /** Unique normalized browser origins permitted for the resolved host service. */
  corsOrigins: string[]; 
  /** Derived internal Kratos public-service URL used by backend clients. */
  kratosPublicUrl: string; 
  /** Derived public Kratos origin used by browser clients. */
  kratosBrowserUrl: string }
  
  /** Kratos public/admin service configuration or resolved authentication settings. */
  kratos: {
    
    /** Derived public Kratos URL ending with a slash. */
    publicUrl: string
    
    /** Derived internal administration URL; hosts must keep it outside public ingress. */
    adminUrl: string
    
    /** External authentication UI origin; defaults to app origin and must differ from auth API origin. */
    uiOrigin: string
    
    /** Unique normalized browser origins permitted for the resolved host service. */
    corsOrigins: string[]
    
    /** Absolute HTTP(S) return URL without query/fragment; defaults to the application origin root and requires HTTPS in production. */
    defaultBrowserReturnUrl: string
    
    /** Derived explicit browser-return allowlist covering the app root, UI flows and configured default return URL. */
    allowedReturnUrls: string[]
    
    /** Authentication UI flow paths or derived absolute URLs; no UI routes are deployed by resolution. */
    ui: Record<AuthUiFlow, string>
    
    /** Shared auth cookie settings; defaults to secure persistent Lax at root path with a domain covering app/auth/UI/return hosts. */
    cookie: { 
  /** Auth session cookie name; defaults to ory_kratos_session and special __Host-/__Secure- prefixes have additional constraints. */
  name: string; 
  
  /** Resolved shared cookie domain covering app/auth/UI/return hosts; defaults to baseDomain. */
  domain?: string; 
  /** Cookie scope path fixed to / in defaults version 1. */
  path: string; 
  /** Auth cookie cross-site policy; defaults to Lax. None requires secure true. */
  sameSite: SameSite; 
  /** Auth cookie HTTPS-only flag; defaults to true and is required in production or with SameSite None. */
  secure: boolean; 
  /** Whether auth cookies persist, or whether a workspace survives execution; cookie default is true and runtime workspace is always false. */
  persistent: boolean }
    
    /** Identity-schema ID selected for registration; defaults to the first configured schema or builtin default. */
    defaultSchemaId: string
    
  /**
   * Resolved nonempty identity schema sources; entries reference builtin email-v1 or host-owned JSON files.
   */
  identitySchemas: Array<{ 
  /** Resolved identity schema ID used by registration. */
  id: string; 
  
  /** Resolved builtin email-v1 schema metadata or host-owned project-relative JSON file source. */
  source: { 
  /** Identity schema source discriminator: builtin metadata or a host-owned file. */
  type: 'builtin'; 
  /** Builtin identity schema name fixed to email-v1. */
  name: 'email-v1' } | { 
  /** Identity schema source discriminator: builtin metadata or a host-owned file. */
  type: 'file'; 
  /** Host-owned project-relative JSON identity schema file path. */
  path: string } }>
    
    /** Optional internal callback configuration; false by default and host authentication/business handling are required. */
    registrationHook: false | { 
  /** Target/observed HTTP(S) location; adapter/host authorization must restrict navigation and delivery. */
  url: string; 
  /** Non-secret X-* header name for callback authentication; defaults to X-EAOS-Webhook-Key and the value is supplied at runtime. */
  authHeader: string; 
  /** Registration session-hook ordering; false by default, otherwise before or after the web hook. */
  session: false | 'before' | 'after'; 
  /** Exact inbound body or configured hook body mapping; callback mapping defaults preserve native Kratos behavior. */
  body: RegistrationHookBody }
    
    /** Explicit OIDC opt-in, false by default; client credentials remain runtime bindings. */
    oidc: false | { 
  /** Explicit Google OIDC provider configuration; credentials are separate host runtime bindings. */
  google: { 
  /** Stable Google provider ID; defaults to google and determines the callback path. */
  id: string; 
  /** Provider identity from model metadata, travel discovery or connection/circuit health. */
  provider: 'google'; 
/** Exact API permission scope names associated with the verified identity/key. */
  scopes: string[]; 
  /** Google claim mapping; defaults to google-verified-email-v1, which requires an email scope. */
  mapper: GoogleOidcMapper; 
  /** Derived public Google OIDC callback URL using the configured provider ID. */
  callbackUrl: string } }
  }
  /** Paths refer to normalized inputs or derived outputs. Values and secret material are never logged. */
  provenance: Record<string, ConfigSource>
}>

/**
 * One sanitized configuration failure path, category and explanation.
 * @see {@link resolvePlatformConfig}
 */
export interface PlatformConfigIssue { 
  /** Normalized input/output location associated with a sanitized validation failure. */
  path: string; 
  
  /** Sanitized validation category: type, unknown_key, invalid or conflict. */
  code: 'type' | 'unknown_key' | 'invalid' | 'conflict'; 
  /** Human-readable provider/failure explanation; do not include secrets in surfaced diagnostics. */
  message: string }
/**
 * Expose a sanitized configuration issue without echoing secret values.
 * @remarks issues is a frozen one-element array containing a frozen copy of the issue.
 *
 * @example
 * ```typescript
 * import { PlatformConfigError } from "@alneas/eaos-core/platform/config";
 * const error = new PlatformConfigError({ path: "config.appName", code: "invalid", message: "Expected a DNS label" });
 * console.log(error.issues[0].path);
 * ```
 */
export class PlatformConfigError extends Error {
  
  /**
   * Frozen one-element list containing a frozen copy of the sanitized validation issue.
   */
  readonly issues: readonly PlatformConfigIssue[]
  /**
   * Create an error from one sanitized issue.
   * @param issue - Failure path, category and safe human-readable explanation; do not include secrets in the message.
   *
   * @example
   * ```typescript
   * import { PlatformConfigError } from "@alneas/eaos-core/platform/config";
   * const error = new PlatformConfigError({ path: "config.appName", code: "invalid", message: "Expected a DNS label" });
   * console.log(error.message);
   * ```
   */
  constructor(issue: PlatformConfigIssue) {
    super(`${issue.path}: ${issue.message}`)
    this.name = 'PlatformConfigError'
    this.issues = Object.freeze([Object.freeze({ ...issue })])
  }
}

type RecordValue = Record<string, unknown>
type Validator = (value: unknown, path: string) => void
type Shape = { [key: string]: Validator | Shape }
function fail(path: string, message: string, code: PlatformConfigIssue['code'] = 'invalid'): never {
  throw new PlatformConfigError({ path, code, message })
}
function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
const text: Validator = (value, path) => {
  if (typeof value !== 'string' || !value || /\s/.test(value) || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) fail(path, 'Expected a non-empty string without whitespace or control characters', 'type')
}
const label: Validator = (value, path) => {
  text(value, path)
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value as string)) fail(path, 'Expected a lowercase DNS label (1–63 characters)')
}
const domain: Validator = (value, path) => {
  text(value, path)
  const parts = (value as string).split('.')
  if ((value as string).length > 253 || parts.length < 2 || /^\d+$/.test(parts.at(-1)!)) fail(path, 'Expected a DNS domain with at least two labels')
  for (const part of parts) label(part, path)
}
const port: Validator = (value, path) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) fail(path, 'Expected an integer port between 1 and 65535')
}
const bool: Validator = (value, path) => { if (typeof value !== 'boolean') fail(path, 'Expected a boolean', 'type') }
const oneOf = (...values: readonly string[]): Validator => (value, path) => {
  if (!values.includes(value as string)) fail(path, 'Unsupported option')
}
const origin: Validator = (value, path) => {
  text(value, path)
  let url: URL
  try { url = new URL(value as string) } catch { fail(path, 'Expected an HTTP(S) origin') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !/^https?:\/\/[^/?#\\]+\/?$/.test(value as string)) fail(path, 'Expected an HTTP(S) origin without credentials, path, query or fragment')
}
const routePath: Validator = (value, path) => {
  text(value, path)
  if (!/^\/(?:[A-Za-z0-9_~.-]+\/)*[A-Za-z0-9_~.-]*$/.test(value as string) ||
      (value as string).split('/').some(part => part === '.' || part === '..')) fail(path, 'Expected an absolute URL path without query, fragment or dot segments')
}
const apiPrefix: Validator = (value, path) => {
  text(value, path)
  if (typeof value !== 'string' || value.length > 256 || !/^\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+$/.test(value)) fail(path, 'Expected an absolute API prefix of lowercase path segments without a trailing slash')
}
const returnUrl: Validator = (value, path) => {
  text(value, path)
  const parts = (value as string).match(/^(https?:\/\/[^/?#\\]+)(\/[^?#\\]*)?$/)
  if (!parts) fail(path, 'Expected an absolute HTTP(S) return URL without query or fragment')
  origin(parts[1], path)
  routePath(parts[2] ?? '/', path)
}
const schemaPath: Validator = (value, path) => {
  text(value, path)
  if (!/^(?:\.\/)?[A-Za-z0-9_-][A-Za-z0-9_./-]*\.json$/.test(value as string) ||
      (value as string).replace(/^\.\//, '').split('/').some(part => !part || part === '.' || part === '..')) fail(path, 'Expected a project-relative JSON file path without traversal')
}
const schemaId: Validator = (value, path) => {
  text(value, path)
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value as string)) fail(path, 'Expected a schema ID containing letters, digits, underscores or hyphens')
}
const jsonnetPath: Validator = (value, path) => {
  text(value, path)
  if (!/^(?:\.\/)?[A-Za-z0-9_-][A-Za-z0-9_./-]*\.jsonnet$/.test(value as string) ||
      (value as string).replace(/^\.\//, '').split('/').some(part => !part || part === '.' || part === '..')) fail(path, 'Expected a project-relative Jsonnet file path without traversal')
}
function arrayOf(validate: Validator): Validator {
  return (value, path) => {
    if (!Array.isArray(value) || value.length > 100) fail(path, 'Expected an array with at most 100 entries', 'type')
    for (let i = 0; i < value.length; i++) validate(value[i], `${path}.${i}`)
  }
}
function validateObject(value: unknown, shape: Shape, path: string): asserts value is RecordValue {
  if (!isRecord(value)) fail(path, 'Expected a plain object', 'type')
  for (const key of Object.keys(value)) {
    // Do not echo unknown keys: callers sometimes accidentally put secret material there.
    if (!Object.hasOwn(shape, key)) fail(path, 'Unknown configuration key', 'unknown_key')
    if (value[key] === undefined) continue
    const rule = shape[key], childPath = `${path}.${key}`
    if (typeof rule === 'function') rule(value[key], childPath)
    else validateObject(value[key], rule, childPath)
  }
}
const serviceShape = { name: label, port }
const upstreamHost: Validator = (value, path) => {
  text(value, path)
  if ((value as string).includes('.')) domain(value, path)
  else label(value, path)
  if (/^[0-9.]+$/.test(value as string)) fail(path, 'Use a DNS name rather than an IP address')
}
const timeoutSeconds: Validator = (value, path) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 3600) fail(path, 'Expected an integer timeout between 1 and 3600 seconds')
}
const hostRoute: Validator = (value, path) => {
  const target: Validator = (target, key) => {
    if (target === 'backend' || target === 'frontend') return
    validateObject(target, { host: upstreamHost, port, resolution: oneOf('docker', 'system') }, key)
    upstreamHost(target.host, `${key}.host`); port(target.port, `${key}.port`)
  }
  validateObject(value, { host: domain, target, proxy: { readTimeoutSeconds: timeoutSeconds, sendTimeoutSeconds: timeoutSeconds, buffering: bool } }, path)
  domain(value.host, `${path}.host`); target(value.target, `${path}.target`)
}
const configShape: Shape = {
  appName: label, baseDomain: domain, defaultsVersion: oneOf(PLATFORM_DEFAULTS_VERSION),
  environment: oneOf('production', 'development'), networkName: (value, path) => {
    text(value, path)
    if (!/^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(value as string)) fail(path, 'Expected a network name (1–128 lowercase letters, digits or hyphens)')
  },
  origins: { app: origin, auth: origin },
  ingress: { appAliases: arrayOf(domain), hostRoutes: arrayOf(hostRoute), additionalApiPrefixes: arrayOf(apiPrefix) },
  services: { backend: serviceShape, frontend: serviceShape, kratos: { ...serviceShape, adminPort: port } },
  cors: { additionalOrigins: arrayOf(origin), honoAdditionalOrigins: arrayOf(origin), kratosAdditionalOrigins: arrayOf(origin) },
  auth: {
    uiOrigin: origin, defaultBrowserReturnUrl: returnUrl,
    identitySchemas: arrayOf((value, path) => {
      validateObject(value, { id: schemaId, path: schemaPath }, path)
      schemaId(value.id, `${path}.id`); schemaPath(value.path, `${path}.path`)
    }),
    defaultSchemaId: schemaId,
    oidc: (value, path) => {
      if (value === false) return
      validateObject(value, { google: {
        id: schemaId,
        scopes: arrayOf((scope, key) => {
          text(scope, key)
          if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(scope as string)) fail(key, 'Expected an OAuth scope name or URL without whitespace')
        }),
        mapper: (mapper, key) => {
          if (mapper === 'google-verified-email-v1') return
          validateObject(mapper, { path: jsonnetPath }, key)
          jsonnetPath(mapper.path, `${key}.path`)
        },
      } }, path)
      if (!isRecord(value.google)) fail(`${path}.google`, 'Google configuration is required', 'type')
    },
    cookie: {
      name: (value, path) => { text(value, path); if (!/^[A-Za-z0-9_-]{1,128}$/.test(value as string)) fail(path, 'Expected a cookie name containing letters, digits, underscores or hyphens') },
      domain, path: routePath, sameSite: oneOf('Lax', 'Strict', 'None'), secure: bool, persistent: bool,
    },
    ui: { login: routePath, registration: routePath, error: routePath, settings: routePath, recovery: routePath, verification: routePath, logout: routePath },
    registrationHook: (value, path) => {
      if (value === false) return
      validateObject(value, {
        path: routePath,
        authHeader: (header, key) => {
          text(header, key)
          if (!/^X-[A-Za-z0-9][A-Za-z0-9-]{0,125}$/i.test(header as string)) fail(key, 'Expected an X-* header name of at most 128 characters')
        },
        session: (session, key) => { if (session !== false) oneOf('before', 'after')(session, key) },
        body: (body, key) => {
          if (body === false || body === 'identity-email-v1') return
          validateObject(body, { path: jsonnetPath }, key)
          if (body.path === undefined) fail(`${key}.path`, 'Jsonnet file path is required')
        },
      }, path)
      routePath(value.path, `${path}.path`)
    },
  },
}

function merge(base: RecordValue, patch: RecordValue): RecordValue {
  const result: RecordValue = {}
  for (const [key, value] of Object.entries(base)) if (value !== undefined) result[key] = clone(value)
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) result[key] = isRecord(value) && isRecord(result[key]) ? merge(result[key] as RecordValue, value) : clone(value)
  }
  return result
}
function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone)
  return isRecord(value) ? merge({}, value) : value
}
function at(value: unknown, path: string): unknown {
  for (const key of path.split('.')) value = isRecord(value) ? value[key] : undefined
  return value
}
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}
function under(host: string, parent: string): boolean { return host === parent || host.endsWith(`.${parent}`) }

/**
 * Validate and resolve app + environment overrides. No IO; all returned objects are immutable.
 * @param input - Plain configuration object requiring a lowercase DNS-label appName and DNS baseDomain. Unknown keys are rejected; secrets belong to runtime bindings.
 * @param environmentOverrides - Same configuration shape, recursively overriding supplied values; defaults to empty. Arrays replace rather than merge, and undefined is ignored.
 * @returns A recursively frozen resolved configuration with defaults, derived service URLs and source provenance.
 * @throws PlatformConfigError for invalid shape, unsupported defaults version, insecure/conflicting origins/cookies, overlapping routes/prefixes or invalid auth configuration.
 * @remarks No process environment, filesystem, provider or network access. Defaults include production, HTTPS app/auth subdomains, backend 3000, frontend 80, Kratos 4433/4434 and secure persistent Lax root-path cookies. Host renders and enforces the resolved settings.
 * @example
 * ```typescript
 * import { resolvePlatformConfig } from "@alneas/eaos-core/platform/config";
 * const config = resolvePlatformConfig({ appName: "demo", baseDomain: "example.com" });
 * console.log(config.services.backend.port); // 3000
 * ```
 */
export function resolvePlatformConfig(input: unknown, environmentOverrides: unknown = {}): ResolvedPlatformConfig {
  validateObject(input, configShape, 'config')
  validateObject(environmentOverrides, configShape, 'overrides')
  const merged = merge(input, environmentOverrides)
  label(merged.appName, 'config.appName'); domain(merged.baseDomain, 'config.baseDomain')
  const provenance: Record<string, ConfigSource> = {}
  function read<T>(path: string, fallback: T, fallbackSource: ConfigSource = 'default'): T {
    const value = at(merged, path)
    provenance[path] = at(environmentOverrides, path) !== undefined ? 'environment' : at(input, path) !== undefined ? 'app' : fallbackSource
    return value === undefined ? fallback : value as T
  }
  function derived<T>(path: string, value: T): T { provenance[path] = 'derived'; return value }
  const appName = read('appName', ''), baseDomain = read('baseDomain', '')
  const defaultsVersion = read('defaultsVersion', PLATFORM_DEFAULTS_VERSION)
  const environment = read<'production' | 'development'>('environment', 'production')
  const networkName = read('networkName', `${appName}-network`, 'derived')
  const origins = {
    app: new URL(read('origins.app', `https://app.${baseDomain}`, 'derived')).origin,
    auth: new URL(read('origins.auth', `https://auth.${baseDomain}`, 'derived')).origin,
  }
  if (origins.app === origins.auth) fail('config.origins', 'App and auth require separate origins in defaults version 1', 'conflict')
  const appAliases = read<string[]>('ingress.appAliases', [])
  if (appAliases.includes(new URL(origins.auth).hostname)) fail('config.ingress.appAliases', 'App aliases must not claim the auth hostname', 'conflict')
  const appServerNames = [...new Set([new URL(origins.app).hostname, ...appAliases])]
  const uiOrigin = new URL(read('auth.uiOrigin', origins.app, 'derived')).origin
  const defaultBrowserReturnUrl = new URL(read('auth.defaultBrowserReturnUrl', `${origins.app}/`, 'derived')).href
  if (uiOrigin === origins.auth) fail('config.auth.uiOrigin', 'Authentication UI and Kratos API require separate origins', 'conflict')
  if (environment === 'production') {
    if (!uiOrigin.startsWith('https://')) fail('config.auth.uiOrigin', 'Production UI origin must use HTTPS', 'conflict')
    if (!defaultBrowserReturnUrl.startsWith('https://')) fail('config.auth.defaultBrowserReturnUrl', 'Production return URL must use HTTPS', 'conflict')
  }
  function extraOrigins(key: 'additionalOrigins' | 'honoAdditionalOrigins' | 'kratosAdditionalOrigins'): string[] {
    const values = read<string[]>(`cors.${key}`, []).map(value => new URL(value).origin)
    if (environment === 'production' && values.some(value => !value.startsWith('https://'))) {
      fail(`config.cors.${key}`, 'Production CORS origins must use HTTPS', 'conflict')
    }
    return values
  }
  const additionalOrigins = extraOrigins('additionalOrigins')
  const honoAdditionalOrigins = extraOrigins('honoAdditionalOrigins')
  const kratosAdditionalOrigins = extraOrigins('kratosAdditionalOrigins')
  if (environment === 'production' && [origins.app, origins.auth].some(value => !value.startsWith('https://'))) {
    fail('config.origins', 'Production origins must use HTTPS', 'conflict')
  }
  const corsOrigins = derived('hono.corsOrigins', [...new Set([origins.app, ...additionalOrigins, ...honoAdditionalOrigins])])
  function service(key: 'backend' | 'frontend' | 'kratos', defaultName: string, defaultPort: number): ResolvedService {
    const name = read(`services.${key}.name`, defaultName), resolvedPort = read(`services.${key}.port`, defaultPort)
    return { name, port: resolvedPort, url: derived(`services.${key}.url`, `http://${name}:${resolvedPort}`) }
  }
  const backend = service('backend', 'hono-server', 3000), frontend = service('frontend', 'frontend', 80)
  const publicKratos = service('kratos', 'kratos', 4433)
  const adminPort = read('services.kratos.adminPort', 4434)
  const kratos = { ...publicKratos, adminPort, adminUrl: derived('services.kratos.adminUrl', `http://${publicKratos.name}:${adminPort}`) }
  if (new Set([backend.name, frontend.name, kratos.name]).size !== 3) fail('config.services', 'Service aliases must be distinct', 'conflict')
  if (kratos.port === kratos.adminPort) fail('config.services.kratos', 'Public and admin ports must be distinct', 'conflict')

  const apiPrefixes = ['/api', ...read<string[]>('ingress.additionalApiPrefixes', [])]
  for (let i = 1; i < apiPrefixes.length; i++) {
    if (apiPrefixes.slice(0, i).some(prefix => prefix === apiPrefixes[i] || prefix.startsWith(`${apiPrefixes[i]}/`) || apiPrefixes[i].startsWith(`${prefix}/`))) fail(`config.ingress.additionalApiPrefixes.${i - 1}`, 'API prefixes must be distinct and may not overlap /api or another API prefix', 'conflict')
  }
  const claimedHosts = new Set([...appServerNames, new URL(origins.auth).hostname])
  const reservedUpstreams = new Set([backend.name, frontend.name, kratos.name, 'nginx', 'kratos-db', 'kratos-migrate'])
  const hostRoutes = read<IngressHostRoute[]>('ingress.hostRoutes', []).map((route, index) => {
    const path = `config.ingress.hostRoutes.${index}`
    if (!under(route.host, baseDomain)) fail(`${path}.host`, 'Route hosts must remain within baseDomain', 'conflict')
    if (claimedHosts.has(route.host)) fail(`${path}.host`, 'Route hostname is already claimed', 'conflict')
    claimedHosts.add(route.host)
    const url = new URL(origins.app)
    url.hostname = route.host
    const target = typeof route.target === 'string' ? { host: { backend, frontend }[route.target].name, port: { backend, frontend }[route.target].port } : route.target
    if (typeof route.target !== 'string' && reservedUpstreams.has(route.target.host)) fail(`${path}.target.host`, 'Use a managed service reference; reserved services cannot be custom upstreams', 'conflict')
    return {
      host: route.host, origin: url.origin,
      upstream: `http://${target.host}:${target.port}`,
      resolution: typeof route.target === 'string' ? 'docker' as const : route.target.resolution ?? 'docker',
      service: typeof route.target === 'string' ? route.target : 'external' as const,
      proxy: { readTimeoutSeconds: route.proxy?.readTimeoutSeconds ?? 180, sendTimeoutSeconds: route.proxy?.sendTimeoutSeconds ?? 180, buffering: route.proxy?.buffering ?? false },
    }
  })

  const cookieDomain = read('auth.cookie.domain', baseDomain, 'derived')
  if (appAliases.some(host => !under(host, cookieDomain))) fail('config.ingress.appAliases', 'App aliases must remain within the shared cookie domain', 'conflict')
  if (!under(cookieDomain, baseDomain) || ![origins.app, origins.auth, uiOrigin, defaultBrowserReturnUrl].every(value => under(new URL(value).hostname, cookieDomain))) {
    fail('config.auth.cookie.domain', 'Cookie domain must be within baseDomain and cover app, auth, UI and return hosts', 'conflict')
  }
  const cookie = {
    name: read('auth.cookie.name', 'ory_kratos_session'),
    domain: cookieDomain,
    path: read('auth.cookie.path', '/'),
    sameSite: read<SameSite>('auth.cookie.sameSite', 'Lax'),
    secure: read('auth.cookie.secure', true), persistent: read('auth.cookie.persistent', true),
  }
  if ((!cookie.secure && environment === 'production') || (cookie.sameSite === 'None' && !cookie.secure)) {
    fail('config.auth.cookie.secure', 'Production and SameSite=None cookies require secure=true', 'conflict')
  }
  if (cookie.secure && !origins.auth.startsWith('https://')) fail('config.origins.auth', 'Secure cookies require an HTTPS auth origin', 'conflict')
  if (cookie.path !== '/') fail('config.auth.cookie.path', 'Root-path Kratos endpoints require cookie path=/ in defaults version 1', 'conflict')
  if (cookie.name.startsWith('__Host-') && (cookie.domain || !cookie.secure)) fail('config.auth.cookie', '__Host- cookies require secure=true and no domain', 'conflict')
  if (cookie.name.startsWith('__Secure-') && !cookie.secure) fail('config.auth.cookie.secure', '__Secure- cookies require secure=true', 'conflict')
  derived('kratos.cookie', cookie)

  const uiDefaults: Record<AuthUiFlow, string> = { login: '/login', registration: '/registration', error: '/error', settings: '/settings', recovery: '/recovery', verification: '/verification', logout: '/login' }
  const ui = {} as Record<AuthUiFlow, string>
  for (const flow of Object.keys(uiDefaults) as AuthUiFlow[]) {
    ui[flow] = derived(`kratos.ui.${flow}`, new URL(read(`auth.ui.${flow}`, uiDefaults[flow]), `${uiOrigin}/`).href)
  }
  const files = read<IdentitySchemaFile[] | undefined>('auth.identitySchemas', undefined)
  if (files?.length === 0) fail('config.auth.identitySchemas', 'At least one identity schema is required')
  const identitySchemas: ResolvedPlatformConfig['kratos']['identitySchemas'] = files
    ? files.map(file => ({ id: file.id, source: { type: 'file' as const, path: file.path } }))
    : [{ id: 'default', source: { type: 'builtin', name: 'email-v1' } }]
  if (new Set(identitySchemas.map(schema => schema.id)).size !== identitySchemas.length) fail('config.auth.identitySchemas', 'Identity schema IDs must be unique', 'conflict')
  const defaultSchemaId = read('auth.defaultSchemaId', identitySchemas[0].id, files ? 'derived' : 'default')
  if (!identitySchemas.some(schema => schema.id === defaultSchemaId)) fail('config.auth.defaultSchemaId', 'Default schema ID must refer to a configured schema', 'conflict')
  const hook = read<false | RegistrationHookConfig>('auth.registrationHook', false)
  const registrationHook = hook === false ? false : {
    url: new URL(hook.path, `${backend.url}/`).href,
    authHeader: read('auth.registrationHook.authHeader', 'X-EAOS-Webhook-Key'),
    session: read<false | 'before' | 'after'>('auth.registrationHook.session', false),
    body: read<RegistrationHookBody>('auth.registrationHook.body', false),
  }
  const oidcInput = read<NonNullable<NonNullable<PlatformConfig['auth']>['oidc']>>('auth.oidc', false)
  let oidc: ResolvedPlatformConfig['kratos']['oidc'] = false
  if (oidcInput !== false) {
    const id = read('auth.oidc.google.id', 'google')
    const scopes = [...new Set(read<string[]>('auth.oidc.google.scopes', ['email', 'profile']))]
    const mapper = read<GoogleOidcMapper>('auth.oidc.google.mapper', 'google-verified-email-v1')
    if (!scopes.length) fail('config.auth.oidc.google.scopes', 'At least one Google scope is required')
    if (mapper === 'google-verified-email-v1' && !scopes.some(scope => scope === 'email' || scope === 'https://www.googleapis.com/auth/userinfo.email')) fail('config.auth.oidc.google.scopes', 'The verified-email mapper requires an email scope', 'conflict')
    oidc = { google: { id, provider: 'google', scopes, mapper, callbackUrl: new URL(`/self-service/methods/oidc/callback/${id}`, `${origins.auth}/`).href } }
  }

  return freeze({
    defaultsVersion, appName, baseDomain, environment, networkName, origins, services: { backend, frontend, kratos },
    nginx: derived('nginx', { appOrigin: origins.app, appServerNames, hostRoutes, authOrigin: origins.auth, api: { path: '/api/' as const, prefixes: apiPrefixes, upstream: backend.url }, frontendUpstream: frontend.url, authUpstream: kratos.url }),
    hono: {
      port: derived('hono.port', backend.port), corsOrigins,
      kratosPublicUrl: derived('hono.kratosPublicUrl', kratos.url), kratosBrowserUrl: derived('hono.kratosBrowserUrl', origins.auth),
    },
    kratos: {
      publicUrl: derived('kratos.publicUrl', `${origins.auth}/`), adminUrl: derived('kratos.adminUrl', `${kratos.adminUrl}/`),
      uiOrigin: derived('kratos.uiOrigin', uiOrigin),
      corsOrigins: derived('kratos.corsOrigins', [...new Set([origins.app, ...additionalOrigins, uiOrigin, ...kratosAdditionalOrigins])]),
      defaultBrowserReturnUrl: derived('kratos.defaultBrowserReturnUrl', defaultBrowserReturnUrl),
      allowedReturnUrls: derived('kratos.allowedReturnUrls', [...new Set([`${origins.app}/`, ...Object.values(ui), defaultBrowserReturnUrl])]),
      ui, cookie, defaultSchemaId: derived('kratos.defaultSchemaId', defaultSchemaId),
      identitySchemas: derived('kratos.identitySchemas', identitySchemas), registrationHook: derived('kratos.registrationHook', registrationHook),
      oidc: derived('kratos.oidc', oidc),
    },
    provenance,
  })
}
