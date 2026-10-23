# @alneas/eaos-plugins/field-customization

[English](README.md) | [日本語](https://github.com/dataarthub/eaos/blob/main/plugins/field-customization/README.ja.md)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Hono server](https://img.shields.io/badge/Hono-E36002?style=flat&logo=hono&logoColor=white)](https://hono.dev/docs/) [![React UI](https://img.shields.io/badge/React-149ECA?style=flat&logo=react&logoColor=white)](https://react.dev/learn)

## Elevator Pitch

Administrators use the generic field-customization plugin to configure permitted field presentation.

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

Use Node.js 24 or later. This manifest-only example reads metadata and needs no UI, credentials or tenant activation. Appkit Core 0.2.0 is a required peer of the Core/Server dependencies. For the optional /react entry, also install @alneas/eaos-react, @alneas/appkit-react@0.2.0, React/React DOM ^19.2.3 and Lucide React; import @alneas/appkit-react/styles and use the providers documented in the host integration guide. Install `@alneas/eaos-plugins` once; `/field-customization` and its nested subpaths select this feature. The subpath is an import target, not a separately installed package.

```bash
bun add @alneas/eaos-plugins @alneas/appkit-core@0.2.0
```

```typescript
import { manifest } from '@alneas/eaos-plugins/field-customization/manifest'

console.log(manifest.id, manifest.version)
```

## Next Steps

- [Change history](https://github.com/dataarthub/eaos/blob/main/plugins/field-customization/CHANGELOG.md)
- [User guide](docs/user-guide.md)
- [Host integration](docs/maintainer-guide.md)
- [API reference](docs/api.md)
- [Architecture](docs/guide.md)

English questions and issue reports are welcome in the [EAOS issue tracker](https://github.com/dataarthub/eaos/issues). Do not include private tenant data, credentials or operator receipts.
