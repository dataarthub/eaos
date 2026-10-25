---
title: "CLI authoring and release tools"
description: "Plugin and host developers use the CLI to generate, diagnose and verify EAOS packages."
sidebar:
  order: 20
archetype: "explanation"
project: "eaos-workspace"
tags: ["eaos","explanation"]
---

<!-- Generated from packages/cli/README.md; edit the README and run docs:readmes:prepare. -->

# CLI authoring and release tools

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js minimum 24](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/about/previous-releases) [![Appkit Core dependency 0.2.0](https://img.shields.io/badge/Appkit_Core-0.2.0-3178C6?style=flat)](https://www.npmjs.com/package/@alneas/appkit-core)

## Elevator Pitch

Plugin and host developers use the CLI to generate, diagnose and verify EAOS packages.

## Why & Value

One toolchain shares metadata and deployment inventory between development and release. Plans, actual application and tenant activation remain separate operations. This MIT package owns its implementation and declarations in the public monorepo.

## Key Highlights

- Plugin generation and sandbox
- Checksum inventories
- Verified database baselines
- OCI release plans

## Quickstart

This checkout prepares version 0.2.0; version 0.1.0 is already published. Until 0.2.0 is published, install the checksum-pinned candidate tarball. The command below applies after that release.

### Public import

Use Node.js 24 or later. The baseline image inventory example needs no database, UI provider, stylesheet or OCI credentials. Appkit Core 0.2.0 is installed as a package dependency. Pulumi/OCI peers are needed only for the corresponding infrastructure entrypoints; inspect their guide before configuring a deployment. The subpath is an import target, not a separately installed package.

```bash
bun add @alneas/eaos-cli@0.2.0
```

```typescript
import { baselineImages } from '@alneas/eaos-cli/baseline'

console.log(baselineImages.postgres)
console.log(baselineImages.oracle)
```

## Next Steps

- [Change history](https://github.com/dataarthub/eaos/blob/main/packages/cli/CHANGELOG.md)
- [Architecture and boundaries](guide.md)
- [API reference](api.md)
- [EAOS composition](https://tech-docs.alneas.com/eaos-workspace/architecture/)

Questions and issue reports in English are welcome in [GitHub Issues](https://github.com/dataarthub/eaos/issues). For private vulnerability reports, follow the [security policy](https://github.com/dataarthub/eaos/blob/main/SECURITY.md).
