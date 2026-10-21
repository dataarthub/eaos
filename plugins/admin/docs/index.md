---
title: "@alneas/eaos-plugins/admin"
description: "Administrators use the generic admin plugin to inspect explicitly exposed resources and audit history."
sidebar:
  order: 20
archetype: "explanation"
project: "eaos-workspace"
tags: ["eaos","explanation"]
---

<!-- Generated from plugins/admin/README.md; edit the README and run docs:readmes:prepare. -->

# @alneas/eaos-plugins/admin

## Elevator Pitch

Administrators use the generic admin plugin to inspect explicitly exposed resources and audit history.

## Why & Value

This is a feature guide for the shared [standard plugin collection](https://github.com/dataarthub/eaos/blob/main/plugins/README.md), not a separately published package. The MIT implementation shares trusted principal, live activation and resource authorization contracts with the host. Durable stores and audit remain explicit host bindings. Installation never activates a tenant or executes a business workflow.

## Key Highlights

- Generic API and React entrypoints
- Host-controlled resource access
- Durable history and stale-revision checks
- Checksummed deployment inventory

## Quickstart

This feature belongs to the unpublished initial `@alneas/eaos-plugins@0.1.0` candidate. Use its checksum-verified tarball before publication; registry commands require an available release.

### Public import

Use Node.js 24 or later. This manifest-only example reads metadata and needs no UI, credentials or tenant activation. Appkit Core 0.2.0 is a required peer of the Core/Server dependencies. For the optional /react entry, also install @alneas/eaos-react, @alneas/appkit-react@0.2.0, React/React DOM ^19.2.3 and Lucide React; import @alneas/appkit-react/styles and use the providers documented in the host integration guide. Install `@alneas/eaos-plugins` once; `/admin` and its nested subpaths select this feature. The subpath is an import target, not a separately installed package.

```bash
bun add @alneas/eaos-plugins @alneas/appkit-core@0.2.0
```

```typescript
import { manifest } from '@alneas/eaos-plugins/admin/manifest'

console.log(manifest.id, manifest.version)
```

## Next Steps

- [Change history](https://github.com/dataarthub/eaos/blob/main/plugins/admin/CHANGELOG.md)
- [User guide](user-guide.md)
- [Host integration](maintainer-guide.md)
- [API reference](api.md)
- [Architecture](guide.md)
