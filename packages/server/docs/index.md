---
title: "Server execution and persistence"
description: "Host developers use Server to compose HTTP/MCP, lifecycle and durable data services."
sidebar:
  order: 20
archetype: "explanation"
project: "eaos-workspace"
tags: ["eaos","explanation"]
---

<!-- Generated from packages/server/README.md; edit the README and run docs:readmes:prepare. -->

# Server execution and persistence

## Elevator Pitch

Host developers use Server to compose HTTP/MCP, lifecycle and durable data services.

## Why & Value

Shared implementations keep authorization, CAS, audit and Outbox consistent. The host retains provider connections, current identity and deployment policy. This MIT package owns its implementation and declarations in the public monorepo.

## Key Highlights

- Hono and MCP integration
- Reviewed lifecycle plans
- Durable CAS and audit
- Scoped database and storage

## Quickstart

Registry installation requires a published release. During pre-publication development, install the checksum-pinned tarballs produced by the workspace build instead of assuming these names exist in a registry.

### Public import

Use Node.js 24 or later and the required Appkit Core 0.2.0 peer. The canonicalization example is pure and needs no database connection or credentials. Server execution later requires host-owned identity, authorization and persistence bindings. The subpath is an import target, not a separately installed package.

```bash
bun add @alneas/eaos-server @alneas/appkit-core@0.2.0
```

```typescript
import { canonical } from '@alneas/eaos-server/lifecycle-engine'

console.log(canonical({ format: 1, operation: 'inspect' }))
```

## Next Steps

- [Change history](https://github.com/dataarthub/eaos/blob/main/packages/server/CHANGELOG.md)
- [Architecture and boundaries](guide.md)
- [API reference](api.md)
- [EAOS composition](https://tech-docs.alneas.com/eaos-workspace/architecture/)
