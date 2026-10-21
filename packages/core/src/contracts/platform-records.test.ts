import { expect, test } from 'bun:test'
import { getPlatformRecordsContract, getPlatformNamespaceDocumentContracts, platformRecordsContract } from './platform-records'
import { resolveDataContracts } from './data-contracts'
test('public envelope preserves historical migration identity and isolates caller mutations', () => {
 const contract = getPlatformRecordsContract()
 expect(contract.version).toBe('1.1.0')
 expect(contract.migrationIdentity).toBe('approval')
 expect(contract.migrations.map(m => m.id)).toEqual(['001-platform_records'])
 expect(resolveDataContracts([contract], {'platform-records':'^1.1.0'}).tables.map(t=>t.name)).toEqual(['eaos_platform_records'])
 expect(Object.isFrozen(platformRecordsContract.migrations[0])).toBe(true)
 contract.migrations.length = 0
 expect(getPlatformRecordsContract().migrations).toHaveLength(1)
 const documents = getPlatformNamespaceDocumentContracts('platform-records','approval')
 documents[0].version = '99.0.0'
 expect(getPlatformNamespaceDocumentContracts('platform-records','approval')[0].version).not.toBe('99.0.0')
 expect(getPlatformNamespaceDocumentContracts('platform-records','field_customization').length).toBeGreaterThan(0)
 expect(()=>getPlatformNamespaceDocumentContracts('private','approval')).toThrow()
 expect(()=>getPlatformNamespaceDocumentContracts('platform-records','foreign')).toThrow()
})
