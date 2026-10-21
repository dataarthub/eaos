import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatePlatform, type PlatformManifest } from './index'
import { emailIdentitySchema, renderPlatform, resolveManifest } from './render'

const manifest = (): PlatformManifest => ({
  platform: { appName: 'sample', baseDomain: 'example.com' },
  deployment: { images: { backend: 'registry.example.com/team/backend:1', frontend: 'registry.example.com/team/frontend:1' } },
})
const ingress: NonNullable<PlatformManifest['platform']['ingress']> = { hostRoutes: [
  { host: 'api.example.com', target: 'backend' },
  { host: 'chat.example.com', target: { host: 'ai-server', port: 8100, resolution: 'system' }, proxy: { readTimeoutSeconds: 300, sendTimeoutSeconds: 300 } },
  { host: 'dify.example.com', target: { host: 'ai-dify', port: 8090 }, proxy: { buffering: true } },
] }
function render(input: PlatformManifest) {
  const { config, deployment } = resolveManifest(input)
  return renderPlatform(config, deployment, { default: emailIdentitySchema })
}
function server(nginx: string, name: string) {
  return nginx.split('  server {\n').slice(1).find(block => block.includes(`server_name ${name};`))!
}

test('host routing keeps whole request URI, shared headers, static redirects and distinct DNS modes', () => {
  const input = manifest()
  input.platform.ingress = ingress
  input.platform.origins = { app: 'https://portal.example.com:8443' }
  input.platform.services = { backend: { name: 'custom-backend', port: 4500 } }
  const files = render(input), nginx = files['nginx/nginx.conf']
  const api = server(nginx, 'api.example.com'), chat = server(nginx, 'chat.example.com'), dify = server(nginx, 'dify.example.com')
  expect(api).toContain('listen 8443 ssl;')
  expect(api).toContain('location / {')
  expect(api).not.toContain('location /api/')
  expect(api).toContain('set $target http://custom-backend:4500;\n      proxy_pass $target;')
  expect(chat).toContain('proxy_pass http://ai-server:8100;')
  expect(chat).not.toContain('set $target')
  expect(chat).toContain('proxy_read_timeout 300s;')
  expect(chat).toContain('proxy_send_timeout 300s;')
  expect(chat).toContain('proxy_buffering off;')
  expect(dify).toContain('set $target http://ai-dify:8090;')
  expect(dify).toContain('proxy_buffering on;')
  for (const block of [api, chat, dify]) {
    expect(block).toContain('proxy_set_header Host $http_host;')
    expect(block).toContain('proxy_set_header Connection $connection_upgrade;')
    expect(block).toContain('proxy_set_header X-Forwarded-For $remote_addr;')
  }
  expect(nginx).toContain('return 308 https://chat.example.com:8443$request_uri;')
  expect(nginx).toContain('server_name _; return 444;')
  const runtime = JSON.parse(files['runtime-contract.json'])
  expect(runtime.files.EAOS_TLS_DIRECTORY.serverNames).toEqual(['portal.example.com', 'auth.example.com', 'api.example.com', 'chat.example.com', 'dify.example.com'])
  expect(runtime.ingress.externalUpstreams).toEqual([
    { host: 'chat.example.com', upstream: 'http://ai-server:8100', resolution: 'system' },
    { host: 'dify.example.com', upstream: 'http://ai-dify:8090', resolution: 'docker' },
  ])
})

test('Compose/Kamal do not provision external services or change published ports or auth', () => {
  const input = manifest()
  input.deployment.target = 'both'
  input.platform.networkName = 'kamal'
  input.deployment.kamal = { host: 'example-app' }
  const original = render(input)
  input.platform.ingress = ingress
  const files = render(input)
  for (const name of ['compose.yml', 'services.json', 'kamal-backend.yml', 'kamal-frontend.yml', 'kamal-operations.json', 'hono.json', 'kratos/kratos.yml']) expect(files[name]).toBe(original[name])
  input.platform.ingress = { hostRoutes: [] }
  expect(render(input)['nginx/nginx.conf']).toBe(original['nginx/nginx.conf'])
  expect(render(input)['runtime-contract.json']).toBe(original['runtime-contract.json'])
})

test('HTTP development routes inherit the app port without TLS or redirect', () => {
  const input = manifest()
  input.platform = { ...input.platform, ingress, environment: 'development', origins: { app: 'http://app.example.com:8080', auth: 'http://auth.example.com:8081' }, auth: { cookie: { secure: false } } }
  const files = render(input)
  expect(server(files['nginx/nginx.conf'], 'chat.example.com')).toContain('listen 8080;')
  expect(files['nginx/nginx.conf']).not.toContain('return 308')
  expect(files['nginx/nginx.conf']).not.toContain('ssl_certificate')
  expect(JSON.parse(files['runtime-contract.json']).files.EAOS_TLS_DIRECTORY).toBeUndefined()
})

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
test('host route generation detects drift, protects edits and removes routes deterministically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eaos-host-routes-')); roots.push(root)
  const input = manifest(), path = join(root, 'eaos.platform.json'), nginxPath = join(root, '.eaos/generated/platform/nginx/nginx.conf')
  await writeFile(path, JSON.stringify(input)); await generatePlatform(root)
  const original = await readFile(nginxPath, 'utf8')
  input.platform.ingress = ingress
  await writeFile(path, JSON.stringify(input))
  await expect(generatePlatform(root, { check: true })).rejects.toThrow('stale')
  expect(await readFile(nginxPath, 'utf8')).toBe(original)
  await generatePlatform(root)
  const generated = await readFile(nginxPath, 'utf8')
  await writeFile(nginxPath, 'manual edit')
  await expect(generatePlatform(root)).rejects.toThrow('edited or removed')
  await writeFile(nginxPath, generated)
  input.platform.ingress = { hostRoutes: [] }
  await writeFile(path, JSON.stringify(input)); await generatePlatform(root)
  expect(await readFile(nginxPath, 'utf8')).toBe(original)
  expect((await generatePlatform(root, { check: true })).status).toBe('current')
})
