import { describe, expect, test } from 'bun:test'
import { createS3CompatibleStorage, createTenantS3CompatibleStorage, readS3CompatibleStorageConfig } from './index'
const config = { provider: 'r2' as const, accountId: 'a'.repeat(32), bucket: 'test-images', credentials: { accessKeyId: 'test-access', secretAccessKey: 'test-secret' } }
describe('S3-compatible server factory', () => {
  test('validates endpoint/account before requesting secrets', async () => {
    let reads = 0
    const credentials = () => { reads++; return config.credentials }
    await expect(createS3CompatibleStorage({ ...config, credentials, accountId: 'bad' })).rejects.toThrow('account')
    await expect(createS3CompatibleStorage({ ...config, credentials, endpoint: 'http://example.com' })).rejects.toThrow('endpoint')
    expect(reads).toBe(0)
  })
  test('signs R2 URLs and rejects unsigned/public requests without network', async () => {
    const storage = await createS3CompatibleStorage(config)
    const url = new URL(await storage.getUrl('sample/image.png'))
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300')
    expect(url.searchParams.has('X-Amz-Signature')).toBe(true)
    expect(url.hostname).toContain(config.accountId)
    await expect(storage.getUrl('sample/image.png', { signed: false })).rejects.toThrow('policy')
    await expect(storage.getUrl('sample/image.png', { expiresIn: 301 })).rejects.toThrow('policy')
    await expect(storage.upload('sample/image.png', 'data', { public: true })).rejects.toThrow('Public')
  })
  test('delegates generic S3 signing and custom endpoint', async () => {
    const storage = await createS3CompatibleStorage({ provider: 's3', bucket: 'test-images', region: 'test-region', endpoint: 'https://s3.example.com', credentials: config.credentials })
    const url = new URL(await storage.getUrl('image.png'))
    expect(url.hostname).toBe('s3.example.com')
    expect(url.pathname).toBe('/test-images/image.png')
    expect(url.searchParams.has('X-Amz-Signature')).toBe(true)
  })
  test('requires live authorization and scopes signed keys', async () => {
    let allow = true
    const storage = await createTenantS3CompatibleStorage(config, { tenantId: 'tenant-a', pluginId: 'sop', authorize: () => allow })
    const url = new URL(await storage.getUrl('image.png'))
    expect(decodeURIComponent(url.pathname)).toContain('tenants/tenant-a/plugins/sop/image.png')
    allow = false
    await expect(storage.getUrl('image.png')).rejects.toThrow('denied')
    await expect(storage.getUrl('../image.png')).rejects.toThrow('key')
  })
  test('reads environment configuration fail-closed', () => {
    expect(readS3CompatibleStorageConfig({})).toBeNull()
    expect(() => readS3CompatibleStorageConfig({ EAOS_STORAGE_PROVIDER: 'r2', R2_ACCOUNT_ID: 'a'.repeat(32) })).toThrow('Incomplete R2')
    const r2 = readS3CompatibleStorageConfig({
      EAOS_STORAGE_PROVIDER: 'r2', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'test-images',
      R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret', EAOS_STORAGE_MAX_URL_SECONDS: '120',
    })
    expect(r2?.provider).toBe('r2')
    expect(r2?.maxUrlLifetimeSeconds).toBe(120)
    const s3 = readS3CompatibleStorageConfig({
      EAOS_STORAGE_PROVIDER: 's3', S3_BUCKET: 'test-images', S3_REGION: 'ap-northeast-1',
      S3_ENDPOINT: 'https://s3.example.com', S3_ACCESS_KEY_ID: 'id', S3_SECRET_ACCESS_KEY: 'secret', S3_FORCE_PATH_STYLE: 'true',
    })
    expect(s3?.provider).toBe('s3')
    if (s3?.provider === 's3') expect(s3.forcePathStyle).toBe(true)
  })
  test('executes SigV4 signed HTTP operations without AWS SDK peers', async () => {
    const originalFetch = globalThis.fetch
    const calls: { method: string; url: string; auth: string | null }[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      calls.push({ method: init?.method ?? 'GET', url, auth: headers.get('authorization') })
      if (init?.method === 'PUT') return new Response('', { status: 200, headers: { etag: '"etag-1"' } })
      if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': '5', 'content-type': 'text/plain', 'last-modified': 'Wed, 01 Oct 2026 00:00:00 GMT' } })
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      if (url.includes('list-type=2')) {
        return new Response('<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>tenants/tenant-a/plugins/sop/note.txt</Key><Size>5</Size><LastModified>2026-10-01T00:00:00.000Z</LastModified></Contents></ListBucketResult>', { status: 200 })
      }
      return new Response('hello', { status: 200 })
    }) as typeof fetch
    try {
      const storage = await createTenantS3CompatibleStorage(config, { tenantId: 'tenant-a', pluginId: 'sop', authorize: () => true })
      const uploaded = await storage.upload('note.txt', 'hello', { contentType: 'text/plain' })
      expect(uploaded.key).toBe('note.txt')
      const downloaded = await storage.download('note.txt')
      expect(downloaded).toBeInstanceOf(Uint8Array)
      expect(new TextDecoder().decode(downloaded!)).toBe('hello')
      expect(await storage.exists('note.txt')).toBe(true)
      const listed = await storage.list({ prefix: '' })
      expect(listed.objects.map(o => o.key)).toEqual(['note.txt'])
      await storage.delete('note.txt')
      expect(calls.every(call => call.auth?.startsWith('AWS4-HMAC-SHA256 '))).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
