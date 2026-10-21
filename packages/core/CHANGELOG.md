# @alneas/eaos-core

## 0.1.0

### Added

- Declare Public, Standard, Pro and Corporate plugin tiers with explicit entitlement metadata. Unmetered Public features do not require a paid contract service.

### Changed

- Adopt the public `@alneas/appkit-core@0.2.0` peer and require Node.js 24 or later. Replace legacy Appkit imports with the supported feature entrypoints.
- Ship English guides, source-derived API references, complete installation requirements and a visible package history link. Japanese product help remains separate from portal translations.

### Fixed

- Validate table ownership in schema-qualified PostgreSQL dump statements and quoted Oracle metadata; reject foreign tables during baseline generation.

### Upgrade

- Install the exact Appkit Core 0.2.0 peer, use the supported public imports, and upgrade the host runtime to Node.js 24 or later.
