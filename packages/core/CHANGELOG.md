# @alneas/eaos-core

## 0.2.1

### Patch Changes

- 11f1579: Use compatible caret ranges for distributed runtime and peer dependencies, with exact versions and integrity retained in the lockfile. Keep Appkit Core and React on their independently versioned compatible lines. Manifest and registry preflight checks now accept compatible Appkit ranges while rejecting unsupported lines. Host runtime builds preserve dynamic imports in separate chunks so optional implementations remain deferred.

## 0.2.0

### Added

- Add configurable document ingestion, evidence citations, inline completion and balanced journal draft contracts. Hosts supply industry classification, account mapping and model adapters.
- Prepare exact reviewed command inputs through Appkit proposals and normalize AI risk requirements in shared execution contracts.
- Represent unavailable provider usage explicitly in Host accounting callbacks; unknown usage never implies zero tokens or cost.

### Changed

- Align English/Japanese setup and support guidance with actual package requirements; link the existing GitHub private reporting channel without adding a support guarantee.

- Keep Core independent of Server and business plugins. Posting, reversal, tenant authorization and persistence remain with their owning commands.

### Upgrade

- Adopt the 0.2.0 contracts together with matching EAOS Server, React and approval consumers. Replace branch-only industry helpers with domain-owned mappings. Appkit Core remains exactly 0.2.0.

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
