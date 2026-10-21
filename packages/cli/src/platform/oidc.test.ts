import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatePlatform, type PlatformManifest } from './index'
import { emailIdentitySchema, renderPlatform, resolveManifest } from './render'

const manifest = (): PlatformManifest => ({
  platform: { appName: 'sample', baseDomain: 'example.com' },
  deployment: { images: { backend: 'example/backend:1', frontend: 'example/frontend:1' } },
})
function render(input: PlatformManifest) {
  const { config, deployment } = resolveManifest(input)
  return renderPlatform(config, deployment, { default: emailIdentitySchema })
}

test('OIDC defaults stay absent until opted in; credentials stay outside generated providers', () => {
  const input = manifest(), original = render(input)
  expect(JSON.parse(original['kratos/kratos.yml']).selfservice.methods).not.toHaveProperty('oidc')
  expect(original['kratos/google-mapper.jsonnet']).toBeUndefined()
  input.platform.auth = { oidc: { google: {} } }
  const files = render(input), kratos = JSON.parse(files['kratos/kratos.yml']), compose = JSON.parse(files['compose.yml'])
  const providers = [{ id: 'google', provider: 'google', mapper_url: 'file:///etc/config/kratos/google-mapper.jsonnet', scope: ['email', 'profile'] }]
  expect(kratos.selfservice.methods.oidc).toEqual({ enabled: true, config: { providers } })
  const runtime = JSON.parse(files['runtime-contract.json']).files.EAOS_KRATOS_RUNTIME_CONFIG.oidc
  expect(runtime.providers).toEqual(providers)
  expect(runtime.providersPath).toBe('selfservice.methods.oidc.config.providers')
  expect(runtime.clientIdPath).toBe('selfservice.methods.oidc.config.providers.0.client_id')
  expect(runtime.clientSecretPath).toBe('selfservice.methods.oidc.config.providers.0.client_secret')
  expect(runtime.callbackUrl).toBe('https://auth.example.com/self-service/methods/oidc/callback/google')
  expect(files['kratos/google-mapper.jsonnet']).toContain("claims.email_verified == true")
  expect(files['kratos/google-mapper.jsonnet']).toContain("verified_addresses")
  expect(JSON.parse(files['kratos/identity-default.json']).properties.traits.properties.email['ory.sh/kratos'].verification).toEqual({via:'email'})
  expect(files['nginx/nginx.conf']).toBe(original['nginx/nginx.conf'])
  expect(files['hono.json']).toBe(original['hono.json'])
  expect(files['kratos/identity-default.json']).toBe(original['kratos/identity-default.json'])
  for (const service of ['kratos', 'kratos-migrate']) expect(compose.services[service].volumes).toContainEqual({ type: 'bind', source: './kratos/google-mapper.jsonnet', target: '/etc/config/kratos/google-mapper.jsonnet', read_only: true, bind: { create_host_path: false } })
})

test('OIDC mapper reaches Kamal serve/migration without extending password registration hooks', () => {
  const input = manifest()
  input.platform.networkName = 'kamal'
  input.platform.auth = { oidc: { google: { id: 'existing-google' } }, registrationHook: { path: '/registered', body: 'identity-email-v1', session: 'before' } }
  input.deployment.target = 'both'
  input.deployment.kamal = { host: 'example-app' }
  const files = render(input), backend = JSON.parse(files['kamal-backend.yml']), ops = JSON.parse(files['kamal-operations.json'])
  expect(backend.accessories.kratos.files).toContainEqual({ local: '.eaos/generated/platform/kratos/google-mapper.jsonnet', remote: '/etc/config/kratos/google-mapper.jsonnet', options: 'ro', mode: '0644' })
  expect(ops.copyBeforeMigration).toContainEqual({ local: '.eaos/generated/platform/kratos/google-mapper.jsonnet', remote: '/etc/eaos/sample/migration/kratos/google-mapper.jsonnet', target: '/etc/config/kratos/google-mapper.jsonnet' })
  expect(ops.firstInstall[1].onHostArgv).toContain('type=bind,source=/etc/eaos/sample/migration/kratos/google-mapper.jsonnet,target=/etc/config/kratos/google-mapper.jsonnet,readonly')
  const kratos = JSON.parse(files['kratos/kratos.yml'])
  expect(kratos.selfservice.methods.oidc.config.providers[0].id).toBe('existing-google')
  expect(Object.keys(kratos.selfservice.flows.registration.after)).toEqual(['password'])
  expect(files['kratos/registration-body.jsonnet']).toBeDefined()
})

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function project(input: PlatformManifest) {
  const root = await mkdtemp(join(tmpdir(), 'eaos-oidc-')); roots.push(root)
  await writeFile(join(root, 'eaos.platform.json'), JSON.stringify(input))
  return root
}
const output = (root: string, name: string) => join(root, '.eaos/generated/platform', name)

test('custom mapper and existing schema are copied unchanged; drift, edits and opt-out use receipts', async () => {
  const input = manifest()
  input.platform.auth = { oidc: { google: { id: 'existing-google', mapper: { path: 'google.jsonnet' } } }, identitySchemas: [{ id: 'legacy', path: 'schema.json' }] }
  const root = await project(input)
  // Generation must never execute custom Jsonnet, including code that fails on execution.
  const source = 'error "host mapper is only copied"\n'
  await writeFile(join(root, 'google.jsonnet'), source)
  const schema = { type: 'object', properties: { traits: { type: 'object', properties: { email: { type: 'string' }, tenant_id: { type: 'string' } } } } }
  await writeFile(join(root, 'schema.json'), JSON.stringify(schema))
  await generatePlatform(root)
  expect(await readFile(output(root, 'kratos/google-mapper.jsonnet'), 'utf8')).toBe(source)
  expect(JSON.parse(await readFile(output(root, 'kratos/identity-legacy.json'), 'utf8'))).toEqual(schema)
  expect((await generatePlatform(root, { check: true })).status).toBe('current')
  await writeFile(join(root, 'google.jsonnet'), source + '// changed\n')
  await expect(generatePlatform(root, { check: true })).rejects.toThrow('stale')
  await generatePlatform(root)
  await writeFile(output(root, 'kratos/google-mapper.jsonnet'), 'local edit')
  await expect(generatePlatform(root)).rejects.toThrow('edited or removed')
  await writeFile(output(root, 'kratos/google-mapper.jsonnet'), source + '// changed\n')
  input.platform.auth.oidc = false
  await writeFile(join(root, 'eaos.platform.json'), JSON.stringify(input))
  await generatePlatform(root)
  expect(await readdir(output(root, 'kratos'))).not.toContain('google-mapper.jsonnet')
  expect(await readFile(join(root, 'google.jsonnet'), 'utf8')).toBe(source + '// changed\n')
  const kratos = JSON.parse(await readFile(output(root, 'kratos/kratos.yml'), 'utf8'))
  expect(kratos.selfservice.methods).not.toHaveProperty('oidc')
  const runtime = JSON.parse(await readFile(output(root, 'runtime-contract.json'), 'utf8'))
  expect(runtime.files.EAOS_KRATOS_RUNTIME_CONFIG).not.toHaveProperty('oidc')
  const compose = JSON.parse(await readFile(output(root, 'compose.yml'), 'utf8'))
  expect(compose.services.kratos.volumes.some((file: { target: string }) => file.target.endsWith('google-mapper.jsonnet'))).toBe(false)
})

test('OIDC custom mapper rejects unsafe or invalid sources before creating outputs', async () => {
  const input = manifest()
  input.platform.auth = { oidc: { google: { mapper: { path: 'google.jsonnet' } } } }
  const root = await project(input)
  await expect(generatePlatform(root)).rejects.toThrow('regular Jsonnet')
  await symlink(join(root, 'eaos.platform.json'), join(root, 'google.jsonnet'))
  await expect(generatePlatform(root)).rejects.toThrow('symlink')
  await rm(join(root, 'google.jsonnet'))
  for (const source of ['', '\0DUMMY_SECRET', Buffer.from([0xff]), 'x'.repeat(1024 * 1024 + 1)]) {
    await writeFile(join(root, 'google.jsonnet'), source)
    await expect(generatePlatform(root)).rejects.toThrow('Platform generation:')
  }
  expect(await readdir(root)).not.toContain('.eaos')
  expect(() => render(input)).toThrow('Google mapper file must be loaded')
})
