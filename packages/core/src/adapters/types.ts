import type { DataAccessAdapter, Filter, QueryOptions, PopulateOptions, OperationResult } from '@alneas/appkit-core/data/types'
import type { StorageAdapter, StorageObject } from '@alneas/appkit-core/storage'
import type { ContentAdapter, ContentItem, ContentFilter } from '@alneas/appkit-core/data/content'

/** Core uses Appkit Core's canonical data, object-storage and content contracts. */
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
}
