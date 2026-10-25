# Core contracts and plugin SDK

[English](https://github.com/dataarthub/eaos/blob/main/packages/core/README.md) | [日本語](https://github.com/dataarthub/eaos/blob/main/packages/core/README.ja.md)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js minimum 24](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/about/previous-releases) [![Appkit Core peer 0.2.0](https://img.shields.io/badge/Appkit_Core-0.2.0-3178C6?style=flat)](https://www.npmjs.com/package/@alneas/appkit-core)

## Elevator Pitch

Plugin authors use Core to declare portable features, data ownership and entitlement contracts.

## Why & Value

Pure contracts remain usable without Server, database drivers or browser UI. The trusted host supplies identity and actual execution capabilities. This MIT package owns its implementation and declarations in the public monorepo.

## Key Highlights

- Pure plugin SDK
- Versioned data contracts
- Entitlement contracts
- Isolated test harness

## Quickstart

This checkout prepares version 0.2.0; version 0.1.0 is already published. Until 0.2.0 is published, install the checksum-pinned candidate tarball. The command below applies after that release.

### Public import

Use Node.js 24 or later and install the required Appkit Core 0.2.0 peer. This example defines a plugin; mounting it requires a trusted host with verified identity, current authorization and scoped data adapters. The subpath is an import target, not a separately installed package.

```bash
bun add @alneas/eaos-core@0.2.0 @alneas/appkit-core@0.2.0
```

```typescript
import { definePlugin } from '@alneas/eaos-core'

export const notes = definePlugin({
  id: 'notes',
  entitlement: { tier: 'public' },
  routes(router) {
    router.post<{ id: string }>('/read', async (ctx, input) =>
      ctx.db.findOne('notes', input.id))
  },
})
```

## Next Steps

- [Change history](https://github.com/dataarthub/eaos/blob/main/packages/core/CHANGELOG.md)
- [Architecture and boundaries](docs/guide.md)
- [API reference](docs/api.md)
- [EAOS composition](https://tech-docs.alneas.com/eaos-workspace/architecture/)

Questions and issue reports in English are welcome in [GitHub Issues](https://github.com/dataarthub/eaos/issues). For private vulnerability reports, follow the [security policy](https://github.com/dataarthub/eaos/blob/main/SECURITY.md).
