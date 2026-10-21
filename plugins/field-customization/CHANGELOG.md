# @alneas/eaos-plugins/field-customization

## 0.1.0

Feature history within the unpublished initial `@alneas/eaos-plugins@0.1.0` candidate; this is not an independent npm release.

### Added

- Distribute the canonical MIT field-customization plugin implementation with its public storage and migration identities preserved.

### Changed

- Derive plugin and lifecycle versions from the package manifest; lifecycle compatibility follows the declared Server peer range, avoiding stale identity after a version update.

- Adopt public Appkit React 0.2.0, require Node.js 24 or later, and consume compatible EAOS Core, Server and React `^0.1.0` packages.
- Ship complete installation requirements, English guides, source-derived API references and package history. Product help and portal translations retain separate ownership.

### Upgrade

- Install the documented Appkit/React peers and adopt the EAOS 0.1.0 host packages together. Preserve existing storage and migration identities.
