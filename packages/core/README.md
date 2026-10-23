# Core contracts and plugin SDK

[English](README.md) | [日本語](README.ja.md)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js runtime](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs) [![Bun tooling](https://img.shields.io/badge/Bun-14151A?style=flat&logo=bun&logoColor=white)](https://bun.sh/docs)

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

Registry installation requires a published release. During pre-publication development, install the checksum-pinned tarballs produced by the workspace build instead of assuming these names exist in a registry.

### Public import

Use Node.js 24 or later and install the required Appkit Core 0.2.0 peer. This example defines a plugin; mounting it requires a trusted host with verified identity, current authorization and scoped data adapters. The subpath is an import target, not a separately installed package.

```bash
bun add @alneas/eaos-core @alneas/appkit-core@0.2.0
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

English questions and issue reports are welcome in the [EAOS issue tracker](https://github.com/dataarthub/eaos/issues). Do not include private tenant data, credentials or operator receipts.
