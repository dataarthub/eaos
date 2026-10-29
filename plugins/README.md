# @alneas/eaos-plugins

[English](https://github.com/dataarthub/eaos/blob/main/plugins/README.md) | [日本語](https://github.com/dataarthub/eaos/blob/main/plugins/README.ja.md)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js minimum 24](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/about/previous-releases) [![Hono](https://img.shields.io/badge/Hono-E36002?style=flat&logo=hono&logoColor=white)](https://hono.dev/docs/)

## Elevator Pitch

EAOS host developers use this MIT collection to add approval, field customization and administration through explicitly selected feature modules.

## Why & Value

One optional npm package owns the three standard features and their release lifecycle. Feature subpaths keep trusted server factories and React frontends separate, with isolated build outputs and inventories. Hosts supply persistence, verified identity and current resource authorization; selecting code and enabling a tenant remain separate decisions.

## Key Highlights

- Approval requests, decisions and durable history
- Field presentation customization with host-owned base schemas
- Administration of explicitly exposed resources and audit history
- Per-feature runtime and frontend entries with declarative catalog discovery

## Quickstart

This checkout prepares version `0.2.0`; version `0.1.0` is already published. Until 0.2.0 is published, install its checksum-verified candidate tarball. The command below is for the released 0.2.0 package. Use Node.js 24 or later and Appkit Core exactly 0.2.0 with compatible EAOS Core/Server ^0.2.0 and Hono ^4.13.13 peers. Install the package once; feature subpaths are import targets, not separate packages.

```bash
bun add @alneas/eaos-plugins@^0.3.0 @alneas/appkit-core@^0.2.2
```

Bind the approval runtime to your real host adapters. This wrapper accepts verified concrete tenant IDs and typed bindings; it does not invent a store or authenticated principal.

```typescript
import {
  createExtension as createApprovalExtension,
  type PublicPluginBindings as ApprovalBindings,
} from '@alneas/eaos-plugins/approval/runtime'

export function bindApprovalHost(
  tenantIds: string[],
  bindings: ApprovalBindings,
) {
  return createApprovalExtension({ tenantIds, bindings })
}
```

The approval bindings require a durable scoped store, template resolver, live authorization and verified principal resolver. Creating the extension validates required adapters and the tenant catalog; it does not apply migrations or activate tenants. Select logical owners such as `@alneas/eaos-plugins/approval` in `preset.plugins`, and pass bindings through the trusted loader under that owner key. `catalog.json` only describes available modules.

For `/approval/react`, `/field-customization/react` or `/admin/react`, also install compatible `@alneas/eaos-react`, `@alneas/appkit-react@^0.3.1`, React/React DOM ^19.2.3 and Lucide React. Import `@alneas/appkit-react/styles` at the application boundary. Supply authenticated API/session bindings, the feature's workspace provider and any Appkit form/schema providers required by the selected view; see each host integration guide.

## Next Steps

- [Approval feature and API](approval/README.md)
- [Field customization feature and API](field-customization/README.md)
- [Administration feature and API](admin/README.md)
- [Collection architecture](docs/architecture.md)
- [Change history](https://github.com/dataarthub/eaos/blob/main/plugins/CHANGELOG.md)

Questions and issue reports in English are welcome in [GitHub Issues](https://github.com/dataarthub/eaos/issues). Private vulnerability reports can use [GitHub private reporting](https://github.com/dataarthub/eaos/security/advisories/new).
