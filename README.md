# EAOS public monorepo

[English](README.md) | [日本語](README.ja.md)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js minimum 24](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/about/previous-releases) [![Bun repository toolchain 1.4.3](https://img.shields.io/badge/Bun-1.4.3-000000?style=flat&logo=bun&logoColor=white)](https://bun.sh/docs)

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

This checkout prepares EAOS 0.2.0; EAOS 0.1.0 is already published. Until 0.2.0 is published, use the checksum-pinned candidate tarballs for isolated consumers. Appkit Core 0.2.0 and React 0.3.0 are public npmjs dependencies. Use Node.js 24 or later and Bun 1.4.3 for repository development.

From this repository root, install the committed dependency lock and run the maintained quality gate:

```bash
bun install --frozen-lockfile
bun run check
```

The gate builds all five packages and checks source, tests, documentation and secrets. The consumer command below applies after the 0.2.0 release.

### Public import

Use Node.js 24 or later and install the required Appkit Core 0.2.0 peer. This example defines a plugin; mounting it requires a trusted host with verified identity, current authorization and scoped data adapters. The subpath is an import target, not a separately installed package.

```bash
bun add @alneas/eaos-core@0.2.0 @alneas/appkit-core@^0.2.2
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

Questions and issue reports in English are welcome in [GitHub Issues](https://github.com/dataarthub/eaos/issues). Private vulnerability reports can use [GitHub private reporting](https://github.com/dataarthub/eaos/security/advisories/new).
