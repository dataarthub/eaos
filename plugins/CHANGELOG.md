# @alneas/eaos-plugins

## 0.1.0

Initial unpublished candidate. A version heading and retained initial source commit are not evidence of npm publication.

### Added

- Package the canonical MIT approval, field-customization and admin features in one optional collection with explicit per-feature runtime, metadata and React subpaths.
- Provide declarative catalog discovery and isolated feature outputs and inventories.

### Changed

- Replace the three unpublished `@alneas/eaos-plugin-*` distribution names with `@alneas/eaos-plugins`. Preserve plugin IDs, authorization behavior, schema and migration identities.

### Adoption

- Install `@alneas/eaos-plugins` once, then import `@alneas/eaos-plugins/<id>` and its declared subpaths. Select logical module owners in `preset.plugins` and bind each runtime explicitly; installation and selection do not activate tenants.
- Use Node.js 24 or later, Appkit Core/React exactly 0.2.0 and the documented EAOS/React peers. Before publication use the reviewed checksum-verified archive.
- Feature history remains in the approval, field-customization and admin folders. This consolidation belongs to the same initial 0.1.0 candidate and requires no fabricated later version.
