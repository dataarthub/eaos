---
title: "EAOS public monorepo"
description: "Plugin and application authors use EAOS to compose authorized features across server and browser hosts."
sidebar:
  order: 20
archetype: "explanation"
project: "eaos-workspace"
tags: ["eaos","explanation"]
---

<!-- Generated from README.md; edit the README and run docs:readmes:prepare. -->

# EAOS public monorepo

## Elevator Pitch

Plugin and application authors use EAOS to compose authorized features across server and browser hosts.

## Why & Value

Four MIT foundation packages separate pure contracts, Server implementations, React clients and CLI tooling. One optional `@alneas/eaos-plugins` package provides independently selected approval, field customization and administration features, for five npm packages in total. Business plugins and production bindings keep their own ownership; public code never imports private implementations.

## Key Highlights

- `@alneas/eaos-core`: SDK, schemas and entitlement contracts
- `@alneas/eaos-server`: HTTP/MCP, lifecycle, database and storage
- `@alneas/eaos-react`: browser clients, workspaces and help
- `@alneas/eaos-cli`: generation, diagnostics, baseline and release tools

## Quickstart

Registry commands require an available release. Before publication, the owning workspace builds, tests and packs checksum-pinned tarballs for isolated consumers. Appkit Core 0.2.0 and React 0.3.0 are public npmjs dependencies; Node.js 24 or later is required.

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

- [Contribute and verify](../CONTRIBUTING.md)
- [Prepare a release](../RELEASING.md)

- [Standard plugin collection](../plugins/docs/index.md)
- [Public API catalog](api.md)
- [Composition and architecture](architecture.md)
- [Author a plugin](plugin-authoring.md)
- [Verify adoption](testing.md)
- [Documentation ownership and preflight](documentation.md)
