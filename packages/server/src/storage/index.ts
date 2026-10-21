export { createS3CompatibleStorage, createTenantS3CompatibleStorage, readS3CompatibleStorageConfig, type S3CompatibleStorageConfig, type StorageCredentials } from './s3-compatible'
import type { StorageAdapter, StorageObject, StorageListOptions, StorageListResult, StorageUploadOptions, StorageURLOptions } from '@alneas/appkit-core/storage'
export type { StorageAdapter } from '@alneas/appkit-core/storage'
/**
 * Operation names passed to the host authorization callback before scoped storage access.
 * @see createTenantStorage for a complete usage example.
 */
export type StorageOperation = 'upload' | 'download' | 'delete' | 'exists' | 'head' | 'list' | 'getUrl' | 'copy' | 'move'
/**
 * Trusted tenant/plugin scope and per-operation authorization for {@link createTenantStorage}.
 */
export interface TenantStorageOptions {
  /** Trusted tenant ID: 1–128 ASCII letters, digits, underscores, or hyphens, starting alphanumeric. It must come from verified server identity/configuration, never request body keys. */
  tenantId: string
  /** Trusted plugin ID: 1–128 ASCII letters, digits, underscores, or hyphens, starting with a letter or digit. */
  pluginId: string
  /** Invoked before each operation with trusted scope, operation, and frozen relative keys (list receives its prefix); only exactly true allows access. Errors propagate. */
  authorize: (request: {
  /**
   * Trusted tenant scope captured at adapter construction, independent of caller object keys.
   */
  tenantId: string;
  /**
   * Trusted plugin scope captured at adapter construction.
   */
  pluginId: string;
  /**
   * Storage operation about to be delegated to the provider.
   */
  operation: StorageOperation;
  /**
   * Frozen relative-key array; copy/move supplies source then destination, and list supplies its requested prefix.
   */
  keys: readonly string[] }) => boolean | Promise<boolean>
  /** Signed URLs remain usable until expiry; default ceiling 300 seconds. */
  maxUrlLifetimeSeconds?: number
}
function segment(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw new Error('Invalid storage scope ID')
  return value
}
function path(value: string, prefix = false): string {
  // eslint-disable-next-line no-control-regex -- Reject ASCII control characters in untrusted identifiers/paths.
  if (typeof value !== 'string' || (!prefix && !value) || /[\\%\x00-\x1f\x7f?#]/.test(value) || value.startsWith('/')) throw new Error('Invalid storage key')
  const parts = value.split('/')
  if (prefix && parts.at(-1) === '') parts.pop()
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Invalid storage key')
  return value
}
/**
 * Wraps a storage adapter with tenant/plugin key isolation and per-operation authorization.
 * @param adapter - Host-owned transport/signing adapter; optional copy and move are exposed only when supported.
 * @param options - Trusted scope, authorization callback, and signed URL ceiling; see {@link TenantStorageOptions}.
 * @returns A frozen adapter using relative keys while storing under tenants/{tenantId}/plugins/{pluginId}/; returned object keys and list cursors are scope-relative.
 * @throws Throws synchronously for invalid scope IDs or URL lifetime. Operations reject for invalid relative keys, denied access, public uploads, unsigned or overlong URLs, invalid cursors/delimiters, out-of-scope provider results, or propagated adapter/authorization errors.
 * @remarks Keys cannot be absolute or contain traversal, empty segments, backslashes, percent escapes, control characters, query strings, or fragments. List permits an empty prefix and slash delimiter only. URLs default to a 300-second ceiling and remain usable until expiry after authorization changes. This wrapper supplies no persistence, locking, revocation, or transaction mechanism beyond the underlying adapter. The host must retain ownership of the unscoped adapter.
 * @example
 * ```typescript
 * import { createTenantStorage, type StorageAdapter, type TenantStorageOptions } from "@alneas/eaos-server/storage";
 * export function pluginStorage(adapter: StorageAdapter, trustedOptions: TenantStorageOptions) {
 *   // Resolve scope and authorization from verified host identity, never request body IDs.
 *   return createTenantStorage(adapter, trustedOptions);
 * }
 * ```
 */
export function createTenantStorage(adapter: StorageAdapter, options: TenantStorageOptions): StorageAdapter {
  const tenantId = segment(options.tenantId), pluginId = segment(options.pluginId)
  const scope = `tenants/${tenantId}/plugins/${pluginId}/`
  const authorize = options.authorize
  const maxAge = options.maxUrlLifetimeSeconds ?? 300
  if (!Number.isInteger(maxAge) || maxAge < 1) throw new Error('Invalid URL lifetime')
  async function check(operation: StorageOperation, keys: string[]) {
    if (await authorize({ tenantId, pluginId, operation, keys: Object.freeze([...keys]) }) !== true) throw new Error('Storage access denied')
  }
  function relative(key: string, prefix = false): string {
    if (!key.startsWith(scope)) throw new Error('Storage returned an object outside the authorized scope')
    return path(key.slice(scope.length), prefix)
  }
  function object(value: StorageObject): StorageObject { return { ...value, key: relative(value.key) } }
  function exact(value: StorageObject, key: string): StorageObject {
    const result = object(value)
    if (result.key !== key) throw new Error('Storage returned an unexpected object')
    return result
  }
  return Object.freeze({
    async upload(key: string, data: Parameters<StorageAdapter['upload']>[1], settings?: StorageUploadOptions) {
      key = path(key)
      if (settings?.public) throw new Error('Public tenant objects are disabled')
      const safe = { ...settings, public: false }
      await check('upload', [key])
      return exact(await adapter.upload(scope + key, data, safe), key)
    },
    async download(key: string) { key = path(key); await check('download', [key]); return adapter.download(scope + key) },
    async delete(key: string) { key = path(key); await check('delete', [key]); return adapter.delete(scope + key) },
    async exists(key: string) { key = path(key); await check('exists', [key]); return adapter.exists(scope + key) },
    async head(key: string) {
      key = path(key); await check('head', [key])
      const result = await adapter.head(scope + key)
      return result ? exact(result, key) : null
    },
    async getUrl(key: string, settings?: StorageURLOptions) {
      key = path(key)
      const expiresIn = settings?.expiresIn ?? maxAge
      if (settings?.signed === false || !Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > maxAge) throw new Error('Signed URL policy violation')
      const safe = { ...settings, signed: true, expiresIn }
      await check('getUrl', [key])
      return adapter.getUrl(scope + key, safe)
    },
    async list(settings: StorageListOptions = {}): Promise<StorageListResult> {
      const prefix = path(settings.prefix ?? '', true)
      if (settings.delimiter !== undefined && settings.delimiter !== '/') throw new Error('Invalid delimiter')
      let cursor: string | undefined
      if (settings.cursor) {
        try {
          const data = JSON.parse(Buffer.from(settings.cursor, 'base64url').toString())
          if (data.scope !== scope || data.prefix !== prefix || typeof data.token !== 'string') throw new Error()
          cursor = data.token
        } catch { throw new Error('Invalid scoped storage cursor') }
      }
      const safe = { ...settings, prefix: scope + prefix, cursor }
      await check('list', [prefix])
      const result = await adapter.list(safe)
      const objects = result.objects.map(object), prefixes = result.prefixes?.map(key => relative(key, true))
      if (objects.some(o => !o.key.startsWith(prefix)) || prefixes?.some(p => !p.startsWith(prefix))) throw new Error('Storage returned objects outside the requested prefix')
      return { objects, prefixes, hasMore: result.hasMore, nextCursor: result.nextCursor ? Buffer.from(JSON.stringify({ scope, prefix, token: result.nextCursor })).toString('base64url') : undefined }
    },
    ...(adapter.copy ? { async copy(source: string, destination: string) {
      source = path(source); destination = path(destination); await check('copy', [source, destination])
      return exact(await adapter.copy!(scope + source, scope + destination), destination)
    } } : {}),
    ...(adapter.move ? { async move(source: string, destination: string) {
      source = path(source); destination = path(destination); await check('move', [source, destination])
      return exact(await adapter.move!(scope + source, scope + destination), destination)
    } } : {}),
  })
}
