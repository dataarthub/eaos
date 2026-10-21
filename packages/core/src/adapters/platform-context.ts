/**
 * PlatformContext - Unified platform context for EAOS.
 *
 * Bundles all adapters (DB, storage, content, events, secrets) into a single
 * context object that can be passed to routes, plugins, and MCP tool handlers.
 *
 * @module adapters/platform-context
 */

import type { DataAccessAdapter, StorageAdapter, ContentAdapter } from './types'
import type { AIHostAdapters } from '../ai/host-adapters'
import { createDomainEventBus, type DomainEventBus } from '../plugin-sdk/event-bus'
import { SecretResolver } from '../secrets/secret-resolver'

/**
 * Unified platform context.
 * Passed to route handlers, plugin services, and MCP tool handlers.
 * @see {@link createPlatformContext}
 */
export interface PlatformContext {
  /** Database adapter (Oracle, Supabase, Neon, etc.) */
  db: DataAccessAdapter;
  /** Object storage adapter (R2, S3, Local, etc.) */
  storage: StorageAdapter;
  /** Content adapter for SSG (Git + Markdown, optional) */
  content?: ContentAdapter;
  /** Domain event bus for pub/sub */
  events: DomainEventBus;
  /** Secret resolver for credentials */
  secrets: SecretResolver;
  /** Current tenant ID */
  tenantId?: string;
  /** Current user ID */
  userId?: string;
  /** Host-scoped external AI providers; credentials and implementations remain host-owned. */
  aiHostAdapters?: AIHostAdapters;
  
  /** Optional plugin service container populated by the host; createPlatformContext does not initialize this field. */
  services?: Record<string, any>;
}

/**
 * Configuration for creating a PlatformContext.
 * @see {@link createPlatformContext}
 */
export interface PlatformContextConfig {
  /** Database adapter instance */
  db: DataAccessAdapter;
  /** Storage adapter instance */
  storage: StorageAdapter;
  /** Content adapter instance (optional) */
  content?: ContentAdapter;
  /** Domain event bus (optional, creates a context-local bus if omitted) */
  events?: DomainEventBus;
  /** Secret resolver override; omission uses the static SecretResolver class and its shared cache. */
  secrets?: SecretResolver;
  /** Current tenant ID */
  tenantId?: string;
  /** Current user ID */
  userId?: string;
  /** Already-scoped Host adapters for calendar, email, workspace, travel, browser, messaging or workflow operations. */
  aiHostAdapters?: AIHostAdapters;
}

/**
 * Group host adapters and optional identity into a fresh platform context.
 * @param config - Connected host database/storage and optional content, events, secrets, identity and AI adapters. Omitted events creates a fresh bus; omitted secrets uses the static SecretResolver class.
 * @returns A new context referencing the supplied adapters; no services container is initialized and no adapter is cloned.
 * @remarks Does not connect, authenticate, scope, authorize or dispose adapters. The host owns their lifecycle and must establish tenant/user trust before exposing capabilities.
 * @example
 * ```typescript
 * import { createPlatformContext } from "@alneas/eaos-core/adapters/platform-context";
 * import type { DataAccessAdapter, StorageAdapter } from "@alneas/eaos-core/adapters/types";
 * function createHostContext(db: DataAccessAdapter, storage: StorageAdapter) {
 *  return createPlatformContext({ db, storage, tenantId: "tenant-demo", userId: "user-demo" });
 * }
 * ```
 */
export function createPlatformContext(config: PlatformContextConfig): PlatformContext {
  const events = config.events ?? createDomainEventBus();
  const secrets = config.secrets ?? SecretResolver;

  return {
    db: config.db,
    storage: config.storage,
    content: config.content,
    events,
    secrets,
    tenantId: config.tenantId,
    userId: config.userId,
    aiHostAdapters: config.aiHostAdapters,
  };
}
