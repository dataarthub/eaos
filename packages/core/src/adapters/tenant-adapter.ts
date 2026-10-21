/**
 * TenantAwareAdapter - Fixed-tenant decoration for selected data-access operations.
 *
 * Injects tenant fields into supported data/filter paths; ID lookups, ID deletes
 * and aggregation still require isolation in the underlying host adapter.
 * Follows the same Decorator pattern as BigNumberDataAccessAdapter in app-core.
 *
 * @module adapters/tenant-adapter
 */

import type { DataAccessAdapter, Filter, QueryOptions, OperationResult } from './types'

/**
 * Configuration for TenantAwareAdapter.
 * @see {@link TenantAwareAdapter}
 */
export interface TenantAwareAdapterConfig {
  /** The tenant ID to inject into all operations */
  tenantId: string;
  /**
   * The field name used for tenant isolation (default: 'tenant_id').
   * For Oracle VPD, this is handled at the DB level and doesn't need injection.
   * For Supabase RLS or non-VPD setups, this field is injected into queries.
   */
  tenantField?: string;
  /**
   * If true, tenant_id is injected into created records but NOT into filters.
   * Useful when VPD/RLS handles filtering at the DB level.
   * Default: false (inject into both filters and creates).
   */
  createOnly?: boolean;
}

/**
 * Decorate selected data operations with a fixed tenant field.
 * @remarks find/count and filter-based writes inject tenant filters unless createOnly is true; create/update/replace inject tenant data. findOne/delete by ID and aggregate delegate without tenant filters. ID-based update/replace do not independently check existing row ownership. The underlying adapter/database must enforce isolation for those paths; this decorator alone is not an authorization boundary.
 *
 * @example
 * ```typescript
 * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
 * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
 * function scopeHostData(base: DataAccessAdapter) {
 *  return new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
 * }
 * ```
 */
export class TenantAwareAdapter implements DataAccessAdapter {
  private base: DataAccessAdapter;
  private tenantId: string;
  private tenantField: string;
  private createOnly: boolean;

  /**
   * Bind an existing host adapter to fixed tenant-injection settings.
   * @param base - Host data-access adapter; caller owns its lifecycle and tenant safety for delegated operations.
   * @param config - Tenant identity and optional tenantField (default tenant_id) and createOnly (default false).
   *
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * function scopeHostData(base: DataAccessAdapter) { return new TenantAwareAdapter(base, { tenantId: "tenant-demo" }); }
   * ```
   */
  constructor(base: DataAccessAdapter, config: TenantAwareAdapterConfig) {
    this.base = base;
    this.tenantId = config.tenantId;
    this.tenantField = config.tenantField ?? 'tenant_id';
    this.createOnly = config.createOnly ?? false;
  }

  // ─── Helper ──────────────────────────────────────────────────

  private withTenantFilter(filter?: Filter): Filter {
    if (this.createOnly) return filter ?? {};
    return { ...filter, [this.tenantField]: this.tenantId };
  }

  private withTenantData(data: Record<string, unknown>): Record<string, unknown> {
    return { ...data, [this.tenantField]: this.tenantId };
  }

  // ─── Read operations ─────────────────────────────────────────

  /**
   * Find records with an injected tenant filter unless createOnly is enabled.
   * @typeParam T - Expected base-adapter record/result type; no runtime shape validation is added and the default is unknown.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param filter - Caller predicate; fixed tenant field overrides a conflicting value unless createOnly is true.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns An array of records resolved by the base adapter; empty when none match.
   * @throws Rejects on base adapter failure.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.find("notes", { archived: false });
   * }
   * ```
   */
  async find<T = unknown>(collection: string, filter?: Filter, options?: QueryOptions): Promise<T[]> {
    return this.base.find<T>(collection, this.withTenantFilter(filter), options);
  }

  /**
   * Delegate an ID lookup without adding a tenant filter.
   * @typeParam T - Expected base-adapter record/result type; no runtime shape validation is added and the default is unknown.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param id - Record identity; this wrapper does not add an ownership predicate for ID-based operations.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns Resolved record or null, according to the base adapter.
   * @throws Rejects on base adapter failure.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.findOne("notes", "note-1");
   * }
   * ```
   */
  async findOne<T = unknown>(collection: string, id: string, options?: QueryOptions): Promise<T | null> {
    return this.base.findOne<T>(collection, id, options);
  }

  /**
   * Count records with an injected tenant filter unless createOnly is enabled.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param filter - Caller predicate; fixed tenant field overrides a conflicting value unless createOnly is true.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The base adapter count.
   * @throws Rejects on base adapter failure.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.count("notes", {});
   * }
   * ```
   */
  async count(collection: string, filter?: Filter, options?: QueryOptions): Promise<number> {
    return this.base.count(collection, this.withTenantFilter(filter), options);
  }

  // ─── Write operations ────────────────────────────────────────

  /**
   * Create a record with the fixed tenant field overriding caller data.
   * @typeParam T - Expected base-adapter record/result type; no runtime shape validation is added and the default is unknown.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param data - Record data; fixed tenant field overwrites caller tenant data before delegation.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The record resolved by the base create operation.
   * @throws Rejects on base adapter failure.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.create("notes", { title: "hello" });
   * }
   * ```
   */
  async create<T = unknown>(collection: string, data: Record<string, unknown>, options?: QueryOptions): Promise<T> {
    return this.base.create<T>(collection, this.withTenantData(data), options);
  }

  /**
   * Delegate an ID update with the fixed tenant field injected into new data.
   * @typeParam T - Expected base-adapter record/result type; no runtime shape validation is added and the default is unknown.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param id - Record identity; this wrapper does not add an ownership predicate for ID-based operations.
   * @param data - Record data; fixed tenant field overwrites caller tenant data before delegation.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The record resolved by the base update operation.
   * @throws Rejects on base adapter failure.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.update("notes", "note-1", { title: "hello" });
   * }
   * ```
   */
  async update<T = unknown>(collection: string, id: string, data: Record<string, unknown>, options?: QueryOptions): Promise<T> {
    return this.base.update<T>(collection, id, this.withTenantData(data), options);
  }

  /**
   * Delegate a supported ID replacement with tenant data injected.
   * @typeParam T - Expected base-adapter record/result type; no runtime shape validation is added and the default is unknown.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param id - Record identity; this wrapper does not add an ownership predicate for ID-based operations.
   * @param data - Record data; fixed tenant field overwrites caller tenant data before delegation.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The record resolved by the base replace operation.
   * @throws Rejects with Error if the base adapter does not support this operation; base adapter failures propagate.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.replace?.("notes", "note-1", { title: "hello" });
   * }
   * ```
   */
  async replace?<T = unknown>(collection: string, id: string, data: Record<string, unknown>, options?: QueryOptions): Promise<T> {
    if (this.base.replace) {
      return this.base.replace<T>(collection, id, this.withTenantData(data), options);
    }
    throw new Error('replace not supported by underlying adapter');
  }

  /**
   * Delegate an ID deletion without adding a tenant filter.
   * @typeParam T - Expected base-adapter record/result type; no runtime shape validation is added and the default is unknown.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param id - Record identity; this wrapper does not add an ownership predicate for ID-based operations.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The base adapter deletion result.
   * @throws Rejects on base adapter failure.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.delete("notes", "note-1");
   * }
   * ```
   */
  async delete<T = unknown>(collection: string, id: string, options?: QueryOptions): Promise<T> {
    return this.base.delete<T>(collection, id, options);
  }

  // ─── Aggregate ───────────────────────────────────────────────

  /**
   * Delegate an aggregation pipeline without injecting tenant constraints.
   * @typeParam T - Expected base-adapter record/result type; no runtime shape validation is added and the default is unknown.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param pipeline - Aggregation stages forwarded unchanged; the host must include/enforce tenant scope.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The base adapter result array.
   * @throws Rejects with Error if the base adapter does not support this operation; base adapter failures propagate.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.aggregate?.("notes", []);
   * }
   * ```
   */
  async aggregate?<T = unknown>(collection: string, pipeline: unknown[], options?: QueryOptions): Promise<T[]> {
    if (this.base.aggregate) {
      return this.base.aggregate<T>(collection, pipeline, options);
    }
    throw new Error('aggregate not supported by underlying adapter');
  }

  // ─── Bulk operations ─────────────────────────────────────────

  /**
   * Create multiple records with the fixed tenant field applied to each.
   * @typeParam T - Expected base-adapter record/result type; no runtime shape validation is added and the default is unknown.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param data - Records copied with the fixed tenant field applied to each.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The records resolved by the base bulk create.
   * @throws Rejects with Error if the base adapter does not support this operation; base adapter failures propagate.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.createMany?.("notes", [{ title: "hello" }]);
   * }
   * ```
   */
  async createMany?<T = unknown>(collection: string, data: Record<string, unknown>[], options?: QueryOptions): Promise<T[]> {
    if (this.base.createMany) {
      return this.base.createMany<T>(collection, data.map(d => this.withTenantData(d)), options);
    }
    throw new Error('createMany not supported by underlying adapter');
  }

  /**
   * Bulk-update using injected tenant filters and tenant data.
   * @typeParam T - Expected base-adapter record/result type; no runtime shape validation is added and the default is unknown.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param filter - Caller predicate; fixed tenant field overrides a conflicting value unless createOnly is true.
   * @param data - Record data; fixed tenant field overwrites caller tenant data before delegation.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The records resolved by the base bulk update.
   * @throws Rejects with Error if the base adapter does not support this operation; base adapter failures propagate.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.updateMany?.("notes", {}, { archived: true });
   * }
   * ```
   */
  async updateMany?<T = unknown>(collection: string, filter: Filter, data: Record<string, unknown>, options?: QueryOptions): Promise<T[]> {
    if (this.base.updateMany) {
      return this.base.updateMany<T>(collection, this.withTenantFilter(filter), this.withTenantData(data), options);
    }
    throw new Error('updateMany not supported by underlying adapter');
  }

  /**
   * Bulk-delete using an injected tenant filter unless createOnly is enabled.
   * @typeParam T - Expected base-adapter record/result type; no runtime shape validation is added and the default is unknown.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param filter - Caller predicate; fixed tenant field overrides a conflicting value unless createOnly is true.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The base adapter bulk deletion results.
   * @throws Rejects with Error if the base adapter does not support this operation; base adapter failures propagate.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.deleteMany?.("notes", {});
   * }
   * ```
   */
  async deleteMany?<T = unknown>(collection: string, filter: Filter, options?: QueryOptions): Promise<T[]> {
    if (this.base.deleteMany) {
      return this.base.deleteMany<T>(collection, this.withTenantFilter(filter), options);
    }
    throw new Error('deleteMany not supported by underlying adapter');
  }

  // ─── MongoDB-style operations ────────────────────────────────

  /**
   * Insert one record with the fixed tenant field overriding caller data.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param data - Record data; fixed tenant field overwrites caller tenant data before delegation.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The base adapter operation-result metadata.
   * @throws Rejects with Error if the base adapter does not support this operation; base adapter failures propagate.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.insertOne?.("notes", { title: "hello" });
   * }
   * ```
   */
  async insertOne?(collection: string, data: Record<string, unknown>, options?: QueryOptions): Promise<OperationResult> {
    if (this.base.insertOne) {
      return this.base.insertOne(collection, this.withTenantData(data), options);
    }
    throw new Error('insertOne not supported by underlying adapter');
  }

  /**
   * Update one match using injected tenant filter and data.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param filter - Caller predicate; fixed tenant field overrides a conflicting value unless createOnly is true.
   * @param data - Record data; fixed tenant field overwrites caller tenant data before delegation.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The base adapter operation-result metadata.
   * @throws Rejects with Error if the base adapter does not support this operation; base adapter failures propagate.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.updateOne?.("notes", { id: "note-1" }, { title: "hello" });
   * }
   * ```
   */
  async updateOne?(collection: string, filter: Filter, data: Record<string, unknown>, options?: QueryOptions): Promise<OperationResult> {
    if (this.base.updateOne) {
      return this.base.updateOne(collection, this.withTenantFilter(filter), this.withTenantData(data), options);
    }
    throw new Error('updateOne not supported by underlying adapter');
  }

  /**
   * Replace one match using injected tenant filter and data.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param filter - Caller predicate; fixed tenant field overrides a conflicting value unless createOnly is true.
   * @param data - Record data; fixed tenant field overwrites caller tenant data before delegation.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The base adapter operation-result metadata.
   * @throws Rejects with Error if the base adapter does not support this operation; base adapter failures propagate.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.replaceOne?.("notes", { id: "note-1" }, { title: "hello" });
   * }
   * ```
   */
  async replaceOne?(collection: string, filter: Filter, data: Record<string, unknown>, options?: QueryOptions): Promise<OperationResult> {
    if (this.base.replaceOne) {
      return this.base.replaceOne(collection, this.withTenantFilter(filter), this.withTenantData(data), options);
    }
    throw new Error('replaceOne not supported by underlying adapter');
  }

  /**
   * Delete one match using the injected tenant filter.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param filter - Caller predicate; fixed tenant field overrides a conflicting value unless createOnly is true.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The base adapter operation-result metadata.
   * @throws Rejects with Error if the base adapter does not support this operation; base adapter failures propagate.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.deleteOne?.("notes", { id: "note-1" });
   * }
   * ```
   */
  async deleteOne?(collection: string, filter: Filter, options?: QueryOptions): Promise<OperationResult> {
    if (this.base.deleteOne) {
      return this.base.deleteOne(collection, this.withTenantFilter(filter), options);
    }
    throw new Error('deleteOne not supported by underlying adapter');
  }

  /**
   * Update and return one match using injected tenant filter and data.
   * @typeParam T - Expected base-adapter record/result type; no runtime shape validation is added and the default is unknown.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param filter - Caller predicate; fixed tenant field overrides a conflicting value unless createOnly is true.
   * @param data - Record data; fixed tenant field overwrites caller tenant data before delegation.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The updated record or null, as resolved by the base adapter.
   * @throws Rejects with Error if the base adapter does not support this operation; base adapter failures propagate.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.findOneAndUpdate?.("notes", { id: "note-1" }, { title: "hello" });
   * }
   * ```
   */
  async findOneAndUpdate?<T = unknown>(collection: string, filter: Filter, data: Record<string, unknown>, options?: QueryOptions): Promise<T | null> {
    if (this.base.findOneAndUpdate) {
      return this.base.findOneAndUpdate<T>(collection, this.withTenantFilter(filter), this.withTenantData(data), options);
    }
    throw new Error('findOneAndUpdate not supported by underlying adapter');
  }

  /**
   * Replace and return one match using injected tenant filter and data.
   * @typeParam T - Expected base-adapter record/result type; no runtime shape validation is added and the default is unknown.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param filter - Caller predicate; fixed tenant field overrides a conflicting value unless createOnly is true.
   * @param data - Record data; fixed tenant field overwrites caller tenant data before delegation.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The replacement record or null, as resolved by the base adapter.
   * @throws Rejects with Error if the base adapter does not support this operation; base adapter failures propagate.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.findOneAndReplace?.("notes", { id: "note-1" }, { title: "hello" });
   * }
   * ```
   */
  async findOneAndReplace?<T = unknown>(collection: string, filter: Filter, data: Record<string, unknown>, options?: QueryOptions): Promise<T | null> {
    if (this.base.findOneAndReplace) {
      return this.base.findOneAndReplace<T>(collection, this.withTenantFilter(filter), this.withTenantData(data), options);
    }
    throw new Error('findOneAndReplace not supported by underlying adapter');
  }

  /**
   * Delete and return one match using the injected tenant filter.
   * @typeParam T - Expected base-adapter record/result type; no runtime shape validation is added and the default is unknown.
   * @param collection - Host-approved collection/table identity interpreted by the base adapter.
   * @param filter - Caller predicate; fixed tenant field overrides a conflicting value unless createOnly is true.
   * @param options - Optional query settings forwarded unchanged; defaults and transaction behavior belong to the base adapter.
   * @returns The deleted record or null, as resolved by the base adapter.
   * @throws Rejects with Error if the base adapter does not support this operation; base adapter failures propagate.
   * @remarks Requires a real connected host adapter. This wrapper supplies no retry/cancellation or transaction boundary; write/ownership guarantees are those of the host.
   * @example
   * ```typescript
   * import { TenantAwareAdapter } from "@alneas/eaos-core/adapters/tenant-adapter";
   * import type { DataAccessAdapter } from "@alneas/eaos-core/adapters/types";
   * async function useHostAdapter(base: DataAccessAdapter) {
   *  const adapter = new TenantAwareAdapter(base, { tenantId: "tenant-demo" });
   *  return await adapter.findOneAndDelete?.("notes", { id: "note-1" });
   * }
   * ```
   */
  async findOneAndDelete?<T = unknown>(collection: string, filter: Filter, options?: QueryOptions): Promise<T | null> {
    if (this.base.findOneAndDelete) {
      return this.base.findOneAndDelete<T>(collection, this.withTenantFilter(filter), options);
    }
    throw new Error('findOneAndDelete not supported by underlying adapter');
  }
}
