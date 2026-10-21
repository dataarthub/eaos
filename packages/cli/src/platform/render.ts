import { expandPreset } from './preset'
import { validatePlatformPackages, validatePlatformRuntime, validateDeploymentPlacements, platformDatabaseTargets, type DeploymentPlacements, type PlatformRuntimeConfig, type PlatformPackage } from '@alneas/eaos-server/platform'
import { canonicalJsonHash } from '@alneas/eaos-core/serialization'
import { defaultRuntimePlacementPolicy } from '@alneas/eaos-core'
import { resolvePlatformConfig, type PlatformConfig, type PlatformConfigOverrides, type ResolvedPlatformConfig } from '@alneas/eaos-core/platform/config'
import { renderKamal, resolveKamal, type KamalDeployment, type ResolvedKamalDeployment } from './kamal'
import { parseSiteOperationsConfig, type SiteOperationsConfig } from '../site/index'

/**
 * Non-secret image, database and deployment-target selections for platform generation.
 * @see {@link resolveManifest} for the canonical usage example and runtime requirements.
 */
export interface PlatformDeployment {
  
    /**
   * Explicit application image names plus optional infrastructure images; release execution rejects unreviewed mutable tags.
   */
  images: {
    /** Required backend container image; Kamal requires an explicit tag, and release execution rejects dev/local/latest tags. */
  backend: string;
    /** Required frontend container image; Kamal requires an explicit tag, and release execution rejects dev/local/latest tags. */
  frontend: string;
    /** Optional worker application image; must be configured together with kamal.worker. */
  worker?: string;
    /** Optional remote agent image; must be configured together with kamal.agentRuntime and upgraded through a separate reviewed operation. */
  agentRuntime?: string;
    /** Reverse-proxy image; defaults to nginx:1.30-alpine when omitted. */
  nginx?: string;
    /** Identity service/migration image; defaults to oryd/kratos:v26.2.0 when omitted. */
  kratos?: string;
    /** Local Kratos database image; defaults to postgres:16-alpine when omitted. */
  postgres?: string }
  
    /**
   * Database volume/external-provider selection; omitted settings use generator defaults.
   */
  database?: {
    /** Named Kratos database volume; omission of the whole database object defaults to appName + -kratos-data. */
    volumeName: string
    /** Host supplies an external identity database when true; defaults to false only when the whole object is omitted. */
    external: boolean
  }
  
    /**
   * Output transport selection; defaults to compose. Kamal settings require kamal or both.
   */
  target?: 'compose' | 'kamal' | 'both'
  
    /**
   * Kamal SSH hosts, role configuration and runtime file bindings for that target.
   */
  kamal?: KamalDeployment
  
    /**
   * Explicit component-to-destination catalog; unresolved required placements fail generation.
   */
  placements?: DeploymentPlacements
}
/**
 * Normalized deployment defaults and optional reviewed destination bindings.
 * @see {@link resolveManifest} for the canonical usage example and runtime requirements.
 */
export interface ResolvedDeployment {
  
    /**
   * Infrastructure images with resolved defaults and any explicitly selected worker/agent images.
   */
  images: Required<Omit<PlatformDeployment['images'], 'worker' | 'agentRuntime'>> & {
    /** Selected worker image when a worker host is configured; remains absent otherwise. */
  worker?: string;
    /** Selected agent-runtime image when its host is configured; remains absent otherwise. */
  agentRuntime?: string }
  
    /**
   * Resolved database volume identity and external-provider flag.
   */
  database: NonNullable<PlatformDeployment['database']>
  
    /**
   * Resolved compose, kamal or both output selection.
   */
  target: NonNullable<PlatformDeployment['target']>
  
    /**
   * Validated normalized Kamal settings when selected.
   */
  kamal?: ResolvedKamalDeployment
  
    /**
   * Validated destination and component placement selections.
   */
  placements?: DeploymentPlacements
  
    /**
   * Host-resolved placement fingerprints/bindings used to prevent evidence reuse across changed destinations.
   */
  placementBindings?: Record<string,string>
}
/**
 * Host application configuration whose explicit selections determine generated platform files.
 * @see {@link resolveManifest} for the canonical usage example and runtime requirements.
 */
export interface PlatformManifest {
  
    /**
   * Optional registered local site and control-service capabilities.
   */
  siteOperations?: SiteOperationsConfig
  
    /**
   * Optional explicit tenant/database runtime placement catalog.
   */
  runtime?: PlatformRuntimeConfig
  
    /**
   * Explicit acquired code registrations; each is bound to a verified inventory.
   */
  packages?: PlatformPackage[]
  
    /**
   * Core platform service/domain/identity configuration.
   */
  platform: PlatformConfig
  
    /**
   * Supported host overrides applied while resolving the platform contract.
   */
  overrides?: PlatformConfigOverrides
  
    /**
   * Non-secret image, transport, database and placement selection.
   */
  deployment: PlatformDeployment
}
/**
 * Rendered application/accessory/migration service configuration shared by Compose and Kamal outputs.
 * @see {@link renderPlatform} for the canonical usage example and runtime requirements.
 */
export interface ServiceDefinition {
  
    /**
   * Stable service name used for generated dependency and role configuration.
   */
  name: string
  
    /**
   * Selected container image; actual execution requires a reviewed immutable version.
   */
  image: string
  
    /**
   * Optional explicit argument vector for the service command.
   */
  command?: string[]
  
    /**
   * Non-secret generated environment values; credentials belong in trusted runtime bindings.
   */
  environment?: Record<string, string>
  
    /**
   * Generated file mounts with source and container target paths.
   */
  files?: Array<{
    /** Generated configuration filename beneath the platform output, rendered as a read-only container mount. */
  source: string;
    /** Container destination path for the generated configuration mount. */
  target: string }>
  
    /**
   * Host-owned sensitive/runtime file bindings and their container targets.
   */
  runtimeFiles?: Array<{
    /** Host runtime-binding key resolved to a trusted file/directory path during rendering. */
  binding: string;
    /** Container destination path receiving the bound host file/directory. */
  target: string }>
  
    /**
   * Explicit host/container port mappings rendered for the selected transport.
   */
  ports?: string[]
  
    /**
   * Dependencies whose service_healthy condition gates startup.
   */
  dependsOn?: Record<string, {
    /** Require the dependency to become service_healthy before starting this service. */
  condition: 'service_healthy' }>
  
    /**
   * Explicit test argv, interval, timeout and retry count.
   */
  healthcheck?: {
    /** Container health-check command vector. */
    test: string[]
    /** Container duration string between checks. */
    interval: string
    /** Container duration string limiting one check. */
    timeout: string
    /** Failed-check count used by the container health configuration. */
    retries: number
  }
  
    /**
   * Optional persistent volume source and container mount target.
   */
  volume?: {
    /** Named persistent volume identifier rendered into the service mount. */
  source: string;
    /** Container mount path at which the persistent volume is attached. */
  target: string }
  
    /**
   * Application, accessory or migration role used to render the correct lifecycle behavior.
   */
  role: 'app' | 'accessory' | 'migration'
}
/**
 * Serialize a JSON-compatible value with two-space indentation and a trailing newline.
 * @param value - Value to serialize; must be JSON-compatible.
 * @returns Serialized text ending in a newline.
 * @throws Circular references or BigInt throw through JSON.stringify; unsupported values follow JSON.stringify semantics.
 * @example
 * import { json } from '@alneas/eaos-cli/platform/render'
 * const text = json({ ready: true })
 */
export const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
function fail(message: string): never { throw new Error(`Platform generation: ${message}`) }
function record(value: unknown, keys: string[], context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${context} must be an object`)
  if (Object.keys(value).some(key => !keys.includes(key))) fail(`${context} contains an unknown key`)
  return value as Record<string, unknown>
}
function image(value: unknown): string {
  // Require an explicit tag or digest; prohibit interpolation and credential-bearing URLs.
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:/-]*(?::[A-Za-z0-9_][A-Za-z0-9_.-]*|@sha256:[a-f0-9]{64})$/.test(value) ||
      value.includes('://') || value.endsWith(':latest') || !/[:@]/.test(value.split('/').at(-1)!)) fail('images require explicit tags or SHA256 digests')
  return value
}
/**
 * Validate a manifest or preset and resolve pure platform, deployment and package configuration.
 * @param input - Untrusted manifest value with explicit platform/deployment/package selections.
 * @returns Resolved platform config, deployment, packages and optional runtime metadata.
 * @throws Rejects unknown fields, invalid presets, missing or incompatible runtime/database/image/placement settings.
 * @remarks Does not load runtime factories or create resources; live adoption still requires reviewed host operations.
 * @example
 * import { resolveManifest } from '@alneas/eaos-cli/platform/render'
 * export function parseHost(input: unknown) { return resolveManifest(input) }
 */
export function resolveManifest(input: unknown): { 
/**
 * Resolved platform identity, service, origin and runtime configuration after preset/override validation.
 */
config: ResolvedPlatformConfig; 
/**
 * Resolved images, database volume, Compose/Kamal target and optional explicit placement/binding metadata.
 */
deployment: ResolvedDeployment; 
/**
 * Validated explicit package registrations with concrete tenant/plugin scopes; factories are not loaded here.
 */
packages: PlatformPackage[]; 
/**
 * Optional validated default/additional database targets and explicit tenant placements; absence means no platform runtime declaration.
 */
runtime?: PlatformRuntimeConfig } {
  const manifest = record(expandPreset(input), ['platform', 'overrides', 'deployment', 'packages', 'runtime', 'siteOperations', 'preset', 'plugins', 'corporatePackages'], 'manifest')
  if (!manifest.preset && (manifest.plugins !== undefined || manifest.corporatePackages !== undefined)) fail('plugins and corporatePackages require a preset')
  if (manifest.siteOperations !== undefined) parseSiteOperationsConfig(manifest.siteOperations)
  const config = resolvePlatformConfig(manifest.platform, manifest.overrides)
  const deployment = record(manifest.deployment, ['images', 'database', 'target', 'kamal', 'placements'], 'deployment')
  const target = deployment.target === undefined ? 'compose' : deployment.target
  if (target !== 'compose' && target !== 'kamal' && target !== 'both') fail('unsupported deployment target')
  if (target === 'compose' && deployment.kamal !== undefined) fail('kamal settings require target kamal or both')
  const kamal = target === 'compose' ? undefined : resolveKamal(deployment.kamal, config)
  const images = record(deployment.images, ['backend', 'frontend', 'worker', 'agentRuntime', 'nginx', 'kratos', 'postgres'], 'images')
  const defaults = { nginx: 'nginx:1.30-alpine', kratos: 'oryd/kratos:v26.2.0', postgres: 'postgres:16-alpine' }
  const resolvedImages = Object.fromEntries(Object.entries({ ...defaults, ...images }).map(([key, value]) => [key, image(value)])) as ResolvedDeployment['images']
  if (!resolvedImages.backend || !resolvedImages.frontend) fail('backend and frontend images are required')
  if ((kamal && ((kamal.worker && !resolvedImages.worker) || (!kamal.worker && resolvedImages.worker))) || (!kamal && resolvedImages.worker)) fail('worker image and kamal.worker must be configured together')
  if ((kamal?.agentRuntime && !resolvedImages.agentRuntime) || (!kamal?.agentRuntime && resolvedImages.agentRuntime)) fail('agent runtime image and kamal.agentRuntime must be configured together')
  const database = deployment.database === undefined ? { volumeName: `${config.appName}-kratos-data`, external: false } : record(deployment.database, ['volumeName', 'external'], 'database')
  if (typeof database.volumeName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(database.volumeName) || typeof database.external !== 'boolean') fail('database requires volumeName and external')
  if (Object.values(config.services).some(service => ['nginx', 'kratos-db', 'kratos-migrate'].includes(service.name))) fail('service alias conflicts with a reserved deployment service')
  const urls = Object.values(config.origins).map(origin => new URL(origin))
  if (urls.some(url => !/^[a-z0-9.-]+$/.test(url.hostname))) fail('generated nginx requires DNS hostnames')
  if (urls[0].protocol !== urls[1].protocol) fail('generated nginx requires matching app/auth protocols')
  if (urls[0].hostname === urls[1].hostname) fail('generated nginx requires distinct app/auth hostnames')
  // A port cannot simultaneously accept plain HTTP and TLS (including the redirect listener).
  if (urls[0].protocol === 'https:' && urls.some(url => url.port === '80')) fail('HTTPS port 80 conflicts with the HTTP redirect listener')
  const packages=validatePlatformPackages(manifest.packages), runtime=validatePlatformRuntime(manifest.runtime,packages)
  let placements:DeploymentPlacements|undefined
  const placementBindings:Record<string,string>={}
  if(deployment.placements!==undefined) {
    validateDeploymentPlacements(deployment.placements)
    placements={...deployment.placements,destinations:deployment.placements.destinations.map(destination=>{
      if(destination.placement!=='database')return destination
      const db=runtime&&platformDatabaseTargets(runtime).find(t=>t.id===destination.backendId&&t.databaseId===destination.databaseId)
      if(!db)fail('placement database must reference a declared runtime target')
      if(db.mode==='dedicated'&&destination.tenantId&&destination.tenantId!==db.tenantId)fail('placement tenant differs from dedicated database')
      return {...destination,...(db.mode==='dedicated'?{tenantId:db.tenantId}:{})}
    })}
    for(const destination of placements.destinations) {
      const databaseTarget=runtime&&platformDatabaseTargets(runtime).find(t=>t.id===destination.backendId&&t.databaseId===destination.databaseId)
      if(destination.placement==='database'&&!databaseTarget) fail('placement database must reference a declared runtime target')
      if(destination.service==='worker'&&!resolvedImages.worker) fail('placement worker requires the configured worker image/host')
      const service=destination.service
      placementBindings[destination.id]=canonicalJsonHash(JSON.parse(JSON.stringify({destination,database:databaseTarget??null,service:service?{role:service,config,image:resolvedImages[service],host:service==='worker'?kamal?.worker??null:kamal??null}:null})))
    }
  }
  return { config, packages, runtime, deployment: { images: resolvedImages, database: database as ResolvedDeployment['database'], target, kamal, ...(placements?{placements,placementBindings}:{}) } }
}

/**
 * Default email-identity JSON Schema used while rendering the platform identity configuration.
 * @see {@link renderPlatform} for the canonical usage example and runtime requirements.
 */
export const emailIdentitySchema = {
  $schema: 'http://json-schema.org/draft-07/schema#', title: 'EAOS email identity v1', type: 'object',
  properties: { traits: { type: 'object', properties: {
    email: { type: 'string', format: 'email', 'ory.sh/kratos': { credentials: { password: { identifier: true } }, verification: { via: 'email' } } },
    name: { type: 'string' },
  }, required: ['email'], additionalProperties: false } },
  required: ['traits'], additionalProperties: false,
}

// Only these two identity fields are sent; business membership/authorization stays host-owned.
/**
 * Default registration-email body template rendered into host identity configuration.
 * @see {@link renderPlatform} for the canonical usage example and runtime requirements.
 */
export const registrationEmailBody = 'function(ctx) { email: ctx.identity.traits.email, identity_id: ctx.identity.id }\n'
/**
 * Generated relative filename for the registration-email body template.
 * @see {@link renderPlatform} for the canonical usage example and runtime requirements.
 */
export const registrationBodyFile = 'kratos/registration-body.jsonnet'
const registrationBodyTarget = '/etc/config/kratos/registration-body.jsonnet'
/**
 * Generated relative filename for the Google verified-email identity mapper.
 * @see {@link renderPlatform} for the canonical usage example and runtime requirements.
 */
export const googleMapperFile = 'kratos/google-mapper.jsonnet'
const googleMapperTarget = '/etc/config/kratos/google-mapper.jsonnet'
/**
 * Jsonnet identity-mapping source that accepts the configured Google identity claims.
 * @see {@link renderPlatform} for the canonical usage example and runtime requirements.
 */
export const googleVerifiedEmailMapper = `local claims = std.extVar('claims');
assert std.objectHas(claims, 'email_verified') && claims.email_verified == true : 'Verified email required';
assert std.objectHas(claims, 'email') && std.type(claims.email) == 'string' && std.length(claims.email) > 0 : 'Email required';
{ identity: { traits: { email: claims.email }, verified_addresses: [{ via: 'email', value: claims.email }] } }
`

function nginx(config: ResolvedPlatformConfig, backendAddress?: string): string {
  // nginx variable proxy_pass uses its DNS resolver, which ignores Docker add-host.
  // Split-host placement has a validated private address; use it directly.
  const apiUpstream = new URL(config.nginx.api.upstream)
  if (backendAddress && apiUpstream.hostname === config.services.backend.name) apiUpstream.hostname = backendAddress
  const resolvedApiUpstream = apiUpstream.origin
  const urls = [new URL(config.origins.app), new URL(config.origins.auth)]
  const redirectUrls = [...config.nginx.appServerNames.map(hostname => {
    const url = new URL(config.origins.app)
    url.hostname = hostname
    return url
  }), urls[1], ...config.nginx.hostRoutes.map(route => new URL(route.origin))]
  const tls = urls[0].protocol === 'https:'
  const listens = [...new Set(urls.map(url => Number(url.port || (tls ? 443 : 80))))]
  const proxy = (upstream: string, route?: ResolvedPlatformConfig['nginx']['hostRoutes'][number]) => `
      ${route?.resolution === 'system' ? `proxy_pass ${upstream};` : `set $target ${upstream};\n      proxy_pass $target;`}
      proxy_http_version 1.1;
      proxy_set_header Host $http_host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_read_timeout ${route?.proxy.readTimeoutSeconds ?? 180}s;${route ? `\n      proxy_send_timeout ${route.proxy.sendTimeoutSeconds}s;` : ''}
      proxy_buffering ${route?.proxy.buffering ? 'on' : 'off'};`
  const certificate = tls ? '\n    ssl_certificate /etc/nginx/tls/cert.pem;\n    ssl_certificate_key /etc/nginx/tls/key.pem;\n    ssl_protocols TLSv1.2 TLSv1.3;' : ''
  return `# Generated by EAOS. Change eaos.platform.json, not this file.
worker_processes auto;
events { worker_connections 1024; }
http {
${config.nginx.appServerNames.length > 1 || config.nginx.hostRoutes.length ? '  server_names_hash_bucket_size 512;\n' : ''}  include /etc/nginx/mime.types;
  resolver 127.0.0.11 valid=10s ipv6=off;
  map $http_upgrade $connection_upgrade { default upgrade; '' close; }
  access_log off;
  error_log /dev/stderr warn;
${listens.map(port => `  server { listen ${port}${tls ? ' ssl' : ''} default_server; server_name _;${certificate} return 444; }`).join('\n')}
${tls ? `  server { listen 80 default_server; server_name _; return 444; }\n` + redirectUrls.map(url => `  server { listen 80; server_name ${url.hostname}; return 308 ${url.origin}$request_uri; }`).join('\n') : ''}
${urls.map((url, index) => `  server {
    listen ${url.port || (tls ? 443 : 80)}${tls ? ' ssl' : ''};
    server_name ${index === 0 ? config.nginx.appServerNames.join(' ') : url.hostname};${certificate}
${index === 0 ? config.nginx.api.prefixes.map(prefix => `    location = ${prefix} {${proxy(resolvedApiUpstream)}\n    }\n    location ${prefix}/ {${proxy(resolvedApiUpstream)}\n    }`).join('\n') : ''}
    location / {${proxy(index === 0 ? config.nginx.frontendUpstream : config.nginx.authUpstream)}
    }
  }`).join('\n')}${config.nginx.hostRoutes.map(route => `
  server {
    listen ${urls[0].port || (tls ? 443 : 80)}${tls ? ' ssl' : ''};
    server_name ${route.host};${certificate}
    location / {${proxy(route.upstream, route)}
    }
  }`).join('')}
}
`
}

/**
 * Render platform application and infrastructure configuration as filename/text pairs.
 * @param config - Validated platform configuration.
 * @param deployment - Resolved images, database, target and placement configuration.
 * @param schemas - Identity schema records used by generated authentication configuration.
 * @param sources - Optional reviewed source/configuration text passed through to the renderer.
 * @returns Generated configuration files and their textual content.
 * @throws Invalid or unsupported configuration can fail while rendering.
 * @remarks Rendering does not write files, deploy services, rotate credentials or grant access.
 * @example
 * import { renderPlatform } from '@alneas/eaos-cli/platform/render'
 * export function renderHost(...args: Parameters<typeof renderPlatform>) { return renderPlatform(...args) }
 */
export function renderPlatform(config: ResolvedPlatformConfig, deployment: ResolvedDeployment, schemas: Record<string, unknown>, sources: { 
/**
 * Optional reviewed registration-hook Jsonnet text loaded by the caller; required when a custom body file is selected instead of the built-in identity-email-v1 body.
 */
registrationBody?: string; 
/**
 * Optional reviewed Google identity-mapper Jsonnet text loaded by the caller; required for a custom mapper instead of the built-in verified-email mapper.
 */
googleMapper?: string } = {}): Record<string, string> {
  const { services: s, kratos: k } = config
  const { registrationBody, googleMapper } = sources
  const files: Record<string, string> = { 'resolved.json': json(config), 'nginx/nginx.conf': nginx(config, deployment.kamal?.worker?.privateAddress), 'hono.json': json(config.hono) }
  for (const schema of k.identitySchemas) files[`kratos/identity-${schema.id}.json`] = json(schemas[schema.id])
  const flows: Record<string, unknown> = Object.fromEntries(['error', 'login', 'registration', 'settings', 'recovery', 'verification'].map(flow => [flow, { ui_url: k.ui[flow as keyof typeof k.ui] }]))
  flows.recovery = { enabled: false, ui_url: k.ui.recovery }
  flows.verification = { enabled: false, ui_url: k.ui.verification }
  flows.logout = { after: { default_browser_return_url: k.ui.logout } }
  const registrationHooks: Array<Record<string, unknown>> = []
  if (k.registrationHook) {
    const hook = k.registrationHook
    if (hook.body) {
      if (hook.body !== 'identity-email-v1' && registrationBody === undefined) fail('registration body file must be loaded before rendering')
      files[registrationBodyFile] = hook.body === 'identity-email-v1' ? registrationEmailBody : registrationBody!
    }
    if (hook.session === 'before') registrationHooks.push({ hook: 'session' })
    registrationHooks.push({ hook: 'web_hook', config: {
      url: hook.url, method: 'POST', ...(hook.body ? { body: `file://${registrationBodyTarget}` } : {}),
      auth: { type: 'api_key', config: { name: hook.authHeader, in: 'header' } },
    } })
    if (hook.session === 'after') registrationHooks.push({ hook: 'session' })
    flows.registration = { ui_url: k.ui.registration, after: { password: { hooks: registrationHooks } } }
  }
  const oidcProviders = k.oidc ? [{ id: k.oidc.google.id, provider: 'google', mapper_url: `file://${googleMapperTarget}`, scope: k.oidc.google.scopes }] : []
  if (k.oidc) {
    if (k.oidc.google.mapper !== 'google-verified-email-v1' && googleMapper === undefined) fail('Google mapper file must be loaded before rendering')
    files[googleMapperFile] = k.oidc.google.mapper === 'google-verified-email-v1' ? googleVerifiedEmailMapper : googleMapper!
  }
  files['kratos/kratos.yml'] = json({
    version: 'v1.3.0',
    serve: {
      public: { host: '0.0.0.0', port: s.kratos.port, base_url: k.publicUrl, cors: { enabled: true, allowed_origins: k.corsOrigins, allowed_methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowed_headers: ['Authorization', 'Content-Type', 'Cookie', 'X-CSRF-Token'], exposed_headers: ['Content-Type', 'Set-Cookie'], allow_credentials: true } },
      admin: { host: '0.0.0.0', port: s.kratos.adminPort, base_url: k.adminUrl },
    },
    selfservice: { default_browser_return_url: k.defaultBrowserReturnUrl, allowed_return_urls: k.allowedReturnUrls, methods: { password: { enabled: true }, ...(k.oidc ? { oidc: { enabled: true, config: { providers: oidcProviders } } } : {}) }, flows },
    session: { cookie: { name: k.cookie.name, domain: k.cookie.domain, path: k.cookie.path, same_site: k.cookie.sameSite, persistent: k.cookie.persistent } },
    cookies: { domain: k.cookie.domain, path: k.cookie.path, same_site: k.cookie.sameSite },
    identity: { default_schema_id: k.defaultSchemaId, schemas: k.identitySchemas.map(schema => ({ id: schema.id, url: `file:///etc/config/kratos/identity-${schema.id}.json` })) },
    log: { level: 'info', format: 'json', leak_sensitive_values: false },
  })
  const kratosFiles = [{ source: 'kratos/kratos.yml', target: '/etc/config/kratos/kratos.yml' }, ...k.identitySchemas.map(schema => ({ source: `kratos/identity-${schema.id}.json`, target: `/etc/config/kratos/identity-${schema.id}.json` }))]
  if (k.registrationHook && k.registrationHook.body) kratosFiles.push({ source: registrationBodyFile, target: registrationBodyTarget })
  if (k.oidc) kratosFiles.push({ source: googleMapperFile, target: googleMapperTarget })
  const kratosRuntime = [{ binding: 'EAOS_KRATOS_RUNTIME_CONFIG', target: '/run/eaos/kratos-runtime.yml' }]
  const configArgs = ['-c', '/etc/config/kratos/kratos.yml', '-c', '/run/eaos/kratos-runtime.yml']
  const https = config.origins.app.startsWith('https:')
  const publicPorts = [...new Set(Object.values(config.origins).map(origin => { const url = new URL(origin); return url.port || (https ? '443' : '80') }))]
  if (https && !publicPorts.includes('80')) publicPorts.push('80')
  const definitions: ServiceDefinition[] = [
    { name: s.backend.name, image: deployment.images.backend, role: 'app', environment: { PORT: String(s.backend.port), KRATOS_PUBLIC_URL: config.hono.kratosPublicUrl, KRATOS_ADMIN_URL: config.kratos.adminUrl, KRATOS_BROWSER_URL: config.hono.kratosBrowserUrl, AUTH_RETURN_TO: config.kratos.defaultBrowserReturnUrl, CORS_ALLOW_ORIGIN: config.hono.corsOrigins.join(',') } },
    { name: s.frontend.name, image: deployment.images.frontend, role: 'app' },
    { name: 'kratos-db', image: deployment.images.postgres!, role: 'accessory', environment: { POSTGRES_USER: 'kratos', POSTGRES_DB: 'kratos', POSTGRES_PASSWORD_FILE: '/run/eaos/postgres-password' }, runtimeFiles: [{ binding: 'EAOS_KRATOS_DB_PASSWORD_FILE', target: '/run/eaos/postgres-password' }], healthcheck: { test: ['CMD-SHELL', 'pg_isready -U kratos -d kratos'], interval: '5s', timeout: '5s', retries: 20 }, volume: { source: 'kratos-data', target: '/var/lib/postgresql/data' } },
    { name: s.kratos.name, image: deployment.images.kratos!, role: 'accessory', command: ['serve', ...configArgs, ...(!k.cookie.secure ? ['--dev'] : [])], files: kratosFiles, runtimeFiles: kratosRuntime, dependsOn: { 'kratos-db': { condition: 'service_healthy' } } },
    { name: 'kratos-migrate', image: deployment.images.kratos!, role: 'migration', command: ['migrate', 'sql', 'up', '-e', '--yes', ...configArgs], files: kratosFiles, runtimeFiles: kratosRuntime, dependsOn: { 'kratos-db': { condition: 'service_healthy' } } },
    { name: 'nginx', image: deployment.images.nginx!, role: 'accessory', files: [{ source: 'nginx/nginx.conf', target: '/etc/nginx/nginx.conf' }], runtimeFiles: https ? [{ binding: 'EAOS_TLS_DIRECTORY', target: '/etc/nginx/tls' }] : [], ports: publicPorts.map(port => `${port}:${port}`) },
  ]
  const runtimePolicy = defaultRuntimePlacementPolicy()
  files['services.json'] = json({ formatVersion: 1, networkName: config.networkName, database: deployment.database, services: definitions })
  files['runtime-policy.json'] = json(runtimePolicy)
  const composeServices = Object.fromEntries(definitions.map(service => [service.name, {
    image: service.image, command: service.command, environment: service.environment,
    restart: service.role === 'migration' ? 'no' : 'unless-stopped',
    networks: { platform: { aliases: [service.name] } }, ports: service.ports,
    profiles: service.role === 'migration' ? ['operations'] : undefined,
    depends_on: service.dependsOn,
    healthcheck: service.healthcheck,
    volumes: [
      ...(service.files || []).map(file => ({ type: 'bind', source: `./${file.source}`, target: file.target, read_only: true, bind: { create_host_path: false } })),
      ...(service.runtimeFiles || []).map(file => ({ type: 'bind', source: '${' + file.binding + ':?required absolute runtime path}', target: file.target, read_only: true, bind: { create_host_path: false } })),
      ...(service.volume ? [{ type: 'volume', ...service.volume }] : []),
    ],
  }]))
  if (deployment.target !== 'kamal') files['compose.yml'] = json({ name: config.appName, services: composeServices, networks: { platform: { name: config.networkName } }, volumes: { 'kratos-data': { name: deployment.database.volumeName, external: deployment.database.external } } })
  if (deployment.kamal) Object.assign(files, renderKamal(config, deployment.kamal, definitions, deployment.database, deployment.images.worker, deployment.images.agentRuntime))
  files['runtime-contract.json'] = json({
    formatVersion: 1,
    resourcePolicy: runtimePolicy,
    files: {
      EAOS_KRATOS_RUNTIME_CONFIG: { content: 'Host-owned Kratos YAML/JSON loaded after the generated config', requiredFields: ['dsn', 'secrets.cookie', 'secrets.cipher', 'secrets.pagination'], dsnHost: 'kratos-db', database: 'kratos', user: 'kratos', ...(k.registrationHook ? { registrationHook: {
        url: k.registrationHook.url, method: 'POST', header: k.registrationHook.authHeader,
        hooksPath: 'selfservice.flows.registration.after.password.hooks', hooks: registrationHooks,
        secretValuePath: `selfservice.flows.registration.after.password.hooks.${k.registrationHook.session === 'before' ? 1 : 0}.config.auth.config.value`,
        requirement: 'Supply this complete hooks array in the runtime overlay and fill the web_hook auth.config.value with the existing secret. Preserve order, URL, method, header and body. Authenticate and validate payloads in the backend handler.',
      } } : {}), ...(k.oidc ? { oidc: {
        providersPath: 'selfservice.methods.oidc.config.providers', providers: oidcProviders,
        providerId: k.oidc.google.id, callbackUrl: k.oidc.google.callbackUrl,
        clientIdPath: 'selfservice.methods.oidc.config.providers.0.client_id',
        clientSecretPath: 'selfservice.methods.oidc.config.providers.0.client_secret',
        requirement: 'Supply this complete providers array in the runtime overlay and fill client_id and client_secret from host credentials. Preserve provider ID, mapper and scopes. Register and verify the callback URL with Google. Do not drop existing providers when adopting.',
      } } : {}) },
      EAOS_KRATOS_DB_PASSWORD_FILE: { content: 'Existing PostgreSQL password matching the DSN; never rotate by rendering' },
      ...(https ? { EAOS_TLS_DIRECTORY: { content: 'Directory containing cert.pem and key.pem covering all listed server names', serverNames: [...config.nginx.appServerNames, new URL(config.origins.auth).hostname, ...config.nginx.hostRoutes.map(route => route.host)] } } : {}),
    },
    ...(config.nginx.hostRoutes.length ? { ingress: {
      hostRoutes: config.nginx.hostRoutes,
      externalUpstreams: config.nginx.hostRoutes.filter(route => route.service === 'external').map(route => ({ host: route.host, upstream: route.upstream, resolution: route.resolution })),
      requirement: 'Host routes publish every path to the selected HTTP upstream. Supply external services and nginx network reachability separately. Docker resolution uses 127.0.0.11; system resolution requires container DNS or hosts entries at nginx startup/reload. No extra_hosts or external services are provisioned. Review upstream authentication, forwarded cookies and CORS independently.',
    } } : {}),
    operations: ['Provision runtime files and UI/backend handlers', 'Start kratos-db only; back up existing data', 'Explicitly run the selected deployment target migration operation after review', 'Start application services', 'Verify login, logout, CSRF and persistence'],
    kamal: {
      status: deployment.kamal ? 'generated; see kamal-operations.json before deployment' : 'not selected',
      networkName: config.networkName,
      appAliases: [s.backend.name, s.frontend.name],
      accessoryAliases: ['nginx', s.kratos.name, 'kratos-db'],
      ...(deployment.kamal?.agentRuntime?.privateAddress ? {
        agentRuntime: {
          service: deployment.kamal.agentRuntime.service,
          endpoint: `https://${deployment.kamal.agentRuntime.privateAddress}:${deployment.kamal.agentRuntime.port}/agent/run`,
          health: `https://${deployment.kamal.agentRuntime.privateAddress}:${deployment.kamal.agentRuntime.port}/health`,
          runtimeRole: 'ai',
        },
      } : {}),
      note: 'Main app deploy and accessory updates are separate. Preserve existing volumes, keys, network and schema IDs. Migration is an explicit one-shot operation.',
    },
  })
  return files
}
