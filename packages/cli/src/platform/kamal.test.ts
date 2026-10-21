import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatePlatform, type PlatformManifest } from './index'
import { emailIdentitySchema, renderPlatform, resolveManifest } from './render'

const input = (): PlatformManifest => ({
  platform: { appName: 'sample', baseDomain: 'example.com', networkName: 'kamal' },
  deployment: { target: 'kamal', images: { backend: 'registry.example.com/team/api:v1', frontend: 'registry.example.com/team/web:v2' }, kamal: { host: 'example-app' } },
})
function render(manifest: unknown = input()) {
  const { config, deployment } = resolveManifest(manifest)
  return renderPlatform(config, deployment, { default: emailIdentitySchema })
}
test('Kamal uses the shared aliases/env/configs and separates frontend, accessories and migration', () => {
  const files = render(), backend = JSON.parse(files['kamal-backend.yml']), frontend = JSON.parse(files['kamal-frontend.yml'])
  const ops = JSON.parse(files['kamal-operations.json'])
  expect(files['compose.yml']).toBeUndefined()
  expect(backend.image).toBe('team/api')
  expect(backend.registry).toEqual({ server: 'registry.example.com', username: ['KAMAL_REGISTRY_USERNAME'], password: ['KAMAL_REGISTRY_PASSWORD'] })
  expect(backend.servers.web).toEqual({ hosts: ['example-app'], proxy: false, options: { 'network-alias': 'hono-server' } })
  expect(frontend.servers.web.options['network-alias']).toBe('frontend')
  expect(frontend.accessories).toBeUndefined()
  expect(backend.env.clear.PORT).toBe('3000')
  expect(Object.keys(backend.accessories)).toEqual(['kratos-db', 'kratos', 'nginx'])
  expect(backend.accessories.nginx.options.publish).toEqual(['443:443', '80:80'])
  expect(backend.accessories.kratos.options.publish).toBeUndefined()
  expect(backend.accessories['kratos-db'].options['health-cmd']).toBe('pg_isready -U kratos -d kratos')
  expect(backend.accessories.kratos.files[0]).toEqual({ local: '.eaos/generated/platform/kratos/kratos.yml', remote: '/etc/config/kratos/kratos.yml', options: 'ro', mode: '0644' })
  expect(backend.accessories.kratos.options.mount[0]).toBe('type=bind,source=/etc/eaos/sample/kratos-runtime.yml,target=/run/eaos/kratos-runtime.yml,readonly')
  expect(backend.accessories.kratos.env?.clear?.DSN).toBeUndefined()
  expect(ops.firstInstall[1].onHostArgv).toContain('migrate')
  expect(ops.firstInstall[1].onHostArgv).toContain('--rm')
  expect(ops.firstInstall[3].localArgv).toContain('--skip-push')
  expect(ops.firstInstall[3].localArgv).toContain('v1')
  expect(ops.firstInstall[4].localArgv).toContain('v2')
  expect(ops.automaticExecution).toBe(false)
  expect(ops.updates).not.toHaveProperty('database')
})

test('corporate-like service labels, SSH, schema endpoint and external volume remain explicit', () => {
  const manifest = input()
  manifest.deployment.target = 'both'
  manifest.deployment.database = { volumeName: 'kratos_kratos-db-data', external: true }
  manifest.deployment.kamal = { host: 'corporate-app', arch: 'arm64', ssh: { user: 'ubuntu', port: 12222 }, services: { backend: 'corporate-erp', frontend: 'corporate-frontend' }, registry: { usernameSecret: 'OCIR_USER', passwordSecret: 'OCIR_PASSWORD' }, runtimeFiles: { kratosConfig: '/srv/auth/runtime.yml' } }
  manifest.overrides = { services: { backend: { port: 4500 }, frontend: { name: 'corporate-frontend' }, kratos: { port: 14433 } } }
  const files = render(manifest), backend = JSON.parse(files['kamal-backend.yml']), compose = JSON.parse(files['compose.yml']), ops = JSON.parse(files['kamal-operations.json'])
  expect(backend.service).toBe('corporate-erp')
  expect(backend.ssh).toEqual({ user: 'ubuntu', port: 12222 })
  expect(backend.builder.arch).toBe('arm64')
  expect(backend.env.clear.PORT).toBe(compose.services['hono-server'].environment.PORT)
  expect(backend.env.clear.KRATOS_PUBLIC_URL).toBe('http://kratos:14433')
  expect(backend.env.clear.KRATOS_ADMIN_URL).toBe('http://kratos:4434/')
  expect(files['nginx/nginx.conf']).toContain('http://hono-server:4500')
  expect(backend.accessories['kratos-db'].volumes).toEqual(['kratos_kratos-db-data:/var/lib/postgresql/data'])
  expect(ops.volume.createOnHost).toBeUndefined()
  expect(ops.volume.inspectOnHost).toEqual(['docker', 'volume', 'inspect', 'kratos_kratos-db-data'])
  expect(ops.firstInstall[1].onHostArgv).toContain('type=bind,source=/srv/auth/runtime.yml,target=/run/eaos/kratos-runtime.yml,readonly')
})

test('split worker placement generates a worker config and pins the edge-to-worker route', () => {
  const manifest = input()
  manifest.deployment.images.worker = 'registry.example.com/team/api-worker:v3'
  manifest.deployment.kamal = {
    host: 'edge-host',
    ssh: { user: 'ubuntu', port: 12222 },
    worker: {
      host: 'worker-host',
      privateAddress: '10.0.1.149',
      kratosAdminUrl: 'http://10.0.1.31:4434',
      ssh: { user: 'ubuntu', port: 12224 },
    },
  }
  const files = render(manifest)
  const backend = JSON.parse(files['kamal-backend.yml'])
  const worker = JSON.parse(files['kamal-worker.yml'])
  const ops = JSON.parse(files['kamal-operations.json'])
  expect(backend.accessories.nginx.options['add-host']).toEqual(['hono-server:10.0.1.149'])
  expect(worker.service).toBe('sample-worker')
  expect(worker.servers.web).toEqual({ hosts: ['worker-host'], proxy: false, options: { 'network-alias': 'hono-server', publish: ['10.0.1.149:3000:3000'] } })
  expect(worker.ssh).toEqual({ user: 'ubuntu', port: 12224 })
  expect(worker.env.clear.KRATOS_ADMIN_URL).toBe('http://10.0.1.31:4434')
  expect(worker.env.clear.KRATOS_PUBLIC_URL).toBe('http://10.0.1.31:4433')
  expect(backend.accessories.kratos.options.publish).toEqual(['10.0.1.31:4433:4433', '10.0.1.31:4434:4434'])
  expect(worker.builder.args.KAMAL_SERVICE).toBe(worker.service)
  expect(ops.firstInstall.some((step: any) => step.action === 'deploy-worker' && step.targetHost === 'worker-host')).toBe(true)
  expect(ops.updates.worker).toContain('.eaos/generated/platform/kamal-worker.yml')
  expect(ops.updates.workerReplacement.stopBeforeDeploy).toContain('stop')
  expect(ops.updates.workerReplacement.temporaryUnavailability).toBe(true)
})

test('worker and agent inherit the resolved main SSH default and explicit overrides remain authoritative', () => {
  const manifest = input()
  manifest.deployment.images.worker = 'registry.example.com/team/api-worker:v3'
  manifest.deployment.images.agentRuntime = 'registry.example.com/team/agent:v4'
  manifest.deployment.kamal = { host: 'edge-host', worker: { host: 'worker-host', privateAddress: '10.0.1.20', kratosAdminUrl: 'http://10.0.0.20:4434' }, agentRuntime: { host: 'agent-host' } }
  const defaults = render(manifest)
  expect(JSON.parse(defaults['kamal-worker.yml']).ssh).toEqual({ user: 'root', port: 22 })
  expect(JSON.parse(defaults['kamal-agent-runtime.yml']).ssh).toEqual({ user: 'root', port: 22 })
  manifest.deployment.kamal.ssh = { user: 'ubuntu', port: 2222 }
  manifest.deployment.kamal.agentRuntime!.ssh = { user: 'agent', port: 2223 }
  const overrides = render(manifest)
  expect(JSON.parse(overrides['kamal-worker.yml']).ssh).toEqual({ user: 'ubuntu', port: 2222 })
  expect(JSON.parse(overrides['kamal-agent-runtime.yml']).ssh).toEqual({ user: 'agent', port: 2223 })
})

test('ARM agent runtime generates a dedicated Kamal service with pinned host mounts and healthcheck', () => {
  const manifest = input()
  manifest.deployment.images.agentRuntime = 'registry.example.com/team/agent-runtime:v4'
  manifest.deployment.kamal = {
    host: 'edge-host',
    ssh: { user: 'ubuntu', port: 12222 },
    agentRuntime: {
      host: 'arm-host',
      privateAddress: '10.0.1.204',
      ssh: { user: 'ubuntu', port: 12223 },
    },
  }
  const files = render(manifest)
  const agent = JSON.parse(files['kamal-agent-runtime.yml'])
  const ops = JSON.parse(files['kamal-operations.json'])
  expect(agent.service).toBe('sample-agent-runtime')
  expect(agent.servers.web).toEqual({ hosts: ['arm-host'], proxy: false, options: {
    'network-alias': 'eaos-agent-runtime', publish: ['8443:8443'],
    'health-cmd': 'curl --fail --silent --show-error --insecure https://127.0.0.1:8443/health',
    'health-interval': '10s', 'health-timeout': '5s', 'health-retries': 6,
  } })
  expect(agent.ssh).toEqual({ user: 'ubuntu', port: 12223 })
  expect(agent.builder.arch).toBe('arm64')
  expect(agent.env.clear.EAOS_RUNTIME_ROLE).toBe('ai')
  expect(agent.env.secret).toEqual(['EAOS_AGENT_RUNTIME_TOKEN'])
  expect(agent.volumes).toContain('/etc/eaos/sample/agent-runtime/hermes:/var/lib/eaos-agent/.hermes')
  expect(agent.volumes).toContain('/etc/eaos/sample/agent-runtime/tls/tls.key:/etc/eaos-agent-runtime/tls.key:ro')
  expect(agent.servers.web.options['health-cmd']).toContain('https://127.0.0.1:8443/health')
  const contract = JSON.parse(files['runtime-contract.json'])
  expect(contract.kamal.agentRuntime).toEqual({
    service: 'sample-agent-runtime',
    endpoint: 'https://10.0.1.204:8443/agent/run',
    health: 'https://10.0.1.204:8443/health',
    runtimeRole: 'ai',
  })
  expect(ops.firstInstall.some((step: any) => step.action === 'deploy-agent-runtime' && step.targetHost === 'arm-host')).toBe(true)
  expect(ops.updates.agentRuntime).toContain('.eaos/generated/platform/kamal-agent-runtime.yml')
})

test('UI origin is external to the Kamal nginx listeners and does not expand backend CORS', () => {
  const manifest = input()
  manifest.platform.auth = { uiOrigin: 'https://local.example.com:3000', defaultBrowserReturnUrl: 'https://portal.example.com/home' }
  const files = render(manifest), backend = JSON.parse(files['kamal-backend.yml']), kratos = JSON.parse(files['kratos/kratos.yml'])
  expect(backend.accessories.nginx.options.publish).toEqual(['443:443', '80:80'])
  expect(backend.env.clear.CORS_ALLOW_ORIGIN).toBe('https://app.example.com')
  expect(kratos.selfservice.flows.login.ui_url).toBe('https://local.example.com:3000/login')
  expect(kratos.selfservice.default_browser_return_url).toBe('https://portal.example.com/home')
  expect(files['nginx/nginx.conf']).not.toContain('local.example.com')
})

test('Kamal uploads registration mapper for serve and migration, preserving the hook array', () => {
  const manifest = input()
  manifest.platform.auth = { registrationHook: { path: '/hook', authHeader: 'X-Kratos-Webhook-Key', session: 'before', body: 'identity-email-v1' } }
  const files = render(manifest), backend = JSON.parse(files['kamal-backend.yml']), ops = JSON.parse(files['kamal-operations.json'])
  expect(backend.accessories.kratos.files).toContainEqual({ local: '.eaos/generated/platform/kratos/registration-body.jsonnet', remote: '/etc/config/kratos/registration-body.jsonnet', options: 'ro', mode: '0644' })
  expect(ops.copyBeforeMigration).toContainEqual({ local: '.eaos/generated/platform/kratos/registration-body.jsonnet', remote: '/etc/eaos/sample/migration/kratos/registration-body.jsonnet', target: '/etc/config/kratos/registration-body.jsonnet' })
  expect(ops.firstInstall[1].onHostArgv).toContain('type=bind,source=/etc/eaos/sample/migration/kratos/registration-body.jsonnet,target=/etc/config/kratos/registration-body.jsonnet,readonly')
  expect(JSON.parse(files['runtime-contract.json']).files.EAOS_KRATOS_RUNTIME_CONFIG.registrationHook.hooks).toEqual(JSON.parse(files['kratos/kratos.yml']).selfservice.flows.registration.after.password.hooks)
})

test('Kamal and Compose consume separate Hono and Kratos CORS without combining them', () => {
  const manifest = input()
  manifest.deployment.target = 'both'
  manifest.platform.cors = { additionalOrigins: ['https://example.com'], honoAdditionalOrigins: ['https://www.example.com'], kratosAdditionalOrigins: ['https://chat.example.com'] }
  const files = render(manifest), backend = JSON.parse(files['kamal-backend.yml']), compose = JSON.parse(files['compose.yml']), kratos = JSON.parse(files['kratos/kratos.yml'])
  expect(backend.env.clear.CORS_ALLOW_ORIGIN).toBe('https://app.example.com,https://example.com,https://www.example.com')
  expect(compose.services['hono-server'].environment.CORS_ALLOW_ORIGIN).toBe(backend.env.clear.CORS_ALLOW_ORIGIN)
  expect(kratos.serve.public.cors.allowed_origins).toEqual(['https://app.example.com', 'https://example.com', 'https://chat.example.com'])
})

test.each([
  (v: any) => { v.platform.networkName = 'unrelated' },
  (v: any) => { delete v.deployment.kamal },
  (v: any) => { v.deployment.target = 'other' },
  (v: any) => { v.deployment.target = 'compose' },
  (v: any) => { v.deployment.kamal.runtimeDirectory = '/srv/../secret' },
  (v: any) => { v.deployment.kamal.runtimeFiles = { kratosConfig: '/srv/file,readonly=false' } },
  (v: any) => { v.deployment.kamal.runtimeFiles = { kratosConfig: '/etc/eaos/sample/migration/kratos/kratos.yml' } },
  (v: any) => { v.deployment.kamal.runtimeFiles = { databasePassword: '/etc/eaos/sample/kratos-runtime.yml' } },
  (v: any) => { v.deployment.kamal.host = 'host; DUMMY_SECRET' },
  (v: any) => { v.deployment.kamal.registry = { password: 'DUMMY_SECRET' } },
  (v: any) => { v.deployment.images.backend = 'registry.example.com/team/api@sha256:' + 'a'.repeat(64) },
  (v: any) => { v.deployment.images.frontend = 'other.example.com/team/web:v1' },
  (v: any) => { v.deployment.images.nginx = 'private.example.com/team/nginx:v1' },
  (v: any) => { v.deployment.kamal.services = { backend: 'same', frontend: 'same' } },
  (v: any) => { v.deployment.kamal.services = { backend: 'sample', frontend: 'sample-kratos' } },
  (v: any) => { v.deployment.kamal.ssh = { port: 0 } },
])('invalid Kamal-specific inputs fail before any output', mutate => {
  const manifest = input(); mutate(manifest)
  expect(() => render(manifest)).toThrow()
  try { render(manifest) } catch (error) { expect(String(error)).not.toContain('DUMMY_SECRET') }
})

const roots: string[] = []
test('a custom registry repository is not rewritten with the Docker Hub library prefix', () => {
  const manifest = input()
  manifest.deployment.images.backend = 'registry.example.com/api:v1'
  manifest.deployment.images.frontend = 'registry.example.com/web:v2'
  expect(JSON.parse(render(manifest)['kamal-backend.yml']).image).toBe('api')
})
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
test('target changes prune only tracked outputs, and protect edits to Kamal files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eaos-kamal-')); roots.push(root)
  const configPath = join(root, 'eaos.platform.json'), output = join(root, '.eaos/generated/platform')
  const manifest = input(); await writeFile(configPath, JSON.stringify(manifest)); await generatePlatform(root)
  const before = await readFile(join(output, 'receipt.json'), 'utf8')
  await generatePlatform(root, { check: true })
  expect(await readFile(join(output, 'receipt.json'), 'utf8')).toBe(before)
  const original = await readFile(join(output, 'kamal-backend.yml'), 'utf8')
  await writeFile(join(output, 'kamal-backend.yml'), 'manual')
  manifest.deployment.target = 'compose'; delete manifest.deployment.kamal
  await writeFile(configPath, JSON.stringify(manifest))
  await expect(generatePlatform(root)).rejects.toThrow('edited or removed')
  expect(await readFile(join(output, 'kamal-backend.yml'), 'utf8')).toBe('manual')
  await writeFile(join(output, 'kamal-backend.yml'), original)
  await generatePlatform(root)
  expect(await readdir(output)).toContain('compose.yml')
  expect(await readdir(output)).not.toContain('kamal-backend.yml')
})
