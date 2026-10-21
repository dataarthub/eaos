import type { ResolvedPlatformConfig } from '@alneas/eaos-core/platform/config'
import type { ServiceDefinition } from './render'

/**
 * Explicit SSH host, role, registry and runtime-file inputs for Kamal configuration.
 * @see {@link resolveKamal} for the canonical usage example and runtime requirements.
 */
export interface KamalDeployment {
      /**
   * Reviewed SSH host or configured alias selected by the host.
   */
  host: string
  
    /**
   * Container/host architecture, amd64 or arm64.
   */
  arch?: 'amd64' | 'arm64'
  
    /**
   * Optional trusted SSH user and port configuration.
   */
  ssh?: {
    /** Main-host SSH username; defaults to root and must match the lowercase POSIX-like username grammar. */
  user?: string;
    /** Main-host SSH port, integer 1–65535; defaults to 22. */
  port?: number }
  
    /**
   * Explicit backend/frontend service names.
   */
  services?: {
    /** Backend Kamal service name; defaults to appName-backend and must differ from frontend. */
  backend?: string;
    /** Frontend Kamal service name; defaults to appName-frontend and must differ from backend. */
  frontend?: string }
  
    /**
   * Registry credential environment-binding names; plaintext values are supplied by the host at execution.
   */
  registry?: {
    /** Uppercase registry-username environment binding; defaults to KAMAL_REGISTRY_USERNAME. */
  usernameSecret?: string;
    /** Uppercase registry-password environment binding; defaults to KAMAL_REGISTRY_PASSWORD. */
  passwordSecret?: string }
  
    /**
   * Host runtime directory for generated configuration and secrets mounts.
   */
  runtimeDirectory?: string
  
    /**
   * Registered host paths for identity configuration, database password and optional TLS files.
   */
  runtimeFiles?: {
    /** Absolute host Kratos runtime YAML path; defaults to runtimeDirectory/kratos-runtime.yml and cannot overlap other runtime/migration paths. */
  kratosConfig?: string;
    /** Absolute host database-password file path; defaults to runtimeDirectory/postgres-password and cannot overlap other runtime/migration paths. */
  databasePassword?: string;
    /** Absolute host platform TLS directory; defaults to runtimeDirectory/tls and cannot overlap other runtime/migration paths. */
  tlsDirectory?: string }
      /**
   * Optional separate worker host and private service endpoints.
   */
  worker?: {
    /** Reviewed worker SSH host/alias, required to differ from the main host. */
    host: string
    /** Required host-selected worker address used for private application routing. */
    privateAddress: string
    /** Required host-selected HTTP(S) Kratos administrator URL for the worker; host network policy must keep administration private. */
    kratosAdminUrl: string
    /** Worker image architecture; defaults to the main deployment architecture. */
    arch?: 'amd64' | 'arm64'
    /** Trusted per-role SSH overrides; omitted fields inherit the resolved main SSH user and port. */
    ssh?: {
    /** Role SSH username; omitted inherits the main user, including its root default. */
    user?: string;
    /** Role SSH port, integer 1–65535; defaults to the selected main SSH port. */
    port?: number }
    /** Worker Kamal service name; defaults to appName-worker. */
    service?: string
  }
      /**
   * Optional separate agent-runtime host, port and reviewed network bindings.
   */
  agentRuntime?: {
    /** Reviewed agent-runtime SSH host/alias; validation does not prove private network isolation. */
    host: string
    /** Optional host-selected address advertised for private runtime connections; omitted remains absent. */
    privateAddress?: string
    /** Agent-runtime image architecture; defaults to arm64 independently of the main host. */
    arch?: 'amd64' | 'arm64'
    /** Agent service port, integer 1–65535; defaults to 8443. */
    port?: number
    /** Trusted per-role SSH overrides; omitted fields inherit the resolved main SSH user and port. */
    ssh?: {
    /** Role SSH username; omitted inherits the main user, including its root default. */
    user?: string;
    /** Role SSH port, integer 1–65535; defaults to the selected main SSH port. */
    port?: number }
    /** Agent-runtime Kamal service name; defaults to appName-agent-runtime. */
    service?: string
    /** Absolute host runtime directory; defaults to main runtimeDirectory/agent-runtime and must avoid platform runtime/migration overlap. */
    runtimeDirectory?: string
    /** Absolute agent TLS directory; defaults to the agent runtimeDirectory/tls and must avoid platform runtime/migration overlap. */
    tlsDirectory?: string
  }
}
/**
 * Normalized worker role settings and its trusted private control endpoints.
 * @see {@link resolveKamal} for the canonical usage example and runtime requirements.
 */
export interface ResolvedKamalWorker {
  
    /**
   * Reviewed SSH host or alias used for worker deployment.
   */
  host: string
  
    /**
   * Host-selected private worker address used by other application components.
   */
  privateAddress: string
  
    /**
   * Trusted private Kratos administration endpoint; never a browser-selected URL.
   */
  kratosAdminUrl: string
  
    /**
   * Validated worker architecture.
   */
  arch: 'amd64' | 'arm64'
  
    /**
   * Resolved worker SSH user and port.
   */
  ssh: {
    /** Validated worker SSH username after applying role overrides to the resolved main user. */
  user: string;
    /** Validated worker SSH port, integer 1–65535, inherited from the main SSH port when omitted. */
  port: number }
  
    /**
   * Resolved unique worker service name.
   */
  service: string
}
/**
 * Validated Kamal host and role configuration with default names and paths resolved.
 * @see {@link resolveKamal} for the canonical usage example and runtime requirements.
 */
export interface ResolvedKamalDeployment {
  
    /**
   * Reviewed SSH host or configured alias selected by the host.
   */
  host: string
  
    /**
   * Container/host architecture, amd64 or arm64.
   */
  arch: 'amd64' | 'arm64'
  
    /**
   * Optional trusted SSH user and port configuration.
   */
  ssh: {
    /** Validated main-host SSH username. */
  user: string;
    /** Validated main-host SSH port, integer 1–65535. */
  port: number }
  
    /**
   * Explicit backend/frontend service names.
   */
  services: {
    /** Validated backend Kamal service name, distinct from frontend. */
  backend: string;
    /** Validated frontend Kamal service name, distinct from backend. */
  frontend: string }
  
    /**
   * Registry credential environment-binding names; plaintext values are supplied by the host at execution.
   */
  registry: {
    /** Validated environment-binding name for registry username lookup. */
  usernameSecret: string;
    /** Validated environment-binding name for registry password lookup. */
  passwordSecret: string }
  
    /**
   * Host runtime directory for generated configuration and secrets mounts.
   */
  runtimeDirectory: string
  
    /**
   * Registered host paths for identity configuration, database password and optional TLS files.
   */
  runtimeFiles: {
    /** Validated absolute host identity-configuration path. */
  kratosConfig: string;
    /** Validated absolute host database-password file path. */
  databasePassword: string;
    /** Validated absolute host platform TLS directory. */
  tlsDirectory: string }
  
    /**
   * Optional separate worker host and private service endpoints.
   */
  worker?: ResolvedKamalWorker
  
    /**
   * Optional separate agent-runtime host, port and reviewed network bindings.
   */
  agentRuntime?: {
    /** Reviewed agent-runtime SSH host/alias; validation does not prove private network isolation. */
    host: string
    /** Optional host-selected address advertised for private runtime connections; omitted remains absent. */
    privateAddress?: string
    /** Validated selected runtime architecture. */
    arch: 'amd64' | 'arm64'
    /** Validated agent service port, integer 1–65535. */
    port: number
    /** Normalized role SSH connection settings after input validation. */
    ssh: {
    /** Validated role SSH username. */
    user: string;
    /** Validated role SSH port, integer 1–65535. */
    port: number }
    /** Validated role service name used in generated Kamal configuration. */
    service: string
    /** Validated absolute host agent-runtime directory. */
    runtimeDirectory: string
    /** Validated absolute host directory containing agent-runtime TLS files. */
    tlsDirectory: string
  }
}
function fail(message: string): never { throw new Error(`Platform generation: ${message}`) }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('kamal settings must be objects')
  if (Object.keys(value).some(key => !keys.includes(key))) fail('kamal settings contain an unknown key')
  return value as Record<string, unknown>
}
function text(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) fail(`invalid kamal ${field}`)
  return value
}
function path(value: unknown): string {
  const result = text(value, /^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/, 'absolute runtime path')
  if (result.split('/').some(segment => segment === '.' || segment === '..')) fail('invalid kamal runtime path segments')
  return result
}
/**
 * Validate a Kamal deployment against resolved platform ports, hosts and service settings.
 * @param value - Untrusted Kamal settings object.
 * @param config - Resolved platform contract; networkName must be kamal.
 * @returns Normalized Kamal deployment settings with explicit host, registry, services and paths.
 * @throws If settings contain unknown keys, invalid hosts/ports/paths or incompatible platform networking.
 * @remarks Configuration validation does not contact SSH hosts or prove their authorization/security.
 * @example
 * import { resolveKamal } from '@alneas/eaos-cli/platform/kamal'
 * export function validateHost(value: unknown, config: Parameters<typeof resolveKamal>[1]) { return resolveKamal(value, config) }
 */
export function resolveKamal(value: unknown, config: ResolvedPlatformConfig): ResolvedKamalDeployment {
  const input = object(value, ['host', 'arch', 'ssh', 'services', 'registry', 'runtimeDirectory', 'runtimeFiles', 'worker', 'agentRuntime'])
  if (config.networkName !== 'kamal') fail('Kamal requires platform.networkName to be kamal; other networks are not silently remapped')
  const ssh = input.ssh === undefined ? {} : object(input.ssh, ['user', 'port'])
  const names = input.services === undefined ? {} : object(input.services, ['backend', 'frontend'])
  const registry = input.registry === undefined ? {} : object(input.registry, ['usernameSecret', 'passwordSecret'])
  const runtime = input.runtimeFiles === undefined ? {} : object(input.runtimeFiles, ['kratosConfig', 'databasePassword', 'tlsDirectory'])
  const choose = (value: unknown, fallback: unknown) => value === undefined ? fallback : value
  const port = choose(ssh.port, 22)
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) fail('invalid kamal SSH port')
  const user = text(choose(ssh.user, 'root'), /^[a-z_][a-z0-9_-]{0,31}$/, 'SSH user')
  const arch = choose(input.arch, 'amd64')
  if (arch !== 'amd64' && arch !== 'arm64') fail('invalid kamal architecture')
  const root = path(choose(input.runtimeDirectory, `/etc/eaos/${config.appName}`))
  const edgeHost = text(input.host, /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/, 'host or SSH alias')
  const name = (value: unknown, fallback: string) => text(choose(value, fallback), /^[a-z0-9][a-z0-9-]{0,127}$/, 'service name')
  const services = { backend: name(names.backend, `${config.appName}-backend`), frontend: name(names.frontend, `${config.appName}-frontend`) }
  if (services.backend === services.frontend) fail('Kamal backend and frontend service names must differ')
  const secret = (value: unknown, fallback: string) => text(choose(value, fallback), /^[A-Z][A-Z0-9_]{0,127}$/, 'registry secret key')
  const runtimeFiles = { kratosConfig: path(choose(runtime.kratosConfig, `${root}/kratos-runtime.yml`)), databasePassword: path(choose(runtime.databasePassword, `${root}/postgres-password`)), tlsDirectory: path(choose(runtime.tlsDirectory, `${root}/tls`)) }
  const overlaps = (a: string, b: string) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/')
  const paths = Object.values(runtimeFiles)
  if (paths.some(value => overlaps(value, `${root}/migration`)) || paths.some((value, i) => paths.slice(i + 1).some(other => overlaps(value, other)))) fail('Kamal runtime paths must not overlap each other or migration uploads')
  let worker: ResolvedKamalWorker | undefined
  if (input.worker !== undefined) {
    const workerInput = object(input.worker, ['host', 'privateAddress', 'kratosAdminUrl', 'arch', 'ssh', 'service'])
    const workerSsh = workerInput.ssh === undefined ? {} : object(workerInput.ssh, ['user', 'port'])
    const workerPort = choose(workerSsh.port, port)
    if (typeof workerPort !== 'number' || !Number.isInteger(workerPort) || workerPort < 1 || workerPort > 65535) fail('invalid worker SSH port')
    const workerArch = choose(workerInput.arch, arch)
    if (workerArch !== 'amd64' && workerArch !== 'arm64') fail('invalid worker architecture')
    const address = text(workerInput.privateAddress, /^(?:[A-Za-z0-9][A-Za-z0-9.-]{0,252})$/, 'worker private address')
    const adminUrl = text(workerInput.kratosAdminUrl, /^https?:\/\/[^\s]+$/, 'worker Kratos admin URL')
    worker = {
      host: text(workerInput.host, /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/, 'worker host or SSH alias'),
      privateAddress: address,
      kratosAdminUrl: adminUrl,
      arch: workerArch,
      ssh: { user: text(choose(workerSsh.user, user), /^[a-z_][a-z0-9_-]{0,31}$/, 'worker SSH user'), port: workerPort },
      service: name(workerInput.service, `${config.appName}-worker`),
    }
    if (worker.host === edgeHost) fail('worker host must differ from the edge host')
  }
  let agentRuntime: ResolvedKamalDeployment['agentRuntime']
  if (input.agentRuntime !== undefined) {
    const agentInput = object(input.agentRuntime, ['host', 'privateAddress', 'arch', 'port', 'ssh', 'service', 'runtimeDirectory', 'tlsDirectory'])
    const agentSsh = agentInput.ssh === undefined ? {} : object(agentInput.ssh, ['user', 'port'])
    const agentPort = choose(agentInput.port, 8443)
    const agentSshPort = choose(agentSsh.port, port)
    if (typeof agentPort !== 'number' || !Number.isInteger(agentPort) || agentPort < 1 || agentPort > 65535) fail('invalid agent runtime port')
    if (typeof agentSshPort !== 'number' || !Number.isInteger(agentSshPort) || agentSshPort < 1 || agentSshPort > 65535) fail('invalid agent runtime SSH port')
    const agentArch = choose(agentInput.arch, 'arm64')
    if (agentArch !== 'amd64' && agentArch !== 'arm64') fail('invalid agent runtime architecture')
    const agentHost = text(agentInput.host, /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/, 'agent runtime host or SSH alias')
    const agentRoot = path(choose(agentInput.runtimeDirectory, `${root}/agent-runtime`))
    const tlsDirectory = path(choose(agentInput.tlsDirectory, `${agentRoot}/tls`))
    const agentPaths = [agentRoot, tlsDirectory]
    if (agentPaths.some(agentPath => agentPath === root || root.startsWith(agentPath + '/') || paths.some(runtimePath => overlaps(agentPath, runtimePath)) || overlaps(agentPath, `${root}/migration`))) fail('agent runtime paths overlap the platform runtime')
    agentRuntime = {
      host: agentHost,
      ...(agentInput.privateAddress === undefined ? {} : { privateAddress: text(agentInput.privateAddress, /^(?:[A-Za-z0-9][A-Za-z0-9.-]{0,252})$/, 'agent runtime private address') }),
      arch: agentArch,
      port: agentPort,
      ssh: { user: text(choose(agentSsh.user, user), /^[a-z_][a-z0-9_-]{0,31}$/, 'agent runtime SSH user'), port: agentSshPort },
      service: name(agentInput.service, `${config.appName}-agent-runtime`),
      runtimeDirectory: agentRoot,
      tlsDirectory,
    }
  }
  return {
    host: edgeHost, arch,
    ssh: { user, port }, services,
    registry: { usernameSecret: secret(registry.usernameSecret, 'KAMAL_REGISTRY_USERNAME'), passwordSecret: secret(registry.passwordSecret, 'KAMAL_REGISTRY_PASSWORD') },
    runtimeDirectory: root,
    runtimeFiles,
    worker,
    agentRuntime,
  }
}
/** Main apps use a tag through --version. Kamal would append :version to a digest. */
function appImage(value: string) {
  if (value.includes('@')) fail('Kamal main app images require explicit tags; digest references are supported only by Compose/accessories')
  const colon = value.lastIndexOf(':'), tag = value.slice(colon + 1), name = value.slice(0, colon)
  const parts = name.split('/'), qualified = parts.length > 1 && /[.:]/.test(parts[0])
  const server = qualified ? parts.shift()! : 'docker.io'
  if (server.startsWith('localhost')) fail('Kamal local registry automation is outside this exporter')
  if (!tag || colon < name.lastIndexOf('/') || parts.some(part => !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(part))) fail('invalid Kamal application image')
  return { server, image: server === 'docker.io' && parts.length === 1 ? `library/${parts[0]}` : parts.join('/'), tag }
}
const serialize = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
const prefix = '.eaos/generated/platform'

/**
 * Render role-specific Kamal configuration and operation metadata from validated deployment settings.
 * @param config - Resolved platform ports, domain and runtime configuration.
 * @param settings - Validated Kamal host/service/registry settings.
 * @param definitions - Explicit service definitions used for backend accessories.
 * @param database - Selected database image, storage and connection configuration.
 * @param workerImageValue - Optional immutable worker image selection.
 * @param agentImageValue - Optional agent-runtime image selection.
 * @returns A map of generated relative filenames to configuration text.
 * @throws Invalid settings or unresolved role/image assumptions can throw.
 * @remarks Pure rendering: does not invoke Kamal, SSH, registry pushes or migrations. The host reviews generated settings and supplies actual runtime secrets.
 * @example
 * import { renderKamal } from '@alneas/eaos-cli/platform/kamal'
 * export function renderHost(...args: Parameters<typeof renderKamal>) { return renderKamal(...args) }
 */
export function renderKamal(config: ResolvedPlatformConfig, settings: ResolvedKamalDeployment, definitions: ServiceDefinition[], database: { 
/**
 * Reviewed named Docker volume used for identity database persistence and generated host inspection/create instructions.
 */
volumeName: string; 
/**
 * True requires the existing named volume to be inspected and retained; false permits reviewed new-installation volume creation instructions.
 */
external: boolean }, workerImageValue?: string, agentImageValue?: string): Record<string, string> {
  const backend = definitions.find(service => service.name === config.services.backend.name)!
  const frontend = definitions.find(service => service.name === config.services.frontend.name)!
  const backendImage = appImage(backend.image), frontendImage = appImage(frontend.image)
  const workerImage = workerImageValue === undefined ? undefined : appImage(workerImageValue)
  const agentImage = agentImageValue === undefined ? undefined : appImage(agentImageValue)
  if (backendImage.server !== frontendImage.server || (workerImage && workerImage.server !== backendImage.server) || (agentImage && agentImage.server !== backendImage.server)) fail('Kamal application images must use the same registry in this exporter')
  const runtime: Record<string, string> = { EAOS_KRATOS_RUNTIME_CONFIG: settings.runtimeFiles.kratosConfig, EAOS_KRATOS_DB_PASSWORD_FILE: settings.runtimeFiles.databasePassword, EAOS_TLS_DIRECTORY: settings.runtimeFiles.tlsDirectory }
  const registry = { server: backendImage.server, username: [settings.registry.usernameSecret], password: [settings.registry.passwordSecret] }
  const accessories = Object.fromEntries(definitions.filter(service => service.role === 'accessory').map(service => {
    const defaultEnv = {}
    const clearEnv = service.environment ? { ...defaultEnv, ...service.environment } : (Object.keys(defaultEnv).length ? defaultEnv : undefined)
    return [service.name, {
      image: service.image, host: settings.host, network: config.networkName,
      cmd: service.command?.join(' '),
      env: clearEnv ? { clear: clearEnv } : undefined,
      files: service.files?.map(file => ({ local: `${prefix}/${file.source}`, remote: file.target, options: 'ro', mode: '0644' })),
    volumes: service.volume ? [`${database.volumeName}:${service.volume.target}`] : undefined,
    options: {
      'network-alias': service.name,
      publish: service.name === config.services.kratos.name && settings.worker ? [new URL(settings.worker.kratosAdminUrl).hostname + ':' + config.services.kratos.port + ':' + config.services.kratos.port, new URL(settings.worker.kratosAdminUrl).hostname + ':4434:4434'] : service.ports,
      ...(service.name === 'nginx' && settings.worker ? { 'add-host': [`${config.services.backend.name}:${settings.worker.privateAddress}`] } : {}),
      // --mount rejects missing source paths instead of creating empty secret directories.
      mount: service.runtimeFiles?.map(file => `type=bind,source=${runtime[file.binding]},target=${file.target},readonly`),
      ...(service.healthcheck ? { 'health-cmd': service.healthcheck.test.slice(1).join(' '), 'health-interval': service.healthcheck.interval, 'health-timeout': service.healthcheck.timeout, 'health-retries': service.healthcheck.retries } : {}),
    },
  }]
}))
  // Public accessory images are independent of the app registry. Only the main app
  // registry's credentials can be reused; do not silently authenticate to another registry.
  for (const accessory of Object.values(accessories)) {
    const first = accessory.image.split('/')[0]
    if (accessory.image.includes('/') && /[.:]/.test(first) && first !== 'docker.io') fail('Kamal accessories currently require public Docker Hub images')
  }
  const names = [settings.services.backend, settings.services.frontend, ...(settings.worker ? [settings.worker.service] : []), ...(settings.agentRuntime ? [settings.agentRuntime.service] : []), ...Object.keys(accessories).map(name => `${settings.services.backend}-${name}`)]
  if (new Set(names).size !== names.length) fail('Kamal service/container names collide')
  const application = (service: ServiceDefinition, name: string, image: ReturnType<typeof appImage>, placement: { host: string; arch: 'amd64' | 'arm64'; ssh: { user: string; port: number } } = settings, environment: Record<string, string> | undefined = service.environment) => ({
    minimum_version: '2.12.0', service: name, image: image.image, registry,
    servers: { web: { hosts: [placement.host], proxy: false, options: { 'network-alias': service.name, ...(settings.worker && placement.host === settings.worker.host ? { publish: [settings.worker.privateAddress + ':' + config.services.backend.port + ':' + config.services.backend.port] } : {}) } } },
    ssh: placement.ssh, builder: { arch: placement.arch, args: { KAMAL_SERVICE: name } },
    env: environment ? { clear: environment } : undefined,
    'x-eaos-image': { reference: service.image, version: image.tag, deployMode: 'prebuilt; use --skip-push and this --version' },
  })
  const backendPath = `${prefix}/kamal-backend.yml`, frontendPath = `${prefix}/kamal-frontend.yml`, workerPath = `${prefix}/kamal-worker.yml`
  const kamal = (file: string, ...args: string[]) => ['kamal', ...args, '--config-file', file, '--skip-hooks']
  const migration = definitions.find(service => service.role === 'migration')!
  // Migration gets its own copied non-secret files, so it does not require Kratos
  // to have booted (or Kamal's accessory env-file to have been created) beforehand.
  const migrationFiles = (migration.files || []).map(file => ({ local: `${prefix}/${file.source}`, remote: `${settings.runtimeDirectory}/migration/${file.source}`, target: file.target }))
  const dockerMigration = ['docker', 'run', '--rm', '--pull', 'always', '--network', config.networkName,
    ...migrationFiles.flatMap(file => ['--mount', `type=bind,source=${file.remote},target=${file.target},readonly`]),
    ...(migration.runtimeFiles || []).flatMap(file => ['--mount', `type=bind,source=${runtime[file.binding]},target=${file.target},readonly`]),
    migration.image, ...(migration.command || [])]
  const files: Record<string, string> = {
    'kamal-backend.yml': serialize({ ...application(backend, settings.services.backend, backendImage), accessories }),
    'kamal-frontend.yml': serialize(application(frontend, settings.services.frontend, frontendImage)),
  }
  if (settings.worker && workerImage) {
    files['kamal-worker.yml'] = serialize(application(backend, settings.worker.service, workerImage, settings.worker, { ...(backend.environment || {}), KRATOS_ADMIN_URL: settings.worker.kratosAdminUrl, KRATOS_PUBLIC_URL: new URL(settings.worker.kratosAdminUrl).origin.replace(/:\d+$/, ':' + config.services.kratos.port) }))
  }
  if (settings.agentRuntime && agentImage) {
    const agent = settings.agentRuntime
    files['kamal-agent-runtime.yml'] = serialize({
      minimum_version: '2.12.0',
      service: agent.service,
      image: agentImage.image,
      registry,
      servers: { web: { hosts: [agent.host], proxy: false, options: {
        'network-alias': 'eaos-agent-runtime',
        publish: [`${agent.port}:${agent.port}`],
        'health-cmd': `curl --fail --silent --show-error --insecure https://127.0.0.1:${agent.port}/health`,
        'health-interval': '10s', 'health-timeout': '5s', 'health-retries': 6,
      } } },
      ssh: agent.ssh,
      builder: { arch: agent.arch },
      env: {
        clear: {
          NODE_ENV: 'production', HOST: '0.0.0.0', PORT: String(agent.port), EAOS_RUNTIME_ROLE: 'ai',
          GOOSE_BIN_PATH: '/usr/local/bin/goose', HERMES_AGENT_BIN_PATH: '/usr/local/bin/hermes',
          EAOS_AGENT_TLS_CERT: '/etc/eaos-agent-runtime/tls.crt', EAOS_AGENT_TLS_KEY: '/etc/eaos-agent-runtime/tls.key',
        },
        secret: ['EAOS_AGENT_RUNTIME_TOKEN'],
      },
      volumes: [
        `${agent.runtimeDirectory}/hermes:/var/lib/eaos-agent/.hermes`,
        `${agent.runtimeDirectory}/workspace:/opt/eaos/agent-runtime/workspace`,
        `${agent.tlsDirectory}/tls.crt:/etc/eaos-agent-runtime/tls.crt:ro`,
        `${agent.tlsDirectory}/tls.key:/etc/eaos-agent-runtime/tls.key:ro`,
      ],
      'x-eaos-image': { reference: agentImageValue!, version: agentImage.tag, deployMode: 'prebuilt; use --skip-push and this --version' },
    })
  }
  files['kamal-operations.json'] = serialize({
      formatVersion: 1, targetHost: settings.host, ssh: settings.ssh, automaticExecution: false,
      credentials: { source: '.kamal/secrets', keys: Object.values(settings.registry) },
      runtimeFiles: Object.fromEntries([...new Set(definitions.flatMap(service => (service.runtimeFiles || []).map(file => file.binding)))].map(binding => [binding, runtime[binding]])), copyBeforeMigration: migrationFiles,
      prerequisites: [
        'Review the current deployment, backup and schema/key compatibility before applying this plan.',
        'Provision Docker, the kamal network and all runtime secret files on the target host.',
        'Copy the listed non-secret migration files to targetHost before running migration.',
        database.external ? 'External volume must already exist: stop if inspect fails. Kamal itself has no external-volume guard.' : 'Create the named volume only for a reviewed new installation.',
        'Wait until the database healthcheck succeeds before migration. Kamal does not enforce Compose depends_on.',
        'Use image tags reviewed for the target architecture; do not run default image builds.',
      ],
      volume: { ...database, inspectOnHost: ['docker', 'volume', 'inspect', database.volumeName], createOnHost: database.external ? undefined : ['docker', 'volume', 'create', database.volumeName] },
      firstInstall: [
        { action: 'boot-database', localArgv: kamal(backendPath, 'accessory', 'boot', 'kratos-db'), waitForHealthy: true },
        { action: 'migrate-after-review', onHostArgv: dockerMigration, requiresBackup: true },
        { action: 'boot-kratos', localArgv: kamal(backendPath, 'accessory', 'boot', config.services.kratos.name) },
        ...(settings.worker && workerImage ? [{ action: 'deploy-worker', localArgv: kamal(workerPath, 'deploy', '--skip-push', '--version', workerImage.tag), targetHost: settings.worker.host, ssh: settings.worker.ssh }] : []),
        { action: 'deploy-backend', localArgv: kamal(backendPath, 'deploy', '--skip-push', '--version', backendImage.tag) },
        { action: 'deploy-frontend', localArgv: kamal(frontendPath, 'deploy', '--skip-push', '--version', frontendImage.tag) },
        ...(settings.agentRuntime && agentImage ? [{ action: 'deploy-agent-runtime', localArgv: kamal(`${prefix}/kamal-agent-runtime.yml`, 'deploy', '--skip-push', '--version', agentImage.tag), targetHost: settings.agentRuntime.host, ssh: settings.agentRuntime.ssh }] : []),
        { action: 'boot-nginx', localArgv: kamal(backendPath, 'accessory', 'boot', 'nginx') },
      ],
      updates: { note: 'Choose only the changed service. Accessory reboot stops and replaces its container; never treat this list as a batch command. Database image/schema updates require a separate migration plan. A non-proxy role bound to a fixed host port must stop its previous container before replacement and restore that reviewed version on failure.',
        backend: kamal(backendPath, 'deploy', '--skip-push', '--version', backendImage.tag),
        ...(settings.worker && workerImage ? { worker: kamal(workerPath, 'deploy', '--skip-push', '--version', workerImage.tag),
          workerReplacement: { stopBeforeDeploy: kamal(workerPath, 'app', 'stop'), temporaryUnavailability: true, rollbackOnFailure: ['kamal', 'rollback', '<previous-reviewed-version>', '--config-file', workerPath, '--skip-hooks'] } } : {}),
        frontend: kamal(frontendPath, 'deploy', '--skip-push', '--version', frontendImage.tag),
        ...(settings.agentRuntime && agentImage ? { agentRuntime: kamal(`${prefix}/kamal-agent-runtime.yml`, 'deploy', '--skip-push', '--version', agentImage.tag) } : {}),
        kratos: kamal(backendPath, 'accessory', 'reboot', config.services.kratos.name),
        nginx: kamal(backendPath, 'accessory', 'reboot', 'nginx'),
      },
    })
  return files
}
