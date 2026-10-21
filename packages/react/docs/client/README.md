---
title: "Client capability"
description: "Host developers use @alneas/eaos-react/client for portable browser clients and Worker computation."
sidebar:
  order: 20
archetype: "explanation"
project: "eaos-workspace"
tags: ["eaos", "explanation"]
---

# Client capability

## Elevator Pitch

Host developers use `@alneas/eaos-react/client` for portable browser clients and Worker computation.

## Why & Value

This topic belongs to `@alneas/eaos-react` and is not an independently installed package. Shared contracts keep capability ownership clear while host identity, provider configuration and acceptance remain explicit.

## Key Highlights

- Canonical package subpath
- Explicit host boundaries
- Typed declarations and local verification

## Quickstart

Install the owning package, using a verified tarball before registry publication.

### Public import

Install the owning package and use the exact import in the example below. The subpath is not a separate npm package. Check the selected entry's runtime and peer requirements in the linked architecture guide.

```bash
bun add @alneas/eaos-react
```

```typescript
import * as capability from '@alneas/eaos-react/client'

console.log(Object.keys(capability))
```

## Next Steps

- [Architecture and host boundaries](docs/guide.md)
- [API reference](docs/api.md)
- [Owning package](../index.md)
