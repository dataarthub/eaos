# EAOS public monorepo

[English](README.md) | [日本語](README.ja.md)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Bun tooling](https://img.shields.io/badge/Bun-14151A?style=flat&logo=bun&logoColor=white)](https://bun.sh/docs) [![React UI](https://img.shields.io/badge/React-149ECA?style=flat&logo=react&logoColor=white)](https://react.dev/learn)

## Elevator Pitch

Plugin and application authors use EAOS to compose authorized features across server and browser hosts.

## Why & Value

Four MIT foundation packages separate pure contracts, Server implementations, React clients and CLI tooling. One optional `@alneas/eaos-plugins` package provides independently selected approval, field customization and administration features, for five npm packages in total. EAOS remains a package system; a deployable Host project supplies adoption and real connections. Business plugins and production bindings keep their own ownership; public code never imports private implementations.

## Key Highlights

- `@alneas/eaos-core`: SDK, schemas and entitlement contracts
- `@alneas/eaos-server`: HTTP/MCP, lifecycle, database and storage
- `@alneas/eaos-react`: browser clients, workspaces and help
- `@alneas/eaos-cli`: generation, diagnostics, baseline and release tools

## Quickstart

Registry commands require an available release. Before publication, the owning workspace builds, tests and packs checksum-pinned tarballs for isolated consumers. Appkit Core and React 0.2.0 are public npmjs dependencies; Node.js 24 or later is required.

### Public import

Use Node.js 24 or later and install the required Appkit Core 0.2.0 peer. This example defines a plugin; mounting it requires a trusted host with verified identity, current authorization and scoped data adapters. The subpath is an import target, not a separately installed package.

```bash
bun add @alneas/eaos-core @alneas/appkit-core@0.2.0
```

```typescript
import { definePlugin } from '@alneas/eaos-core'

export const status = definePlugin({
  id: 'status',
  entitlement: { tier: 'public' },
  routes(router) {
    router.post('/ping', async () => ({ ready: true }))
  },
})
```

## Next Steps

- [Contribute and verify](CONTRIBUTING.md)
- [Prepare a release](RELEASING.md)

- [Standard plugin collection](plugins/README.md)
- [Public API catalog](docs/api.md)
- [Composition and architecture](docs/architecture.md)
- [Author a plugin](docs/plugin-authoring.md)
- [Verify adoption](docs/testing.md)
- [Documentation ownership and preflight](docs/documentation.md)

English questions and issue reports are welcome in the [EAOS issue tracker](https://github.com/dataarthub/eaos/issues). Do not include private tenant data, credentials or operator receipts.
