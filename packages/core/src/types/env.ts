import type { DataAccessAdapter, StorageAdapter } from '../adapters/types'
import type { DomainEventBus } from '../plugin-sdk/event-bus'
import type { SecretResolver } from '../secrets/secret-resolver'

/**
 * Verified request user identity and optional contact/permission claims.
 * @see {@link createPlatformContext}
 */
export interface EaosUser {
  
  /** Host-verified user identity installed in request variables. */
  id: string
  

  /** Optional contact email from the host identity system; not proof of email verification. */
  email?: string
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** Role claims supplied by the host after identity verification. */
  roles: string[]
  
/** Optional explicit permission names interpreted and enforced by the host. */
  permissions?: string[]
}

/**
 * Host-populated request variables for data, storage, events and secret capabilities.
 * @see {@link createPlatformContext}
 */
export interface EaosVariables {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId?: string
  
/** Optional verified request user installed by host middleware. */
  user?: EaosUser
  
/** Host-owned data-access capability; callers must supply tenant/admission scope where required. */
  db?: DataAccessAdapter
  
/** Host-owned scoped object storage capability; credentials and persistence remain host-owned. */
  storage?: StorageAdapter
  
/** In-memory domain event bus for the host/request context. */
  events?: DomainEventBus
  
  /** Host secret capability or declarations; Core does not provision an external secret store. */
  secrets?: typeof SecretResolver
  [key: string]: any
}

/**
 * Hono-compatible environment wrapper around EAOS request variables.
 * @see {@link createPlatformContext}
 */
export interface EaosEnv {
  
/** Hono-compatible request variable contract populated by host middleware. */
  Variables: EaosVariables
}
