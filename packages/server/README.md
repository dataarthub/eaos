# Server execution and persistence

[English](README.md) | [日本語](README.ja.md)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js runtime](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs) [![Hono server](https://img.shields.io/badge/Hono-E36002?style=flat&logo=hono&logoColor=white)](https://hono.dev/docs/)

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
- [Architecture and boundaries](docs/guide.md)
- [API reference](docs/api.md)
- [EAOS composition](https://tech-docs.alneas.com/eaos-workspace/architecture/)
- [Standard Host startup (development candidate)](https://github.com/dataarthub/eaos/blob/main/packages/server/docs/standard-host.md)

English questions and issue reports are welcome in the [EAOS issue tracker](https://github.com/dataarthub/eaos/issues). Do not include private tenant data, credentials or operator receipts.
