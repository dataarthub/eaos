---
title: "@alneas/eaos-plugins/approval"
description: "Teams use the generic approval plugin to request and record explicit review decisions."
sidebar:
  order: 20
archetype: "explanation"
project: "eaos-workspace"
tags: ["eaos","explanation"]
---

<!-- Generated from plugins/approval/README.md; edit the README and run docs:readmes:prepare. -->

# @alneas/eaos-plugins/approval

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js minimum 24](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/about/previous-releases) [![Hono](https://img.shields.io/badge/Hono-E36002?style=flat&logo=hono&logoColor=white)](https://hono.dev/docs/)

## Elevator Pitch

Teams use the generic approval plugin to request and record explicit review decisions.

## Why & Value

This is a feature guide for the shared [standard plugin collection](https://github.com/dataarthub/eaos/blob/main/plugins/README.md), not a separately published package. The MIT implementation shares trusted principal, live activation and resource authorization contracts with the host. Durable stores and audit remain explicit host bindings. Installation never activates a tenant or executes a business workflow.

## Key Highlights

- Generic API and React entrypoints
- Host-controlled resource access
- Durable history and stale-revision checks
- Checksummed deployment inventory

## Quickstart

This feature belongs to the `@alneas/eaos-plugins@0.2.0` release candidate. Version 0.1.0 is already published; use the checksum-verified 0.2.0 tarball until the new version is available.

### Public import

Use Node.js 24 or later. This manifest-only example reads metadata and needs no UI, credentials or tenant activation. Appkit Core 0.2.0 is a required peer of the Core/Server dependencies. For the optional /react entry, also install @alneas/eaos-react, @alneas/appkit-react@0.3.0, React/React DOM ^19.2.3 and Lucide React; import @alneas/appkit-react/styles and use the providers documented in the host integration guide. Install `@alneas/eaos-plugins` once; `/approval` and its nested subpaths select this feature. The subpath is an import target, not a separately installed package.

```bash
bun add @alneas/eaos-plugins@0.2.0 @alneas/appkit-core@0.2.0
```

```typescript
import { manifest } from '@alneas/eaos-plugins/approval/manifest'

console.log(manifest.id, manifest.version)
```

## Next Steps

- [Change history](https://github.com/dataarthub/eaos/blob/main/plugins/approval/CHANGELOG.md)
- [User guide](user-guide.md)
- [Host integration](maintainer-guide.md)
- [API reference](api.md)
- [Architecture](guide.md)

Questions and issue reports in English are welcome in [GitHub Issues](https://github.com/dataarthub/eaos/issues). For private vulnerability reports, follow the [security policy](https://github.com/dataarthub/eaos/blob/main/SECURITY.md).
