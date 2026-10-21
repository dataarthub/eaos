import { describe, expect, test } from 'bun:test'
import { PlatformConfigError, resolvePlatformConfig, type PlatformConfig } from './index'

const minimal = { appName: 'sample', baseDomain: 'example.com' } satisfies PlatformConfig

describe('platform connection defaults', () => {
  test('minimal input derives a coherent sibling-origin cookie deployment', () => {
    const config = resolvePlatformConfig(minimal)
    expect(config.defaultsVersion).toBe('1')
    expect(config.origins).toEqual({ app: 'https://app.example.com', auth: 'https://auth.example.com' })
    expect(config.networkName).toBe('sample-network')
    expect(config.services.backend).toEqual({ name: 'hono-server', port: 3000, url: 'http://hono-server:3000' })
    expect(config.hono.port).toBe(3000)
    expect(config.nginx.api).toEqual({ path: '/api/', prefixes: ['/api'], upstream: 'http://hono-server:3000' })
    expect(config.nginx.appServerNames).toEqual(['app.example.com'])
    expect(config.hono.kratosPublicUrl).toBe('http://kratos:4433')
    expect(config.hono.kratosBrowserUrl).toBe('https://auth.example.com')
    expect(config.kratos.publicUrl).toBe('https://auth.example.com/')
    expect(config.kratos.adminUrl).toBe('http://kratos:4434/')
    expect(config.kratos.uiOrigin).toBe('https://app.example.com')
    expect(config.kratos.defaultBrowserReturnUrl).toBe('https://app.example.com/')
    expect(config.kratos.corsOrigins).toEqual(['https://app.example.com'])
    expect(config.kratos.cookie).toEqual({ name: 'ory_kratos_session', domain: 'example.com', path: '/', sameSite: 'Lax', secure: true, persistent: true })
    expect(config.kratos.identitySchemas).toEqual([{ id: 'default', source: { type: 'builtin', name: 'email-v1' } }])
    expect(config.kratos.registrationHook).toBe(false)
    expect(config.kratos.oidc).toBe(false)
    expect(config.kratos.allowedReturnUrls).toContain('https://app.example.com/settings')
  })

  test('preserves a corporate-shaped override without importing consumer code', () => {
    const config = resolvePlatformConfig({
      ...minimal, networkName: 'existing-network',
      origins: { app: 'https://portal.example.com/', auth: 'https://identity.example.com' },
      services: { backend: { name: 'hono-server', port: 3000 }, frontend: { name: 'existing-frontend' } },
      cors: { additionalOrigins: ['https://local.example.com:3000'] },
      auth: {
        cookie: { domain: 'example.com', name: 'ory_kratos_session', persistent: true },
        identitySchemas: [{ id: 'default', path: './apps/backend/kratos/identity.schema.json' }],
        defaultSchemaId: 'default', registrationHook: { path: '/kratos/webhook/registration' },
        ui: { login: '/', registration: '/', settings: '/settings' },
      },
    } satisfies PlatformConfig)
    expect(config.nginx.frontendUpstream).toBe('http://existing-frontend:80')
    expect(config.kratos.registrationHook).toEqual({ url: 'http://hono-server:3000/kratos/webhook/registration', authHeader: 'X-EAOS-Webhook-Key', session: false, body: false })
    expect(config.kratos.identitySchemas).toEqual([{ id: 'default', source: { type: 'file', path: './apps/backend/kratos/identity.schema.json' } }])
    expect(config.kratos.defaultSchemaId).toBe('default')
    expect(config.kratos.ui.login).toBe('https://portal.example.com/')
    expect(config.kratos.corsOrigins).toEqual(config.hono.corsOrigins)
    expect(config.kratos.cookie.domain).toBe('example.com')
  })

  test('external UI and return URL do not change public endpoints or Hono CORS', () => {
    const config = resolvePlatformConfig({ ...minimal, auth: {
      uiOrigin: 'https://local.example.com:3000/', defaultBrowserReturnUrl: 'https://portal.example.com/workspace',
      ui: { login: '/', registration: '/', settings: '/settings' },
    } } satisfies PlatformConfig)
    expect(config.origins).toEqual(resolvePlatformConfig(minimal).origins)
    expect(config.nginx).toEqual(resolvePlatformConfig(minimal).nginx)
    expect(config.hono.corsOrigins).toEqual(['https://app.example.com'])
    expect(config.kratos.corsOrigins).toEqual(['https://app.example.com', 'https://local.example.com:3000'])
    expect(config.kratos.ui.login).toBe('https://local.example.com:3000/')
    expect(config.kratos.ui.settings).toBe('https://local.example.com:3000/settings')
    expect(config.kratos.ui.logout).toBe('https://local.example.com:3000/login')
    expect(config.kratos.defaultBrowserReturnUrl).toBe('https://portal.example.com/workspace')
    expect(config.kratos.allowedReturnUrls).toContain('https://portal.example.com/workspace')
    expect(config.kratos.corsOrigins).not.toContain('https://portal.example.com')
    expect(config.provenance['auth.uiOrigin']).toBe('app')
    expect(config.provenance['auth.defaultBrowserReturnUrl']).toBe('app')
  })

  test('origin overrides resolve independently and UI API access remains explicit', () => {
    const config = resolvePlatformConfig({ ...minimal, auth: { uiOrigin: 'https://old.example.com', defaultBrowserReturnUrl: 'https://portal.example.com' } }, {
      origins: { app: 'https://edge.example.com' }, auth: { uiOrigin: 'https://ui.example.com:3000/' },
      cors: { additionalOrigins: ['https://ui.example.com:3000'] },
    })
    expect(config.kratos.uiOrigin).toBe('https://ui.example.com:3000')
    expect(config.kratos.defaultBrowserReturnUrl).toBe('https://portal.example.com/')
    expect(config.kratos.corsOrigins).toEqual(['https://edge.example.com', 'https://ui.example.com:3000'])
    expect(config.hono.corsOrigins).toEqual(config.kratos.corsOrigins)
    expect(config.provenance['auth.uiOrigin']).toBe('environment')
    expect(config.provenance['auth.defaultBrowserReturnUrl']).toBe('app')
    const inherited = resolvePlatformConfig(minimal, { origins: { app: 'https://edge.example.com' } })
    expect(inherited.kratos.uiOrigin).toBe('https://edge.example.com')
    expect(inherited.kratos.defaultBrowserReturnUrl).toBe('https://edge.example.com/')
    expect(inherited.provenance['auth.uiOrigin']).toBe('derived')
  })

  test('a second app and environment patch propagate all connection changes', () => {
    const input = {
      ...minimal, cors: { additionalOrigins: ['https://old.example.com'] },
      services: { backend: { port: 4100 } },
      auth: { registrationHook: { path: '/registered' }, cookie: { persistent: true } },
    }
    const before = JSON.stringify(input)
    const config = resolvePlatformConfig(input, {
      appName: 'second', baseDomain: 'other.test', origins: { app: 'https://portal.other.test' },
      services: { backend: { name: 'api', port: 5000 }, kratos: { name: 'identity', port: 6000, adminPort: 6001 } },
      cors: { additionalOrigins: ['https://field.other.test/', 'https://field.other.test'] },
      auth: { cookie: { persistent: false } },
    })
    expect(config.networkName).toBe('second-network')
    expect(config.origins.auth).toBe('https://auth.other.test')
    expect(config.hono.port).toBe(5000)
    expect(config.nginx.api.upstream).toBe('http://api:5000')
    expect(config.kratos.registrationHook).toEqual({ url: 'http://api:5000/registered', authHeader: 'X-EAOS-Webhook-Key', session: false, body: false })
    expect(config.hono.kratosPublicUrl).toBe('http://identity:6000')
    expect(config.kratos.adminUrl).toBe('http://identity:6001/')
    expect(config.kratos.ui.settings).toBe('https://portal.other.test/settings')
    expect(config.kratos.cookie.domain).toBe('other.test')
    expect(config.kratos.cookie.persistent).toBe(false)
    expect(config.hono.corsOrigins).toEqual(['https://portal.other.test', 'https://field.other.test'])
    expect(config.provenance['services.backend.port']).toBe('environment')
    expect(config.provenance['auth.registrationHook']).toBe('app')
    expect(config.provenance['auth.cookie.sameSite']).toBe('default')
    expect(config.provenance['origins.auth']).toBe('derived')
    expect(config.provenance['hono.port']).toBe('derived')
    expect(JSON.stringify(input)).toBe(before)
  })

  test('shared and service-specific CORS preserve different consumer allowlists', () => {
    const config = resolvePlatformConfig({ ...minimal,
      origins: { app: 'https://portal.example.com' },
      auth: { uiOrigin: 'https://local.example.com:3000' },
      cors: {
        additionalOrigins: ['https://example.com', 'https://local.example.com:3000/'],
        honoAdditionalOrigins: ['https://www.example.com', 'https://example.com/'],
        kratosAdditionalOrigins: ['https://chat.example.com/', 'https://local.example.com:3000'],
      },
    } satisfies PlatformConfig)
    expect(config.hono.corsOrigins).toEqual(['https://portal.example.com', 'https://example.com', 'https://local.example.com:3000', 'https://www.example.com'])
    expect(config.kratos.corsOrigins).toEqual(['https://portal.example.com', 'https://example.com', 'https://local.example.com:3000', 'https://chat.example.com'])
    expect(config.provenance['cors.honoAdditionalOrigins']).toBe('app')
    expect(config.provenance['cors.kratosAdditionalOrigins']).toBe('app')
    expect(config.kratos.allowedReturnUrls).not.toContain('https://chat.example.com/')
    expect(config.nginx.appOrigin).toBe('https://portal.example.com')
    expect(Object.isFrozen(config.kratos.corsOrigins)).toBe(true)
  })

  test('each CORS input array replaces independently, including empty environment overrides', () => {
    const input = { ...minimal,
      cors: {
        additionalOrigins: ['https://shared.example.com'],
        honoAdditionalOrigins: ['https://old.example.com'],
        kratosAdditionalOrigins: ['https://login.example.com'],
      },
    }
    const config = resolvePlatformConfig(input, { cors: { additionalOrigins: [], honoAdditionalOrigins: ['https://new.example.com'] } })
    expect(config.hono.corsOrigins).toEqual(['https://app.example.com', 'https://new.example.com'])
    expect(config.kratos.corsOrigins).toEqual(['https://app.example.com', 'https://login.example.com'])
    expect(config.provenance['cors.honoAdditionalOrigins']).toBe('environment')
    expect(config.provenance['cors.kratosAdditionalOrigins']).toBe('app')
    const cleared = resolvePlatformConfig(input, { cors: { honoAdditionalOrigins: [], kratosAdditionalOrigins: [] } })
    expect(cleared.hono.corsOrigins).toEqual(['https://app.example.com', 'https://shared.example.com'])
    expect(cleared.kratos.corsOrigins).toEqual(cleared.hono.corsOrigins)
    expect(input.cors.honoAdditionalOrigins).toEqual(['https://old.example.com'])
  })

  test('omitted service CORS arrays preserve existing behavior and explicit HTTP remains development-only', () => {
    const input = { ...minimal, auth: { uiOrigin: 'https://ui.example.com' }, cors: { additionalOrigins: ['https://shared.example.com'] } }
    const omitted = resolvePlatformConfig(input)
    const empty = resolvePlatformConfig(input, { cors: { honoAdditionalOrigins: [], kratosAdditionalOrigins: [] } })
    expect(omitted.hono).toEqual(empty.hono)
    expect(omitted.kratos).toEqual(empty.kratos)
    expect(omitted.provenance['cors.honoAdditionalOrigins']).toBe('default')
    const development = resolvePlatformConfig({ ...minimal, environment: 'development', cors: {
      honoAdditionalOrigins: ['http://localhost:5173'], kratosAdditionalOrigins: ['http://localhost:3000'],
    } })
    expect(development.hono.corsOrigins).toEqual(['https://app.example.com', 'http://localhost:5173'])
    expect(development.kratos.corsOrigins).toEqual(['https://app.example.com', 'http://localhost:3000'])
  })

  test('arrays replace, false disables, undefined preserves the lower layer', () => {
    const config = resolvePlatformConfig({
      ...minimal, services: { backend: { port: 5000 } },
      cors: { additionalOrigins: ['https://local.example.com'] },
      auth: { registrationHook: { path: '/hook' }, identitySchemas: [{ id: 'old', path: 'old.json' }] },
    }, {
      services: { backend: { port: undefined } }, cors: { additionalOrigins: [] },
      auth: { registrationHook: false, identitySchemas: [{ id: 'current', path: 'current.json' }] },
    })
    expect(config.services.backend.port).toBe(5000)
    expect(config.hono.corsOrigins).toEqual(['https://app.example.com'])
    expect(config.kratos.registrationHook).toBe(false)
    expect(config.kratos.defaultSchemaId).toBe('current')
    expect(config.kratos.identitySchemas).toHaveLength(1)
    expect(config.provenance['services.backend.port']).toBe('app')
  })

  test('multiple existing schema IDs remain available with an explicit default', () => {
    const config = resolvePlatformConfig({ ...minimal, auth: {
      identitySchemas: [{ id: 'old', path: 'schemas/v1.json' }, { id: 'default', path: 'schemas/v2.json' }], defaultSchemaId: 'default',
    } })
    expect(config.kratos.identitySchemas.map(schema => schema.id)).toEqual(['old', 'default'])
    expect(config.kratos.defaultSchemaId).toBe('default')
  })

  test('registration transport overrides preserve defaults and remain independent of business policy', () => {
    const input = { ...minimal, auth: { registrationHook: {
      path: '/kratos/webhook/registration', authHeader: 'X-Kratos-Webhook-Key', session: 'before', body: 'identity-email-v1',
    } } } satisfies PlatformConfig
    const config = resolvePlatformConfig(input, { services: { backend: { name: 'api', port: 4500 } } })
    expect(config.kratos.registrationHook).toEqual({ url: 'http://api:4500/kratos/webhook/registration', authHeader: 'X-Kratos-Webhook-Key', session: 'before', body: 'identity-email-v1' })
    expect(config.provenance['auth.registrationHook.session']).toBe('app')
    const custom = resolvePlatformConfig(input, { auth: { registrationHook: { path: '/hook', session: 'after', body: { path: 'hooks/registration.jsonnet' } } } })
    expect(custom.kratos.registrationHook).toEqual({ url: 'http://hono-server:3000/hook', authHeader: 'X-Kratos-Webhook-Key', session: 'after', body: { path: 'hooks/registration.jsonnet' } })
    expect(custom.provenance['auth.registrationHook.body']).toBe('environment')
    expect(resolvePlatformConfig(input, { auth: { registrationHook: { path: '/hook', session: false, body: false } } }).kratos.registrationHook).toMatchObject({ session: false, body: false })
    expect(resolvePlatformConfig(input, { auth: { registrationHook: false } }).kratos.registrationHook).toBe(false)
    expect(Object.isFrozen(custom.kratos.registrationHook)).toBe(true)
  })

  test('results are deterministic, isolated and immutable', () => {
    const first = resolvePlatformConfig(minimal), second = resolvePlatformConfig(minimal)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first).not.toBe(second)
    expect(Object.isFrozen(first.kratos.cookie)).toBe(true)
    expect(() => (first.hono.corsOrigins as string[]).push('https://untrusted.test')).toThrow()
    expect(second.hono.corsOrigins).toEqual(['https://app.example.com'])
  })

  test('app aliases add exact server names without expanding browser permissions or changing origins', () => {
    const original = resolvePlatformConfig(minimal)
    const config = resolvePlatformConfig({ ...minimal, ingress: { appAliases: ['erp.example.com', 'local.example.com', 'erp.example.com', 'app.example.com'] } } satisfies PlatformConfig)
    expect(config.nginx.appServerNames).toEqual(['app.example.com', 'erp.example.com', 'local.example.com'])
    expect(config.origins).toEqual(original.origins)
    expect(config.hono).toEqual(original.hono)
    expect(config.kratos).toEqual(original.kratos)
    expect(config.services).toEqual(original.services)
    expect(config.nginx.api).toEqual(original.nginx.api)
    expect(config.provenance['ingress.appAliases']).toBe('app')
    expect(Object.isFrozen(config.nginx.appServerNames)).toBe(true)
  })

  test('app alias overrides replace independently, follow the public app host and can be cleared', () => {
    const input = { ...minimal, ingress: { appAliases: ['old.example.com'] } }
    const config = resolvePlatformConfig(input, { origins: { app: 'https://portal.example.com:8443' }, ingress: { appAliases: ['erp.example.com'] } })
    expect(config.nginx.appServerNames).toEqual(['portal.example.com', 'erp.example.com'])
    expect(config.provenance['ingress.appAliases']).toBe('environment')
    expect(resolvePlatformConfig(input, { ingress: { appAliases: [] } }).nginx.appServerNames).toEqual(['app.example.com'])
    expect(resolvePlatformConfig(input, { ingress: { appAliases: undefined } }).nginx.appServerNames).toEqual(['app.example.com', 'old.example.com'])
    expect(input.ingress.appAliases).toEqual(['old.example.com'])
  })

  test('Google OIDC is explicit opt-in with defaults and a callback derived only from auth origin', () => {
    const config = resolvePlatformConfig({ ...minimal, auth: { oidc: { google: {} }, uiOrigin: 'https://ui.example.com:3000' } } satisfies PlatformConfig)
    expect(config.kratos.oidc).toEqual({ google: {
      id: 'google', provider: 'google', scopes: ['email', 'profile'], mapper: 'google-verified-email-v1',
      callbackUrl: 'https://auth.example.com/self-service/methods/oidc/callback/google',
    } })
    expect(config.provenance['auth.oidc.google.id']).toBe('default')
    expect(config.provenance['auth.oidc.google.mapper']).toBe('default')
    expect(config.nginx).toEqual(resolvePlatformConfig(minimal).nginx)
    expect(config.kratos.identitySchemas).toEqual(resolvePlatformConfig(minimal).kratos.identitySchemas)
    expect(resolvePlatformConfig(minimal, { auth: { oidc: false } }).kratos.oidc).toBe(false)
  })

  test('existing Google ID, custom mapper and schema stay host-owned; overrides replace scopes', () => {
    const input = { ...minimal, auth: {
      identitySchemas: [{ id: 'existing', path: 'identity.json' }],
      oidc: { google: { id: 'Google_existing', scopes: ['email', 'profile'], mapper: { path: 'auth/google.jsonnet' } } },
    } } satisfies PlatformConfig
    const config = resolvePlatformConfig(input, {
      origins: { auth: 'https://identity.example.com:8443' }, auth: { oidc: { google: { scopes: ['profile', 'profile'] } } },
    })
    expect(config.kratos.oidc).toEqual({ google: {
      id: 'Google_existing', provider: 'google', scopes: ['profile'], mapper: { path: 'auth/google.jsonnet' },
      callbackUrl: 'https://identity.example.com:8443/self-service/methods/oidc/callback/Google_existing',
    } })
    expect(config.kratos.defaultSchemaId).toBe('existing')
    expect(config.provenance['auth.oidc.google.scopes']).toBe('environment')
    expect(config.provenance['auth.oidc.google.id']).toBe('app')
    expect(Object.isFrozen(config.kratos.oidc && config.kratos.oidc.google.scopes)).toBe(true)
    expect(resolvePlatformConfig(input, { auth: { oidc: false } }).kratos.oidc).toBe(false)
    expect(input.auth.oidc.google.scopes).toEqual(['email', 'profile'])
    const builtin = resolvePlatformConfig(input, { auth: { oidc: { google: { mapper: 'google-verified-email-v1' } } } })
    expect(builtin.kratos.oidc && builtin.kratos.oidc.google.mapper).toBe('google-verified-email-v1')
  })

  test('development HTTP is explicit and cookie semantics stay coherent', () => {
    const config = resolvePlatformConfig({ ...minimal, environment: 'development', origins: {
      app: 'http://app.example.com:3000', auth: 'http://auth.example.com:4433',
    }, auth: { cookie: { secure: false } } })
    expect(config.kratos.cookie.secure).toBe(false)
    expect(config.kratos.ui.login).toBe('http://app.example.com:3000/login')
  })
})

describe('configuration diagnostics', () => {
  test.each([
    ['*.example.com'], ['~^.*$'], ['$host'], ['erp.example.com;return'], ['erp.example.com\nDUMMY_SECRET'],
    ['https://erp.example.com'], ['erp.example.com:3000'], ['erp.example.com/path'], ['ERP.example.com'],
    ['erp.example.com.'], ['erp_test.example.com'], ['127.0.0.1'], ['localhost'],
    ['auth.example.com'], ['notexample.com'], ['example.com.attacker.test'], ['attacker.test'],
    null, 'erp.example.com', Array(101).fill('erp.example.com'),
  ].map(appAliases => [appAliases]))('invalid app aliases fail with redacted diagnostics', appAliases => {
    try {
      resolvePlatformConfig({ ...minimal, ingress: { appAliases } })
      throw new Error('missing validation')
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformConfigError)
      expect(String(error)).not.toContain('DUMMY_SECRET')
    }
  })
  test('alias ownership follows the selected cookie domain and cannot hide malformed inputs', () => {
    expect(() => resolvePlatformConfig({ ...minimal,
      origins: { app: 'https://app.team.example.com', auth: 'https://auth.team.example.com' },
      auth: { cookie: { domain: 'team.example.com' } }, ingress: { appAliases: ['erp.example.com'] },
    })).toThrow('shared cookie domain')
    expect(() => resolvePlatformConfig({ ...minimal, ingress: { appAliases: ['*.example.com'] } }, { ingress: { appAliases: [] } })).toThrow(PlatformConfigError)
  })
  test.each([
    true, {}, { google: null }, { google: false }, { github: {} },
    { google: { id: '../google' } }, { google: { id: 'google%2fother' } },
    { google: { scopes: [] } }, { google: { scopes: ['profile'] } }, { google: { scopes: ['email profile'] } },
    { google: { clientId: 'DUMMY_SECRET' } }, { google: { client_secret: 'DUMMY_SECRET' } },
    { google: { mapper: false } }, { google: { mapper: { path: '../secret.jsonnet' } } },
    { google: { mapper: { path: '/secret.jsonnet' } } }, { google: { mapper: { path: 'google.json' } } },
    { google: { mapper: {} } }, { google: { mapper: { path: 'google.jsonnet', secret: 'DUMMY_SECRET' } } },
  ])('invalid or credential-bearing OIDC input fails with redacted diagnostics', oidc => {
    try {
      resolvePlatformConfig({ ...minimal, auth: { oidc } })
      throw new Error('missing validation')
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformConfigError)
      expect(String(error)).not.toContain('DUMMY_SECRET')
    }
  })
  test('disabling OIDC cannot hide malformed lower-layer input', () => {
    expect(() => resolvePlatformConfig({ ...minimal, auth: { oidc: { google: { mapper: { path: '../private.jsonnet' } } } } }, { auth: { oidc: false } })).toThrow(PlatformConfigError)
  })
  test.each([
    { authHeader: 'X-Key\r\nAuthorization' }, { authHeader: 'Content-Type' }, { authHeader: 'X-' },
    { authHeader: 'X-' + 'a'.repeat(127) }, { session: true }, { session: 'first' },
    { body: 'arbitrary-template' }, { body: { path: '../secret.jsonnet' } },
    { body: { path: '/secret.jsonnet' } }, { body: { path: 'hooks/../secret.jsonnet' } },
    { body: { path: 'hooks//body.jsonnet' } }, { body: { path: 'body.json' } }, { body: {} },
    { body: { path: 'body.jsonnet', value: 'DUMMY_SECRET' } }, { authValue: 'DUMMY_SECRET' },
  ])('invalid hook input is rejected without exposing values', extra => {
    try {
      resolvePlatformConfig({ ...minimal, auth: { registrationHook: { path: '/hook', ...extra } } })
      throw new Error('missing validation')
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformConfigError)
      expect(String(error)).not.toContain('DUMMY_SECRET')
    }
  })
  for (const key of ['honoAdditionalOrigins', 'kratosAdditionalOrigins'] as const) {
    test(`${key} rejects invalid origins and redacts values`, () => {
      for (const origins of [null, 'https://www.example.com', ['*'], ['https://example.com/path'], ['https://user:DUMMY_SECRET@example.com'], ['http://example.com']]) {
        try {
          resolvePlatformConfig({ ...minimal, cors: { [key]: origins } })
          throw new Error('missing validation')
        } catch (error) {
          expect(error).toBeInstanceOf(PlatformConfigError)
          expect((error as PlatformConfigError).issues[0].path).toContain(`cors.${key}`)
          expect(String(error)).not.toContain('DUMMY_SECRET')
        }
      }
      expect(() => resolvePlatformConfig({ ...minimal, cors: { [key]: ['https://example.com/path'] } }, { cors: { [key]: [] } })).toThrow(PlatformConfigError)
    })
  }
  const invalid: Array<[string, unknown]> = [
    ['missing required input', {}],
    ['unknown version', { ...minimal, defaultsVersion: 'latest' }],
    ['unknown nested key', { ...minimal, services: { backend: { ports: 8080 } } }],
    ['independently configured conflicting port', { ...minimal, nginx: { backendPort: 8080 } }],
    ['null is not an omission', { ...minimal, auth: null }],
    ['port coercion', { ...minimal, services: { backend: { port: '3000' } } }],
    ['zero port', { ...minimal, services: { backend: { port: 0 } } }],
    ['non-finite port', { ...minimal, services: { backend: { port: Infinity } } }],
    ['duplicate aliases', { ...minimal, services: { frontend: { name: 'hono-server' } } }],
    ['public/admin port conflict', { ...minimal, services: { kratos: { adminPort: 4433 } } }],
    ['origin with path', { ...minimal, origins: { auth: 'https://auth.example.com/auth/' } }],
    ['origin with credentials', { ...minimal, origins: { app: 'https://user:secret@example.com' } }],
    ['origin with fragment', { ...minimal, origins: { app: 'https://app.example.com/#secret' } }],
    ['origin with a backslash', { ...minimal, origins: { app: 'https://app.example.com\\' } }],
    ['same origin without routing support', { ...minimal, origins: { auth: 'https://app.example.com' } }],
    ['insecure production origin', { ...minimal, origins: { app: 'http://app.example.com' } }],
    ['insecure production CORS', { ...minimal, cors: { additionalOrigins: ['http://local.example.com'] } }],
    ['unrelated cookie domain', { ...minimal, auth: { cookie: { domain: 'other.test' } } }],
    ['cookie domain too broad', { ...minimal, baseDomain: 'project.example.com', auth: { cookie: { domain: 'example.com' } } }],
    ['cookie only covers auth', { ...minimal, auth: { cookie: { domain: 'auth.example.com' } } }],
    ['origins outside shared cookie domain', { ...minimal, origins: { app: 'https://other.test' } }],
    ['insecure production cookie', { ...minimal, auth: { cookie: { secure: false } } }],
    ['SameSite None insecure cookie', { ...minimal, environment: 'development', auth: { cookie: { sameSite: 'None', secure: false } } }],
    ['secure cookie on HTTP', { ...minimal, environment: 'development', origins: { auth: 'http://auth.example.com' } }],
    ['cookie path misses whoami', { ...minimal, auth: { cookie: { path: '/auth' } } }],
    ['host-prefixed shared cookie', { ...minimal, auth: { cookie: { name: '__Host-session' } } }],
    ['UI redirect off-site', { ...minimal, auth: { ui: { login: '//attacker.test/login' } } }],
    ['UI dot segments', { ...minimal, auth: { ui: { login: '/a/../login' } } }],
    ['UI origin outside shared cookie domain', { ...minimal, auth: { uiOrigin: 'https://attacker.test' } }],
    ['UI origin with a path', { ...minimal, auth: { uiOrigin: 'https://ui.example.com/login' } }],
    ['UI conflicts with auth endpoint', { ...minimal, auth: { uiOrigin: 'https://auth.example.com/' } }],
    ['HTTP UI in production', { ...minimal, auth: { uiOrigin: 'http://local.example.com:3000' } }],
    ['HTTP return in production', { ...minimal, auth: { defaultBrowserReturnUrl: 'http://app.example.com/' } }],
    ['return host outside shared cookie domain', { ...minimal, auth: { defaultBrowserReturnUrl: 'https://attacker.test/' } }],
    ['return has credentials', { ...minimal, auth: { defaultBrowserReturnUrl: 'https://user:password@app.example.com/' } }],
    ['return relative URL', { ...minimal, auth: { defaultBrowserReturnUrl: '/home' } }],
    ['return protocol-relative URL', { ...minimal, auth: { defaultBrowserReturnUrl: '//app.example.com/' } }],
    ['return query', { ...minimal, auth: { defaultBrowserReturnUrl: 'https://app.example.com/?next=https://other.test' } }],
    ['return fragment', { ...minimal, auth: { defaultBrowserReturnUrl: 'https://app.example.com/#home' } }],
    ['return dot segments', { ...minimal, auth: { defaultBrowserReturnUrl: 'https://app.example.com/a/../home' } }],
    ['return encoded path', { ...minimal, auth: { defaultBrowserReturnUrl: 'https://app.example.com/%2f%2fother.test' } }],
    ['hook requires path', { ...minimal, auth: { registrationHook: {} } }],
    ['schema traversal', { ...minimal, auth: { identitySchemas: [{ id: 'default', path: '../private.json' }] } }],
    ['schema absolute path', { ...minimal, auth: { identitySchemas: [{ id: 'default', path: '/tmp/schema.json' }] } }],
    ['empty schema set', { ...minimal, auth: { identitySchemas: [] } }],
    ['duplicate schema IDs', { ...minimal, auth: { identitySchemas: [{ id: 'default', path: 'a.json' }, { id: 'default', path: 'b.json' }] } }],
    ['unknown default schema', { ...minimal, auth: { defaultSchemaId: 'unknown' } }],
    ['invalid lower-priority input still rejected', { ...minimal, services: { backend: { port: -1 } } }],
  ]
  for (const [name, input] of invalid) test(name, () => {
    expect(() => resolvePlatformConfig(input)).toThrow(PlatformConfigError)
  })

  test('does not echo invalid values or unknown key contents', () => {
    for (const input of [
      { ...minimal, 'SECRET-MARKER': true },
      { ...minimal, origins: { auth: 'https://user:SECRET-MARKER@auth.example.com' } },
      { ...minimal, auth: { defaultBrowserReturnUrl: 'https://user:SECRET-MARKER@app.example.com' } },
      { ...minimal, auth: { identitySchemas: [{ id: 'default', path: '/SECRET-MARKER' }] } },
    ]) {
      try { resolvePlatformConfig(input); throw new Error('Expected validation failure') } catch (error) {
        expect(error).toBeInstanceOf(PlatformConfigError)
        expect(String(error)).not.toContain('SECRET-MARKER')
        expect(JSON.stringify(error)).not.toContain('SECRET-MARKER')
      }
    }
  })

  test('validates override keys before merge and cannot hide invalid base settings', () => {
    expect(() => resolvePlatformConfig(minimal, { secret: 'not-allowed' })).toThrow(PlatformConfigError)
    expect(() => resolvePlatformConfig({ ...minimal, services: { backend: { port: -1 } } }, { services: { backend: { port: 3000 } } })).toThrow(PlatformConfigError)
    expect(() => resolvePlatformConfig({ ...minimal, auth: { defaultBrowserReturnUrl: '//invalid.test' } }, { auth: { defaultBrowserReturnUrl: 'https://app.example.com' } })).toThrow(PlatformConfigError)
    expect(() => resolvePlatformConfig(minimal, JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow(PlatformConfigError)
    expect(Object.hasOwn({}, 'polluted')).toBe(false)
  })
})
