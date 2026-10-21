import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
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

test('app aliases share routes and preserve their static HTTPS redirect hosts and app port', () => {
  const input = manifest()
  input.platform.origins = { app: 'https://app.example.com:8443' }
  const original = render(input)
  input.platform.ingress = { appAliases: ['erp.example.com', 'local.example.com'] }
  const files = render(input), nginx = files['nginx/nginx.conf']
  expect(nginx).toContain('listen 8443 ssl;\n    server_name app.example.com erp.example.com local.example.com;')
  expect(nginx).toContain('server_name erp.example.com; return 308 https://erp.example.com:8443$request_uri;')
  expect(nginx).toContain('server_name local.example.com; return 308 https://local.example.com:8443$request_uri;')
  expect(nginx).not.toContain('return 308 https://$host')
  expect(nginx).toContain('listen 443 ssl;\n    server_name auth.example.com;')
  expect(nginx.match(/location \/api\//g)).toHaveLength(1)
  expect(nginx.match(/location = \/api /g)).toHaveLength(1)
  expect(nginx).toContain('set $target http://hono-server:3000;')
  expect(nginx).toContain('set $target http://frontend:80;')
  expect(nginx).toContain('proxy_pass $target;')
  expect(nginx).toContain('proxy_set_header Host $http_host;')
  expect(nginx).toContain('server_name _; return 444;')
  expect(files['compose.yml']).toBe(original['compose.yml'])
  expect(files['hono.json']).toBe(original['hono.json'])
  expect(files['kratos/kratos.yml']).toBe(original['kratos/kratos.yml'])
  expect(JSON.parse(files['runtime-contract.json']).files.EAOS_TLS_DIRECTORY.serverNames).toEqual(['app.example.com', 'erp.example.com', 'local.example.com', 'auth.example.com'])
})

test('alias omission, empty input and duplicate canonical names keep the same nginx output', () => {
  const input = manifest(), original = render(input)['nginx/nginx.conf']
  input.platform.ingress = { appAliases: [] }
  expect(render(input)['nginx/nginx.conf']).toBe(original)
  input.platform.ingress.appAliases = ['app.example.com']
  expect(render(input)['nginx/nginx.conf']).toBe(original)
})

test('HTTP development aliases inherit the app listener without TLS, redirects or new ports', () => {
  const input = manifest()
  input.platform = { ...input.platform, environment: 'development',
    origins: { app: 'http://app.example.com:8080', auth: 'http://auth.example.com:8080' },
    auth: { cookie: { secure: false } }, ingress: { appAliases: ['erp.example.com'] },
  }
  const files = render(input), nginx = files['nginx/nginx.conf']
  expect(nginx).toContain('listen 8080;\n    server_name app.example.com erp.example.com;')
  expect(nginx).not.toContain('return 308')
  expect(nginx).not.toContain('ssl_certificate')
  expect(JSON.parse(files['compose.yml']).services.nginx.ports).toEqual(['8080:8080'])
  expect(JSON.parse(files['runtime-contract.json']).files).not.toHaveProperty('EAOS_TLS_DIRECTORY')
})

test('Kamal reuses the same nginx routes and publish ports for aliases', () => {
  const input = manifest()
  input.platform.networkName = 'kamal'
  input.deployment.target = 'both'
  input.deployment.kamal = { host: 'example-app' }
  const original = render(input)
  input.platform.ingress = { appAliases: ['erp.example.com'] }
  const files = render(input)
  expect(files['nginx/nginx.conf']).toContain('server_name app.example.com erp.example.com;')
  expect(files['kamal-backend.yml']).toBe(original['kamal-backend.yml'])
  expect(files['kamal-frontend.yml']).toBe(original['kamal-frontend.yml'])
  expect(files['compose.yml']).toBe(original['compose.yml'])
  expect(JSON.parse(files['kamal-backend.yml']).accessories.nginx.options.publish).toEqual(['443:443', '80:80'])
})

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
test('alias changes are checked, protect edited nginx, and clearing restores the default routes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eaos-nginx-aliases-')); roots.push(root)
  const input = manifest(), configPath = join(root, 'eaos.platform.json'), nginxPath = join(root, '.eaos/generated/platform/nginx/nginx.conf')
  await writeFile(configPath, JSON.stringify(input))
  await generatePlatform(root)
  const original = await readFile(nginxPath, 'utf8')
  input.platform.ingress = { appAliases: ['erp.example.com'] }
  await writeFile(configPath, JSON.stringify(input))
  await expect(generatePlatform(root, { check: true })).rejects.toThrow('stale')
  expect(await readFile(nginxPath, 'utf8')).toBe(original)
  await generatePlatform(root)
  const aliased = await readFile(nginxPath, 'utf8')
  expect(aliased).toContain('server_name app.example.com erp.example.com;')
  await writeFile(nginxPath, 'manual edit')
  await expect(generatePlatform(root)).rejects.toThrow('edited or removed')
  await writeFile(nginxPath, aliased)
  input.platform.ingress.appAliases = []
  await writeFile(configPath, JSON.stringify(input))
  await generatePlatform(root)
  expect(await readFile(nginxPath, 'utf8')).toBe(original)
  expect((await generatePlatform(root, { check: true })).status).toBe('current')
})
