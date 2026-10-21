/**
 * @fileoverview Platform Adapters
 *
 * Core adapters (DataAccessAdapter, StorageAdapter, ContentAdapter) and platform-specific
 * decorators (TenantAwareAdapter, PlatformContext).
 */

export type {
  DataAccessAdapter,
  Filter,
  QueryOptions,
  PopulateOptions,
  OperationResult,
  StorageAdapter,
  StorageObject,
  ContentAdapter,
  ContentItem,
  ContentFilter,
} from './types'

// Platform-specific adapters
export { TenantAwareAdapter } from './tenant-adapter'
export type { TenantAwareAdapterConfig } from './tenant-adapter'

export { createPlatformContext } from './platform-context'
export type { PlatformContext, PlatformContextConfig } from './platform-context'
