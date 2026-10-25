# Server execution and persistence

[English](https://github.com/dataarthub/eaos/blob/main/packages/server/README.md) | [日本語](https://github.com/dataarthub/eaos/blob/main/packages/server/README.ja.md)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js minimum 24](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/about/previous-releases) [![Hono](https://img.shields.io/badge/Hono-E36002?style=flat&logo=hono&logoColor=white)](https://hono.dev/docs/)

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

This checkout prepares version 0.2.0; version 0.1.0 is already published. Until 0.2.0 is published, install the checksum-pinned candidate tarball. The command below applies after that release.

### Public import

Use Node.js 24 or later and the required Appkit Core 0.2.0 peer. The canonicalization example is pure and needs no database connection or credentials. Server execution later requires host-owned identity, authorization and persistence bindings. The subpath is an import target, not a separately installed package.

```bash
bun add @alneas/eaos-server@0.2.0 @alneas/appkit-core@0.2.0
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

Questions and issue reports in English are welcome in [GitHub Issues](https://github.com/dataarthub/eaos/issues). Private vulnerability reports can use [GitHub private reporting](https://github.com/dataarthub/eaos/security/advisories/new).
