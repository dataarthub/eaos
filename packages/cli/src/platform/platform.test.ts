import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatePlatform } from './index'
import { resolveManifest } from './render'

const roots: string[] = []
const manifest = () => ({ platform: { appName: 'sample', baseDomain: 'example.com' }, deployment: { images: { backend: 'example/backend:1.0', frontend: 'example/frontend:1.0' } } })
async function project(input: unknown = manifest()) {
  const root = await mkdtemp(join(tmpdir(), 'eaos-platform-')); roots.push(root)
  await writeFile(join(root, 'eaos.platform.json'), JSON.stringify(input))
  return root
}
const output = (root: string, path: string) => join(root, '.eaos/generated/platform', path)
const read = (root: string, path: string) => readFile(output(root, path), 'utf8')
const data = async (root: string, path: string) => JSON.parse(await read(root, path))
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

test('default rendering aligns aliases, ports, cookies and durable DB; migration remains explicit', async () => {
  const root = await project()
  await generatePlatform(root)
  const compose = await data(root, 'compose.yml'), kratos = await data(root, 'kratos/kratos.yml')
  const nginx = await read(root, 'nginx/nginx.conf')
  expect(compose.services['hono-server'].environment.PORT).toBe('3000')
  expect(nginx).toContain('set $target http://hono-server:3000;')
  expect(nginx).toContain('proxy_pass $target;')
  expect(nginx).not.toContain('proxy_pass $target/;')
  expect(nginx).not.toContain('4434')
  expect(compose.services.kratos.command).not.toContain('--dev')
  expect(compose.services.kratos.image).toBe('oryd/kratos:v26.2.0')
  expect(compose.services.nginx.image).toBe('nginx:1.30-alpine')
  expect(compose.services['kratos-migrate'].command).toEqual(['migrate', 'sql', 'up', '-e', '--yes', '-c', '/etc/config/kratos/kratos.yml', '-c', '/run/eaos/kratos-runtime.yml'])
  expect(kratos.session.cookie.domain).toBe('example.com')
  expect(kratos.session.cookie).not.toHaveProperty('secure') // Keep the generated config within the supported Kratos schema.
  expect(kratos.serve.public.base_url).toBe('https://auth.example.com/')
  expect(kratos.selfservice.flows.login.ui_url).toBe('https://app.example.com/login')
  expect(compose.volumes['kratos-data']).toEqual({ name: 'sample-kratos-data', external: false })
  expect(compose.services['kratos-migrate'].profiles).toEqual(['operations'])
  expect(compose.services.kratos.depends_on).not.toHaveProperty('kratos-migrate')
  expect(compose.services['kratos-db']).not.toHaveProperty('ports')
  expect(compose.services.kratos).not.toHaveProperty('ports')
  expect(compose.services.nginx.ports).toEqual(['443:443', '80:80'])
  expect(kratos).not.toHaveProperty('dsn')
  expect(kratos).not.toHaveProperty('secrets')
  expect((await data(root, 'runtime-contract.json')).files.EAOS_KRATOS_RUNTIME_CONFIG.requiredFields).toEqual(['dsn', 'secrets.cookie', 'secrets.cipher', 'secrets.pagination'])
  expect((await data(root, 'runtime-policy.json')).ai.agentRuntime).toMatchObject({ maxConcurrent: 1, memoryLimitMb: 2_048, pidsLimit: 100, rootFilesystem: 'read-only' })
  expect((await data(root, 'runtime-contract.json')).resourcePolicy.applicationWorker.agentRuntime).toBe('dispatch-only')
  expect(await generatePlatform(root, { check: true })).toMatchObject({ status: 'current' })
})

test('compatibility overrides propagate through render and preserve supplied schema and volume', async () => {
  const root = await project({ ...manifest(), overrides: { services: { backend: { name: 'api', port: 4500 }, kratos: { port: 14433, adminPort: 14434 } }, auth: { cookie: { name: 'existing_session' }, identitySchemas: [{ id: 'default', path: 'schema.json' }], registrationHook: { path: '/registered' } } }, deployment: { ...manifest().deployment, database: { volumeName: 'kratos_kratos-db-data', external: true } } })
  const schema = { type: 'object', properties: { traits: { type: 'object', properties: { tenant_id: { type: 'string' }, email: { type: 'string' } } } } }
  await writeFile(join(root, 'schema.json'), JSON.stringify(schema))
  await generatePlatform(root)
  const compose = await data(root, 'compose.yml'), kratos = await data(root, 'kratos/kratos.yml')
  expect(compose.services.api.environment.PORT).toBe('4500')
  expect(compose.services.api.environment.KRATOS_PUBLIC_URL).toBe('http://kratos:14433')
  expect(await read(root, 'nginx/nginx.conf')).toContain('http://api:4500')
  expect(kratos.serve.admin.port).toBe(14434)
  expect(kratos.session.cookie.name).toBe('existing_session')
  expect(kratos.selfservice.flows.registration.after.password.hooks[0].config.url).toBe('http://api:4500/registered')
  expect(kratos.selfservice.flows.registration.after.password.hooks[0].config.auth.config).not.toHaveProperty('value')
  expect(await data(root, 'kratos/identity-default.json')).toEqual(schema)
  expect(compose.volumes['kratos-data'].external).toBe(true)
  await writeFile(join(root, 'schema.json'), JSON.stringify({ ...schema, title: 'Updated' }))
  await expect(generatePlatform(root, { check: true })).rejects.toThrow('stale')
  await generatePlatform(root)
  expect((await data(root, 'kratos/identity-default.json')).title).toBe('Updated')
})

test('HTTP is explicit development only and emits dev mode without TLS mounts', async () => {
  const root = await project({ ...manifest(), overrides: { environment: 'development', origins: { app: 'http://app.example.com:8080', auth: 'http://auth.example.com:8080' }, auth: { cookie: { secure: false } } } })
  await generatePlatform(root)
  const compose = await data(root, 'compose.yml')
  expect(compose.services.kratos.command).toContain('--dev')
  expect(compose.services.nginx.ports).toEqual(['8080:8080'])
  expect(await read(root, 'nginx/nginx.conf')).not.toContain('ssl_certificate')
})

test('registration hook preserves session order, auth header and explicit email body across runtime contract and mounts', async () => {
  const root = await project({ ...manifest(), overrides: { auth: { registrationHook: {
    path: '/kratos/webhook/registration', authHeader: 'X-Kratos-Webhook-Key', session: 'before', body: 'identity-email-v1',
  } } } })
  await generatePlatform(root)
  const kratos = await data(root, 'kratos/kratos.yml'), compose = await data(root, 'compose.yml')
  const hooks = kratos.selfservice.flows.registration.after.password.hooks
  expect(hooks).toEqual([{ hook: 'session' }, { hook: 'web_hook', config: {
    url: 'http://hono-server:3000/kratos/webhook/registration', method: 'POST', body: 'file:///etc/config/kratos/registration-body.jsonnet',
    auth: { type: 'api_key', config: { name: 'X-Kratos-Webhook-Key', in: 'header' } },
  } }])
  expect(await read(root, 'kratos/registration-body.jsonnet')).toBe('function(ctx) { email: ctx.identity.traits.email, identity_id: ctx.identity.id }\n')
  const contract = (await data(root, 'runtime-contract.json')).files.EAOS_KRATOS_RUNTIME_CONFIG.registrationHook
  expect(contract.hooks).toEqual(hooks)
  expect(contract.header).toBe('X-Kratos-Webhook-Key')
  expect(contract.secretValuePath).toBe('selfservice.flows.registration.after.password.hooks.1.config.auth.config.value')
  for (const service of ['kratos', 'kratos-migrate']) expect(compose.services[service].volumes).toContainEqual({ type: 'bind', source: './kratos/registration-body.jsonnet', target: '/etc/config/kratos/registration-body.jsonnet', read_only: true, bind: { create_host_path: false } })
  expect(await generatePlatform(root, { check: true })).toMatchObject({ status: 'current' })
})

test('custom Jsonnet is copied without execution, detects source drift, protects edits and prunes on disable', async () => {
  const config = { ...manifest(), overrides: { auth: { registrationHook: { path: '/hook', session: 'after', body: { path: 'body.jsonnet' } } } } }
  const root = await project(config)
  await writeFile(join(root, 'body.jsonnet'), 'error "generator must not execute host code"\n')
  await generatePlatform(root)
  expect(await read(root, 'kratos/registration-body.jsonnet')).toBe('error "generator must not execute host code"\n')
  const hooks = (await data(root, 'kratos/kratos.yml')).selfservice.flows.registration.after.password.hooks
  expect(hooks.map((hook: { hook: string }) => hook.hook)).toEqual(['web_hook', 'session'])
  expect((await data(root, 'runtime-contract.json')).files.EAOS_KRATOS_RUNTIME_CONFIG.registrationHook.secretValuePath).toContain('hooks.0.config')
  await writeFile(join(root, 'body.jsonnet'), 'function(ctx) { identity_id: ctx.identity.id }\n')
  await expect(generatePlatform(root, { check: true })).rejects.toThrow('stale')
  await generatePlatform(root)
  const original = await read(root, 'kratos/registration-body.jsonnet')
  await writeFile(output(root, 'kratos/registration-body.jsonnet'), 'host edit')
  await expect(generatePlatform(root)).rejects.toThrow('edited or removed')
  await writeFile(output(root, 'kratos/registration-body.jsonnet'), original)
  await writeFile(join(root, 'eaos.platform.json'), JSON.stringify({ ...manifest(), overrides: { auth: { registrationHook: false } } }))
  await generatePlatform(root)
  expect(await readdir(output(root, 'kratos'))).not.toContain('registration-body.jsonnet')
  expect((await data(root, 'kratos/kratos.yml')).selfservice.flows.registration).not.toHaveProperty('after')
  expect((await data(root, 'runtime-contract.json')).files.EAOS_KRATOS_RUNTIME_CONFIG).not.toHaveProperty('registrationHook')
  expect((await data(root, 'compose.yml')).services.kratos.volumes.some((v: { target: string }) => v.target.endsWith('.jsonnet'))).toBe(false)
})

test('custom hook files reject missing, symlink, generated-state, empty, invalid UTF-8 and oversized sources', async () => {
  const root = await project({ ...manifest(), overrides: { auth: { registrationHook: { path: '/hook', body: { path: 'body.jsonnet' } } } } })
  await expect(generatePlatform(root)).rejects.toThrow('regular Jsonnet')
  const outside = await project()
  await symlink(join(outside, 'eaos.platform.json'), join(root, 'body.jsonnet'))
  await expect(generatePlatform(root)).rejects.toThrow('symlink')
  await rm(join(root, 'body.jsonnet'))
  for (const body of ['', ' \n', '\0DUMMY_SECRET', Buffer.from([0xff]), 'x'.repeat(1024 * 1024 + 1)]) {
    await writeFile(join(root, 'body.jsonnet'), body)
    await expect(generatePlatform(root)).rejects.toThrow('Platform generation:')
  }
  expect(await readdir(root)).not.toContain('.eaos')
  await writeFile(join(root, 'eaos.platform.json'), JSON.stringify({ ...manifest(), overrides: { auth: { registrationHook: { path: '/hook', body: { path: './.eaos/body.jsonnet' } } } } }))
  await expect(generatePlatform(root)).rejects.toThrow()
})

test('external UI and return URL flow through Kratos without changing nginx or Compose ports', async () => {
  const root = await project()
  await generatePlatform(root)
  const originalNginx = await read(root, 'nginx/nginx.conf')
  await writeFile(join(root, 'eaos.platform.json'), JSON.stringify({ ...manifest(), overrides: { auth: {
    uiOrigin: 'https://local.example.com:3000', defaultBrowserReturnUrl: 'https://portal.example.com/home',
    ui: { login: '/', registration: '/', logout: '/' },
  } } }))
  await expect(generatePlatform(root, { check: true })).rejects.toThrow('stale')
  await generatePlatform(root)
  const kratos = await data(root, 'kratos/kratos.yml'), compose = await data(root, 'compose.yml')
  expect(await read(root, 'nginx/nginx.conf')).toBe(originalNginx)
  expect(compose.services.nginx.ports).toEqual(['443:443', '80:80'])
  expect(compose.services['hono-server'].environment.CORS_ALLOW_ORIGIN).toBe('https://app.example.com')
  expect(kratos.serve.public.cors.allowed_origins).toEqual(['https://app.example.com', 'https://local.example.com:3000'])
  expect(kratos.selfservice.flows.login.ui_url).toBe('https://local.example.com:3000/')
  expect(kratos.selfservice.flows.logout.after.default_browser_return_url).toBe('https://local.example.com:3000/')
  expect(kratos.selfservice.default_browser_return_url).toBe('https://portal.example.com/home')
  expect(kratos.selfservice.allowed_return_urls).toContain('https://portal.example.com/home')
  expect(await generatePlatform(root, { check: true })).toMatchObject({ status: 'current' })
})

test('service CORS changes regenerate only the intended permissions in Compose and Kratos', async () => {
  const root = await project()
  await generatePlatform(root)
  const originalNginx = await read(root, 'nginx/nginx.conf')
  await writeFile(join(root, 'eaos.platform.json'), JSON.stringify({ ...manifest(), overrides: {
    auth: { uiOrigin: 'https://local.example.com:3000' },
    cors: { additionalOrigins: ['https://example.com'], honoAdditionalOrigins: ['https://www.example.com'], kratosAdditionalOrigins: ['https://chat.example.com'] },
  } }))
  await expect(generatePlatform(root, { check: true })).rejects.toThrow('stale')
  await generatePlatform(root)
  const hono = await data(root, 'hono.json'), compose = await data(root, 'compose.yml'), kratos = await data(root, 'kratos/kratos.yml')
  expect(hono.corsOrigins).toEqual(['https://app.example.com', 'https://example.com', 'https://www.example.com'])
  expect(compose.services['hono-server'].environment.CORS_ALLOW_ORIGIN).toBe(hono.corsOrigins.join(','))
  expect(kratos.serve.public.cors.allowed_origins).toEqual(['https://app.example.com', 'https://example.com', 'https://local.example.com:3000', 'https://chat.example.com'])
  expect(await read(root, 'nginx/nginx.conf')).toBe(originalNginx)
  expect(await generatePlatform(root, { check: true })).toMatchObject({ status: 'current' })
})

test('check writes nothing; regeneration is deterministic; drift detected', async () => {
  const root = await project()
  await expect(generatePlatform(root, { check: true })).rejects.toThrow('stale')
  expect(await readdir(root)).toEqual(['eaos.platform.json'])
  await generatePlatform(root)
  const before = await read(root, 'receipt.json')
  expect((await generatePlatform(root)).status).toBe('current')
  expect(await read(root, 'receipt.json')).toBe(before)
  await writeFile(join(root, 'eaos.platform.json'), JSON.stringify({ ...manifest(), overrides: { services: { backend: { port: 4500 } } } }))
  await expect(generatePlatform(root, { check: true })).rejects.toThrow('stale')
  expect(await read(root, 'receipt.json')).toBe(before)
})

test('manual edits, unmanaged files and removed outputs stop before writing', async () => {
  const root = await project(); await generatePlatform(root)
  const original = await read(root, 'nginx/nginx.conf'), receipt = await read(root, 'receipt.json')
  await writeFile(output(root, 'nginx/nginx.conf'), 'manual')
  await expect(generatePlatform(root)).rejects.toThrow('edited or removed')
  expect(await read(root, 'nginx/nginx.conf')).toBe('manual')
  expect(await read(root, 'receipt.json')).toBe(receipt)
  await writeFile(output(root, 'nginx/nginx.conf'), original)
  await writeFile(output(root, 'custom.txt'), 'custom')
  await expect(generatePlatform(root)).rejects.toThrow('unmanaged')
  await rm(output(root, 'custom.txt')); await rm(output(root, 'hono.json'))
  await expect(generatePlatform(root)).rejects.toThrow('edited or removed')
})

test('first generation refuses unmanaged collisions even when contents would match', async () => {
  const root = await project(); await mkdir(output(root, 'nginx'), { recursive: true })
  await writeFile(output(root, 'nginx/nginx.conf'), 'host-owned')
  await expect(generatePlatform(root)).rejects.toThrow('unmanaged')
  expect(await read(root, 'nginx/nginx.conf')).toBe('host-owned')
})

test('symlinks, invalid receipts and interrupted writer locks fail closed', async () => {
  const root = await project(), outside = await project()
  await symlink(outside, join(root, '.eaos'))
  await expect(generatePlatform(root)).rejects.toThrow('symlink')
  await rm(join(root, '.eaos')); await generatePlatform(root)
  await writeFile(output(root, 'receipt.json'), JSON.stringify({ formatVersion: 1, files: { '../outside': 'fake' } }))
  await expect(generatePlatform(root)).rejects.toThrow('invalid receipt')
  await writeFile(join(root, '.eaos/platform-generate.lock'), 'lock')
  await expect(generatePlatform(root, { check: true })).rejects.toThrow('holds')
})

test('schema path symlinks and invalid JSON are refused without echoing content', async () => {
  const root = await project({ ...manifest(), overrides: { auth: { identitySchemas: [{ id: 'default', path: 'schema.json' }] } } }), outside = await project()
  await symlink(join(outside, 'eaos.platform.json'), join(root, 'schema.json'))
  await expect(generatePlatform(root)).rejects.toThrow('symlink')
  await rm(join(root, 'schema.json')); await writeFile(join(root, 'schema.json'), 'DUMMY_SECRET')
  try { await generatePlatform(root); throw new Error('missing validation') } catch (error) { expect(String(error)).toContain('invalid JSON'); expect(String(error)).not.toContain('DUMMY_SECRET') }
})

test('obsolete generated schemas are removed only when still owned and unedited', async () => {
  const root = await project(); await generatePlatform(root)
  await writeFile(join(root, 'schema.json'), JSON.stringify({ type: 'object', properties: { traits: { type: 'object' } } }))
  await writeFile(join(root, 'eaos.platform.json'), JSON.stringify({ ...manifest(), overrides: { auth: { identitySchemas: [{ id: 'v2', path: 'schema.json' }] } } }))
  await generatePlatform(root)
  expect((await readdir(output(root, 'kratos'))).sort()).toEqual(['identity-v2.json', 'kratos.yml'])
})

test.each([
  { ...manifest(), deployment: { ...manifest().deployment, secret: 'DUMMY_SECRET' } },
  { ...manifest(), deployment: { images: { backend: 'example/backend:latest', frontend: 'example/frontend:1' } } },
  { ...manifest(), overrides: { services: { backend: { name: 'kratos-db' } } } },
  { ...manifest(), overrides: { origins: { app: 'https://app.example.com:80' } } },
  { ...manifest(), overrides: { origins: { auth: 'https://app.example.com:8443' } } },
])('invalid deployment or nginx constraints are rejected without input values', input => {
  expect(() => resolveManifest(input)).toThrow()
  try { resolveManifest(input) } catch (error) { expect(String(error)).not.toContain('DUMMY_SECRET') }
})


test('explicit additional API prefixes route only exact path and children to the API without rewriting host or URI', async () => {
  const root = await project({ ...manifest(), platform: { ...manifest().platform, ingress: { additionalApiPrefixes: ['/public/catalog/api'] } } })
  await generatePlatform(root)
  const nginx = await read(root, 'nginx/nginx.conf')
  for (const prefix of ['/api', '/public/catalog/api']) {
    expect(nginx).toContain(`location = ${prefix} {`)
    expect(nginx).toContain(`location ${prefix}/ {`)
  }
  expect(nginx).not.toContain('location /public {')
  expect(nginx).toContain('proxy_set_header Host $http_host;')
  expect(nginx).not.toContain('proxy_pass $target/;')
  expect(nginx.match(/location = \/public\/catalog\/api/g)).toHaveLength(1)
})
