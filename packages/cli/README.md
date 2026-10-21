# CLI authoring and release tools

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

Registry installation requires a published release. During pre-publication development, install the checksum-pinned tarballs produced by the workspace build instead of assuming these names exist in a registry.

### Public import

Use Node.js 24 or later. The baseline image inventory example needs no database, UI provider, stylesheet or OCI credentials. Appkit Core 0.2.0 is installed as a package dependency. Pulumi/OCI peers are needed only for the corresponding infrastructure entrypoints; inspect their guide before configuring a deployment. The subpath is an import target, not a separately installed package.

```bash
bun add @alneas/eaos-cli
```

```typescript
import { baselineImages } from '@alneas/eaos-cli/baseline'

console.log(baselineImages.postgres)
console.log(baselineImages.oracle)
```

## Next Steps

- [Change history](https://github.com/dataarthub/eaos/blob/main/packages/cli/CHANGELOG.md)
- [Architecture and boundaries](docs/guide.md)
- [API reference](docs/api.md)
- [EAOS composition](https://tech-docs.alneas.com/eaos-workspace/architecture/)
