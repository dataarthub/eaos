import type { StorageAdapter, R2StorageConfig, S3StorageConfig } from '@alneas/appkit-core/storage'
import { createTenantStorage, type TenantStorageOptions } from './index'

/**
 * Server-held signing credentials; never expose these through browser configuration.
 * @see createS3CompatibleStorage for host setup.
 */
export interface StorageCredentials {
  /** Nonempty access key identifier for the selected provider. */
  accessKeyId: string
  /** Nonempty secret used for request signing. */
  secretAccessKey: string
}
type Credentials = StorageCredentials | (() => StorageCredentials | Promise<StorageCredentials>)
type Common = {
  /** Server-held credentials or a callback invoked once when constructing the adapter; callback errors reject creation. */
  credentials: Credentials
  /** Signed URL lifetime ceiling in whole seconds, from 1 to 604800. @defaultValue 300 */
  maxUrlLifetimeSeconds?: number
}
/**
 * Selects R2 or S3 transport settings with host-held credentials and a signed URL ceiling.
 * @remarks R2 requires a 32-hex-character accountId; S3 requires region. Both require a valid bucket name. Optional endpoints must be HTTPS URLs without credentials, query, or fragment. Provider-specific fields follow app-core storage configuration; public URLs are not configured by this factory.
 * @see createS3CompatibleStorage for a complete setup example.
 */
export type S3CompatibleStorageConfig = Common & (
  | ({ 
  /**
   * Select Cloudflare R2 transport; accountId must be 32 hexadecimal characters and bucket/credentials must be configured.
   */
  provider: 'r2' } & Omit<R2StorageConfig, 'accessKeyId' | 'secretAccessKey' | 'publicUrl' | 'defaultExpiresIn'>)
  | ({ 
  /**
   * Select S3-compatible transport; a nonempty region and valid bucket/credentials are required, with optional HTTPS endpoint.
   */
  provider: 's3' } & Omit<S3StorageConfig, 'accessKeyId' | 'secretAccessKey' | 'defaultExpiresIn'>)
)

/**
 * Creates an unscoped private-upload, signed-URL storage adapter for R2 or S3.
 * @param config - Provider configuration, credentials, and URL ceiling; see {@link S3CompatibleStorageConfig}.
 * @returns A frozen app-core adapter whose uploads reject public=true and whose URLs always use signatures within the configured ceiling.
 * @throws Rejects invalid provider, lifetime, bucket, account/region, endpoint, or empty credentials, and propagates credential callback/import/adapter construction errors. Subsequent operations propagate transport errors.
 * @remarks Server-only: transport/signing stay in app-core and the host supplies secrets. Credentials are resolved once at construction. Signed access also works during a public-bucket migration but cannot close existing public URLs. Keep this unscoped adapter host-owned; give plugins createTenantS3CompatibleStorage. Constructing an adapter does not verify remote credentials or create a bucket.
 * @example
 * ```typescript
 * import { createS3CompatibleStorage, readS3CompatibleStorageConfig } from "@alneas/eaos-server/storage/s3-compatible";
 * // The host provisions a private bucket and supplies the documented storage environment.
 * const config = readS3CompatibleStorageConfig();
 * if (!config) throw new Error("Storage is not configured");
 * const storage = await createS3CompatibleStorage(config);
 * // Retain storage in trusted server code; authorize requests before performing operations.
 * ```
 */
export async function createS3CompatibleStorage(config: S3CompatibleStorageConfig): Promise<StorageAdapter> {
  if (!['s3', 'r2'].includes(config.provider)) throw new Error('Unsupported storage provider')
  const maxAge = config.maxUrlLifetimeSeconds ?? 300
  if (!Number.isInteger(maxAge) || maxAge < 1 || maxAge > 604800) throw new Error('Invalid URL lifetime')
  if (!config.bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)) throw new Error('Invalid storage bucket')
  if (config.provider === 'r2' && !/^[a-f0-9]{32}$/i.test(config.accountId)) throw new Error('Invalid R2 account ID')
  if (config.provider === 's3' && !config.region) throw new Error('Storage region required')
  if (config.endpoint) {
    const endpoint = new URL(config.endpoint)
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid storage endpoint')
  }
  const credentials = typeof config.credentials === 'function' ? await config.credentials() : config.credentials
  if (!credentials.accessKeyId || !credentials.secretAccessKey) throw new Error('Storage credentials required')
  const { provider, credentials: _credentials, maxUrlLifetimeSeconds: _maxAge, ...settings } = config
  // Lazy import keeps SDK peers out of callers using only the policy wrapper.
  const { R2StorageAdapter, S3StorageAdapter } = await import('@alneas/appkit-core/storage')
  const adapter: StorageAdapter = provider === 'r2'
    ? new R2StorageAdapter({ ...settings, ...credentials, defaultExpiresIn: maxAge } as R2StorageConfig)
    : new S3StorageAdapter({ ...settings, ...credentials, defaultExpiresIn: maxAge } as S3StorageConfig)
  return Object.freeze({
    async upload(key, data, options) {
      if (options?.public) throw new Error('Public storage uploads are disabled')
      return adapter.upload(key, data, { ...options, public: false })
    },
    download: adapter.download.bind(adapter), delete: adapter.delete.bind(adapter),
    exists: adapter.exists.bind(adapter), head: adapter.head.bind(adapter), list: adapter.list.bind(adapter),
    async getUrl(key, options) {
      const expiresIn = options?.expiresIn ?? maxAge
      if (options?.signed === false || !Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > maxAge) throw new Error('Signed URL policy violation')
      return adapter.getUrl(key, { ...options, signed: true, expiresIn })
    },
    ...(adapter.copy ? { copy: adapter.copy.bind(adapter) } : {}),
    ...(adapter.move ? { move: adapter.move.bind(adapter) } : {}),
  } satisfies StorageAdapter)
}

/**
 * Creates provider-backed storage isolated to a verified tenant/plugin scope.
 * @param config - Host provider configuration and credentials.
 * @param options - Trusted scope and live authorization; an omitted scope URL ceiling inherits config.maxUrlLifetimeSeconds, then 300.
 * @returns A frozen scoped adapter; see {@link createTenantStorage} for relative key and operation policy.
 * @throws Rejects provider construction failures and invalid scope settings; operations propagate authorization, policy, and transport errors.
 * @remarks The provider ceiling also applies, so a larger scope ceiling cannot increase it. The host owns bucket provisioning and verified identity resolution.
 * @example
 * ```typescript
 * import { createTenantS3CompatibleStorage, type S3CompatibleStorageConfig } from "@alneas/eaos-server/storage/s3-compatible";
 * import type { TenantStorageOptions } from "@alneas/eaos-server/storage";
 * export async function scopedStorage(config: S3CompatibleStorageConfig, trustedOptions: TenantStorageOptions) {
 *   return createTenantS3CompatibleStorage(config, trustedOptions);
 * }
 * ```
 */
export async function createTenantS3CompatibleStorage(config: S3CompatibleStorageConfig, options: TenantStorageOptions): Promise<StorageAdapter> {
  const adapter = await createS3CompatibleStorage(config)
  return createTenantStorage(adapter, { ...options, maxUrlLifetimeSeconds: options.maxUrlLifetimeSeconds ?? config.maxUrlLifetimeSeconds })
}

/**
 * Reads trimmed S3 or R2 configuration from a host environment map.
 * @param env - Environment values; defaults to process.env. EAOS_STORAGE_PROVIDER selects s3/r2 case-insensitively. R2 uses R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and optional R2_ENDPOINT. S3 uses S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, optional S3_ENDPOINT, and S3_FORCE_PATH_STYLE (true or 1). EAOS_STORAGE_MAX_URL_SECONDS is converted with Number.
 * @returns Configuration, or null when the provider is absent/blank. This read does not fully validate values; creation validates provider settings.
 * @throws If a selected provider lacks required nonblank values, or the provider is unsupported.
 * @remarks Returned configuration contains secrets and belongs exclusively in trusted server code.
 * @example
 * ```typescript
 * import { readS3CompatibleStorageConfig } from "@alneas/eaos-server/storage/s3-compatible";
 * const config = readS3CompatibleStorageConfig();
 * console.log(config ? "Storage configured" : "Storage disabled");
 * ```
 */
export function readS3CompatibleStorageConfig(env: Record<string, string | undefined> = process.env): S3CompatibleStorageConfig | null {
  const provider = env.EAOS_STORAGE_PROVIDER?.trim().toLowerCase()
  if (!provider) return null
  const maxAge = env.EAOS_STORAGE_MAX_URL_SECONDS ? Number(env.EAOS_STORAGE_MAX_URL_SECONDS) : undefined
  if (provider === 'r2') {
    const accountId = env.R2_ACCOUNT_ID?.trim() ?? '', bucket = env.R2_BUCKET?.trim() ?? ''
    const accessKeyId = env.R2_ACCESS_KEY_ID?.trim() ?? '', secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim() ?? ''
    if (!accountId || !bucket || !accessKeyId || !secretAccessKey) throw new Error('Incomplete R2 storage environment')
    return {
      provider: 'r2', accountId, bucket,
      ...(env.R2_ENDPOINT ? { endpoint: env.R2_ENDPOINT.trim() } : {}),
      ...(maxAge !== undefined ? { maxUrlLifetimeSeconds: maxAge } : {}),
      credentials: { accessKeyId, secretAccessKey },
    }
  }
  if (provider === 's3') {
    const bucket = env.S3_BUCKET?.trim() ?? '', region = env.S3_REGION?.trim() ?? ''
    const accessKeyId = env.S3_ACCESS_KEY_ID?.trim() ?? '', secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim() ?? ''
    if (!bucket || !region || !accessKeyId || !secretAccessKey) throw new Error('Incomplete S3 storage environment')
    return {
      provider: 's3', bucket, region,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT.trim() } : {}),
      ...(env.S3_FORCE_PATH_STYLE === 'true' || env.S3_FORCE_PATH_STYLE === '1' ? { forcePathStyle: true } : {}),
      ...(maxAge !== undefined ? { maxUrlLifetimeSeconds: maxAge } : {}),
      credentials: { accessKeyId, secretAccessKey },
    }
  }
  throw new Error('Unsupported storage provider')
}
