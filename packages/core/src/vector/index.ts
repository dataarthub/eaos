/**
 * Tenant-scoped trusted index query with a finite vector and bounded result count.
 * @see {@link assertVectorSearchRequest}
 */
export interface VectorSearchRequest {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  /** Trusted host catalog key; callers never provide a physical table or column name. */
  indexId: string
  
/** Nonempty finite numeric embedding; the host checks its dimension against the selected index. */
  queryVector: readonly number[]
  
/** Requested maximum result count; vector request validation permits integers from 1 to 10000. */
  topK: number
  
/** Optional host-approved metadata filters; physical field permissions and semantics remain adapter-owned. */
  filters?: Readonly<Record<string, string | number | boolean | readonly string[]>>
}

/**
 * Provider result identity and finite relevance score scoped to one tenant.
 * @see {@link assertVectorSearchRequest}
 */
export interface VectorSearchHit {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
  /** Provider result identity unique within one validated result set. */
  id: string
  
/** Provider/detector relevance or anomaly score; interpret using the owning result contract. */
  score: number
  
/** Optional host/provider metadata; callers remain responsible for sensitive content and validation. */
  metadata?: Readonly<Record<string, unknown>>
}

/**
 * Provider-neutral vector search. pgvector, Oracle Vector Search and hosted indexes implement this boundary.
 * @see {@link assertVectorSearchRequest}
 */
export interface VectorSearchAdapter {
  
  /**
   * Search a trusted host vector index within a tenant boundary.
   * @param input - Verified tenant, catalog index ID, query vector, result count and optional approved filters.
   * @returns Provider-ranked hits, possibly empty; score scale and ordering are provider-defined.
   * @throws Host index/search failures reject the Promise.
   * @remarks Host owns index authorization, vector dimensions/filter validation and cancellation. Validate results with assertVectorSearchHits before consuming them.
   * @example
   * ```typescript
   * import type { VectorSearchAdapter } from "@alneas/eaos-core/vector";
   * async function searchHost(adapter: VectorSearchAdapter) { return adapter.search({ tenantId: "tenant-demo", indexId: "documents", queryVector: [0.1, 0.2], topK: 5 }); }
   * ```
   */
  search(input: VectorSearchRequest): Promise<readonly VectorSearchHit[]>
}

function text(value: unknown, name: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid vector ${name}`)
  return value
}

/**
 * Validate tenant scope, query vector and bounded result count.
 * @param input - Nonempty tenant/index IDs up to 256 characters, nonempty finite vector and integer topK from 1 to 10000.
 * @returns The original request object; filters are not validated by this helper.
 * @throws Error for an invalid identity, vector or result count.
 * @remarks The host validates index authorization, vector dimension and filter semantics.
 * @example
 * ```typescript
 * import { assertVectorSearchRequest } from "@alneas/eaos-core/vector";
 * console.log(assertVectorSearchRequest({ tenantId: "tenant-demo", indexId: "documents", queryVector: [0.1, 0.2], topK: 10 }));
 * ```
 */
export function assertVectorSearchRequest(input: VectorSearchRequest): VectorSearchRequest {
  text(input?.tenantId, 'tenantId')
  text(input?.indexId, 'indexId')
  if (!Array.isArray(input.queryVector) || input.queryVector.length === 0 || input.queryVector.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid vector query')
  if (!Number.isSafeInteger(input.topK) || input.topK < 1 || input.topK > 10000) throw new Error('Invalid vector result limit')
  return input
}

/**
 * Reject provider results that cross a tenant boundary or contain unusable scores.
 * @param hits - Provider results; IDs must be unique and scores finite.
 * @param tenantId - Expected nonempty tenant ID, at most 256 characters.
 * @returns The original hit array, including an empty array when no results exist.
 * @throws Error for invalid scope, foreign-tenant results, invalid/duplicate IDs or nonfinite scores.
 * @remarks Score range and ordering remain provider-defined.
 * @example
 * ```typescript
 * import { assertVectorSearchHits } from "@alneas/eaos-core/vector";
 * console.log(assertVectorSearchHits([], "tenant-demo")); // []
 * ```
 */
export function assertVectorSearchHits(hits: readonly VectorSearchHit[], tenantId: string): readonly VectorSearchHit[] {
  text(tenantId, 'tenantId')
  if (!Array.isArray(hits)) throw new Error('Invalid vector search result')
  const ids = new Set<string>()
  for (const hit of hits) {
    if (hit.tenantId !== tenantId || !text(hit.id, 'result ID') || !Number.isFinite(hit.score) || ids.has(hit.id)) throw new Error('Invalid vector search result')
    ids.add(hit.id)
  }
  return hits
}
