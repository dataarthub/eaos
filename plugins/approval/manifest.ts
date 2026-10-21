import { version } from '../package.json'
import type { PluginManifest } from '@alneas/eaos-core/plugin-sdk'

/**
 * Declares static plugin metadata, navigation, public storage contracts and API prefix.
 *
 *
 * Static metadata shared by documentation inspection and the host-configured factory.
 * @remarks
 * Inspection metadata only; use the package createPlugin factory with live host bindings to obtain routes. This declaration does not activate a tenant.
  * @example
 * import { manifest } from '@alneas/eaos-plugins/approval/manifest'
 * console.log(manifest.id, manifest.version)
 */
export const manifest: PluginManifest = {
  id: 'approval', name: 'approval', description: 'Tenant-scoped approval', version, icon: 'settings', category: 'platform', targets: ['web'], dependencies: [], tier: 'public', entitlement: { tier: 'public' }, industries: [], contracts: [], subscribes: [], publishes: [], navigation: {web: {label: '承認', icon: 'settings', order: 20, children: [{path: '/plugins/approval/workspace', label: '承認'}]}},
  schema: { dataContracts: {"platform-records": "^1.1.0"}, storagePolicy: { maxPayloadBytes: 4 * 1024 * 1024, objectStorage: 'optional', historyRetentionDays: null, archive: { mode: 'none' } },  ownedTables: [], storage: { table: "eaos_platform_records", namespace: "approval", contractId: "platform-records", version: "^1.1.0", jsonDocuments: ["approval.state"] }, externalReferences: {}, migrationOrder: 10 },
  api: { prefix: '/api/plugins/approval' },
  agentCapabilities: { skills: [
    { id: 'approval.platform-approval-policy', name: 'Approval policy', description: 'Route high-impact AI proposals through EAOS approval records and durable workflow resumption.', documentPath: 'skills/approval-policy/SKILL.md', version: '1.0.0', category: 'governance', tags: ['approval','human-in-the-loop','policy'], capabilities: [], actionNames: [], verificationGates: ['target and revision bound', 'current approver authorization', 'single-use approval resume'] },
    { id: 'approval.platform-audit-logging', name: 'Audit logging', description: 'Preserve an immutable, tenant-scoped audit trail through the EAOS audit sink.', documentPath: 'skills/audit-logging/SKILL.md', version: '1.1.0', category: 'governance', tags: ['audit','compliance','observability'], capabilities: [], actionNames: [], verificationGates: ['tenant and trace bound', 'PII and secret redaction', 'distinct outcome receipt'] }
  ] },
  docs: { userGuidePath: 'docs/user-guide.md', maintainerGuidePath: 'docs/maintainer-guide.md' }
}
