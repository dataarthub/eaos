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
 * import { manifest } from '@alneas/eaos-plugins/admin/manifest'
 * console.log(manifest.id, manifest.version)
 */
export const manifest: PluginManifest = {
  "id": "admin",
  "name": "Admin explorer",
  "description": "Explicitly authorized read-only resources",
  "version": version,
  "icon": "database",
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
  "navigation": { "web": { "label": "操作監査", "icon": "database", "order": 90, "children": [{ "path": "/plugins/admin", "label": "操作監査" }] } },
  "schema": {
    "storagePolicy": {
      "maxPayloadBytes": 4194304,
      "objectStorage": "optional",
      "historyRetentionDays": null,
      "archive": { "mode": "none" }
    },
    "ownedTables": [],
    "externalReferences": {},
    "migrationOrder": 0
  },
  "api": {
    "prefix": "/api/plugins/admin"
  },
  "docs": {
    "userGuidePath": "docs/user-guide.md",
    "maintainerGuidePath": "docs/maintainer-guide.md"
  }
}
