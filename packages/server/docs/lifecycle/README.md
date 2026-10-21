---
title: "Lifecycle capability"
description: "Host developers use @alneas/eaos-server/lifecycle-engine for reviewed lifecycle plans and migration history."
sidebar:
  order: 20
archetype: "explanation"
project: "eaos-workspace"
tags: ["eaos", "explanation"]
---

# Lifecycle capability

## Elevator Pitch

Host developers use `@alneas/eaos-server/lifecycle-engine` for reviewed lifecycle plans and migration history.

## Why & Value

This topic belongs to `@alneas/eaos-server` and is not an independently installed package. Shared contracts keep capability ownership clear while host identity, provider configuration and acceptance remain explicit.

## Key Highlights

- Canonical package subpath
- Explicit host boundaries
- Typed declarations and local verification

## Quickstart

Install the owning package, using a verified tarball before registry publication.

### Public import

Install the owning package and use the exact import in the example below. The subpath is not a separate npm package. Check the selected entry's runtime and peer requirements in the linked architecture guide.

```bash
bun add @alneas/eaos-server
```

```typescript
import * as capability from '@alneas/eaos-server/lifecycle-engine'

console.log(Object.keys(capability))
```

## Next Steps

- [Architecture and host boundaries](docs/guide.md)
- [API reference](docs/api.md)
- [Owning package](../index.md)
