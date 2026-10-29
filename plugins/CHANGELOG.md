# @alneas/eaos-plugins

## 0.3.0

### Minor Changes

- 11f1579: Add connected workspace factories for approval, field customization and the audit journal through additive `/workspace-binding` entries. Hosts provide verified browser capabilities and an explicit field resource catalog. Approval and field responses use the canonical document schemas through the Appkit Core ^0.2.2 peer. Raw workspace entries remain supported.

### Patch Changes

- 11f1579: Use compatible caret ranges for the Core ^0.2.1, Server ^0.3.0 and React ^0.3.0 contracts and published Appkit Core ^0.2.2 / React ^0.3.1 peers. Lockfiles retain exact resolved versions and integrity.
- Updated dependencies [11f1579]
  - @alneas/eaos-core@0.2.1
  - @alneas/eaos-server@0.3.0
  - @alneas/eaos-react@0.3.0

### Upgrade

- Adopt matching Core 0.2.1, Server 0.3.0 and React 0.3.0 contracts for the corresponding runtime/UI entries. Hosts supply live authorization and explicit workspace ports. Existing raw workspace entrypoints remain supported; package installation does not activate features or apply migrations.

## 0.2.0

### Added

- Connect exact reviewed draft commands to the existing staged approval service. Verify retained proposals, current input/target/contract bindings and final decision receipts before invoking the owning save command.
- Mount authenticated draft review routes only when the Host configures durable proposal retention, live contract resolution and domain execution ports.

### Changed

- Align English/Japanese setup and support guidance with actual package requirements; link the existing GitHub private reporting channel without adding a support guarantee.

- Adopt matching EAOS Core, Server and React ^0.2.0 contracts and Appkit React 0.3.0 for plugin UI. Keep generic approval, field customization and admin implementations in the public collection.

### Upgrade

- Configure the approval feature's reviewed-draft ports. Hosts retain final authorization, CAS, durable command idempotency and transaction boundaries. Update UI peers/styles as documented; publishing code does not activate a tenant.

## 0.1.0

Publication-status correction: this version is registered on public npm. The initial preparation record called it an unpublished candidate; that wording describes its preparation state, not its current availability. The original feature and dependency notes below are retained.

### Added

- Package the canonical MIT approval, field-customization and admin features in one optional collection with explicit per-feature runtime, metadata and React subpaths.
- Provide declarative catalog discovery and isolated feature outputs and inventories.

### Changed

- Replace the three unpublished `@alneas/eaos-plugin-*` distribution names with `@alneas/eaos-plugins`. Preserve plugin IDs, authorization behavior, schema and migration identities.

### Adoption

- Install `@alneas/eaos-plugins` once, then import `@alneas/eaos-plugins/<id>` and its declared subpaths. Select logical module owners in `preset.plugins` and bind each runtime explicitly; installation and selection do not activate tenants.
- Use Node.js 24 or later, Appkit Core/React exactly 0.2.0 and the documented EAOS/React peers. Before publication use the reviewed checksum-verified archive.
- Feature history remains in the approval, field-customization and admin folders. This consolidation belongs to the same initial 0.1.0 candidate and requires no fabricated later version.
