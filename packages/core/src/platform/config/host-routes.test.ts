import { expect, test } from 'bun:test'
import { PlatformConfigError, resolvePlatformConfig, type IngressHostRoute, type PlatformConfig } from './index'

const minimal = { appName: 'sample', baseDomain: 'example.com' }
const routes: IngressHostRoute[] = [
  { host: 'api.example.com', target: 'backend' },
  { host: 'chat.example.com', target: { host: 'ai-server', port: 8100, resolution: 'system' }, proxy: { readTimeoutSeconds: 300, sendTimeoutSeconds: 300 } },
  { host: 'dify.example.com', target: { host: 'ai-server', port: 8090 } },
]

test('host routes derive managed targets and listener origins without widening authentication', () => {
  const input: PlatformConfig = { ...minimal, ingress: { hostRoutes: routes } }
  const before = JSON.stringify(input)
  const config = resolvePlatformConfig(input, { origins: { app: 'https://portal.example.com:8443' }, services: { backend: { name: 'api-service', port: 4500 } } })
  expect(config.nginx.hostRoutes[0]).toEqual({ host: 'api.example.com', origin: 'https://api.example.com:8443', upstream: 'http://api-service:4500', resolution: 'docker', service: 'backend', proxy: { readTimeoutSeconds: 180, sendTimeoutSeconds: 180, buffering: false } })
  expect(config.nginx.hostRoutes[1].upstream).toBe('http://ai-server:8100')
  expect(config.nginx.hostRoutes[1].resolution).toBe('system')
  expect(config.nginx.hostRoutes[1].proxy.readTimeoutSeconds).toBe(300)
  expect(config.nginx.hostRoutes[2].resolution).toBe('docker')
  expect(config.hono.corsOrigins).toEqual(['https://portal.example.com:8443'])
  expect(config.kratos).toEqual(resolvePlatformConfig({ ...minimal, origins: { app: 'https://portal.example.com:8443' }, services: { backend: { name: 'api-service', port: 4500 } } }).kratos)
  expect(config.provenance['ingress.hostRoutes']).toBe('app')
  expect(Object.isFrozen(config.nginx.hostRoutes[1].proxy)).toBe(true)
  expect(JSON.stringify(input)).toBe(before)
})

test('routes replace as a whole, can be cleared, and frontend references follow service overrides', () => {
  const input = { ...minimal, ingress: { hostRoutes: routes } }
  const changed = resolvePlatformConfig(input, { ingress: { hostRoutes: [{ host: 'site.example.com', target: 'frontend', proxy: { buffering: true } }] }, services: { frontend: { name: 'web', port: 8080 } } })
  expect(changed.nginx.hostRoutes).toHaveLength(1)
  expect(changed.nginx.hostRoutes[0].upstream).toBe('http://web:8080')
  expect(changed.nginx.hostRoutes[0].proxy.buffering).toBe(true)
  expect(changed.provenance['ingress.hostRoutes']).toBe('environment')
  expect(resolvePlatformConfig(input, { ingress: { hostRoutes: [] } }).nginx.hostRoutes).toEqual([])
  expect(resolvePlatformConfig(input, { ingress: { hostRoutes: undefined } }).nginx.hostRoutes).toHaveLength(3)
  expect(resolvePlatformConfig(minimal).nginx.hostRoutes).toEqual([])
})

test.each([
  {}, { host: 'api.example.com' }, { host: 'api.example.com', target: 'kratos' },
  { host: '*.example.com', target: 'backend' }, { host: 'api.example.com;bad', target: 'backend' },
  { host: 'https://api.example.com', target: 'backend' }, { host: 'api.other.com', target: 'backend' },
  { host: 'app.example.com', target: 'backend' }, { host: 'auth.example.com', target: 'backend' },
  { host: 'api.example.com', target: { host: 'ai-server' } },
  ...['127.0.0.1', '[::1]', 'http://ai-server', '$target', 'ai-server/path', 'ai-server;bad', 'kratos', 'kratos-db', 'hono-server'].map(host => ({ host: 'api.example.com', target: { host, port: 4434 } })),
  { host: 'api.example.com', target: { host: 'ai-server', port: 0 } },
  { host: 'api.example.com', target: { host: 'ai-server', port: 8100, resolution: 'auto' } },
  { host: 'api.example.com', target: 'backend', proxy: { readTimeoutSeconds: 0 } },
  { host: 'api.example.com', target: 'backend', proxy: { sendTimeoutSeconds: 3601 } },
  { host: 'api.example.com', target: 'backend', proxy: { readTimeoutSeconds: 1.5 } },
  { host: 'api.example.com', target: 'backend', proxy: { buffering: 'off' } },
  { host: 'api.example.com', target: 'backend', location: '/' },
].map(route => [route]))('rejects malformed or conflicting host route %j', route => {
  expect(() => resolvePlatformConfig({ ...minimal, ingress: { hostRoutes: [route] } })).toThrow(PlatformConfigError)
})

test('rejects duplicate routes, alias collisions, invalid arrays and hidden invalid lower input', () => {
  for (const ingress of [
    { hostRoutes: [routes[0], routes[0]] }, { appAliases: ['api.example.com'], hostRoutes: routes },
    { hostRoutes: null }, { hostRoutes: {} }, { hostRoutes: Array(101).fill(routes[0]) },
  ]) expect(() => resolvePlatformConfig({ ...minimal, ingress })).toThrow(PlatformConfigError)
  expect(() => resolvePlatformConfig({ ...minimal, ingress: { hostRoutes: [{ host: 'bad;', target: 'backend' }] } }, { ingress: { hostRoutes: [] } })).toThrow(PlatformConfigError)
})


test('additional API prefixes preserve base routing without expanding authentication origins', () => {
  const baseline = resolvePlatformConfig(minimal)
  const config = resolvePlatformConfig({ ...minimal, ingress: { additionalApiPrefixes: ['/public/catalog/api'] } })
  expect(config.nginx.api.prefixes).toEqual(['/api', '/public/catalog/api'])
  expect(config.kratos).toEqual(baseline.kratos)
  expect(config.hono).toEqual(baseline.hono)
  expect(Object.isFrozen(config.nginx.api.prefixes)).toBe(true)
  expect(resolvePlatformConfig(minimal).nginx.api.prefixes).toEqual(['/api'])
  for (const prefixes of [ ['/'], ['/api'], ['/api/sub'], ['/public', '/public/api'], ['/public', '/public'], ['/public/'], ['/Public'], ['/pub/../api'], ['/pub?api'], ['/pub;bad'], ['/$target'], ['/pub/*'] ]) {
    expect(() => resolvePlatformConfig({ ...minimal, ingress: { additionalApiPrefixes: prefixes } })).toThrow(PlatformConfigError)
  }
})
