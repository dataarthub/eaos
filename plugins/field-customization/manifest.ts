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
 * import { manifest } from '@alneas/eaos-plugins/field-customization/manifest'
 * console.log(manifest.id, manifest.version)
 */
export const manifest: PluginManifest = {
  "id": "field-customization",
  "name": "field-customization",
  "description": "Tenant-scoped field-customization",
  "version": version,
  "icon": "settings",
  "category": "platform",
  "targets": [
    "web"
  ],
  "dependencies": [],
  "tier": 'public', entitlement: { tier: 'public' },
  "industries": [],
  "contracts": [],
  "subscribes": [],
  "publishes": [],
  "navigation": {"web": {"label": "項目設定", "icon": "settings", "order": 30, "children": [{"path": "/plugins/field-customization/workspace", "label": "項目設定"}]}},
  "schema": { "dataContracts": {"platform-records":"^1.1.0"},
    "storagePolicy": {
      "maxPayloadBytes": 4194304,
      "objectStorage": "optional",
      "historyRetentionDays": null,
      "archive": { "mode": "none" }
    },
    "ownedTables": [], "storage": { "table": "eaos_platform_records", "namespace": "field_customization", "contractId": "platform-records", "version": "^1.0.0" },
    "externalReferences": {},
    "migrationOrder": 10
  },
  "api": {
    "prefix": "/api/plugins/field-customization"
  },
  "docs": {
    "userGuidePath": "docs/user-guide.md",
    "maintainerGuidePath": "docs/maintainer-guide.md"
  }
}
