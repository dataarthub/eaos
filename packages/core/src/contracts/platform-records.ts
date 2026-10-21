import type { DataContract } from './data-contracts'
import type { JsonDocumentContract } from './json-documents'
import source from '../../schemas/platform-records.json'
function freeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const child of Object.values(value)) freeze(child)
  Object.freeze(value)
}
freeze(source)
/**
 * Canonical public platform envelope. Historical migration identities are unchanged.
 * @see {@link getPlatformRecordsContract}
 */
export const platformRecordsContract: Readonly<DataContract> = source as DataContract
/**
 * Clone the recursively frozen public platform record contract.
 * @returns A mutable detached DataContract copy suitable for host catalog composition.
 * @example
 * ```typescript
 * import { getPlatformRecordsContract } from "@alneas/eaos-core/contracts/platform-records";
 * console.log(getPlatformRecordsContract().id);
 * ```
 */
export const getPlatformRecordsContract = (): DataContract => structuredClone(platformRecordsContract)
/**
 * Select public payload document contracts for one platform namespace.
 * @param contractId - Must equal platformRecordsContract.id.
 * @param namespace - Exact namespace used to filter payload-column documents.
 * @returns A detached array of matching logical document contracts.
 * @throws Error for an unknown public contract or a namespace without payload document contracts.
 * @example
 * ```typescript
 * import { getPlatformNamespaceDocumentContracts } from "@alneas/eaos-core/contracts/platform-records";
 * import { platformRecordsContract } from "@alneas/eaos-core/contracts/platform-records";
 * const namespace = platformRecordsContract.jsonDocuments?.find(document => document.column === "payload")?.namespace;
 * if (!namespace) throw new Error("No payload namespace in this contract");
 * console.log(getPlatformNamespaceDocumentContracts(platformRecordsContract.id, namespace));
 * ```
 */
export function getPlatformNamespaceDocumentContracts(contractId: string, namespace: string): JsonDocumentContract[] {
  if (contractId !== platformRecordsContract.id) throw new Error('Unknown public platform data contract')
  const documents = platformRecordsContract.jsonDocuments?.filter(d => d.column === 'payload' && d.namespace === namespace) ?? []
  if (!documents.length) throw new Error('Unknown public platform payload namespace')
  return structuredClone(documents)
}
