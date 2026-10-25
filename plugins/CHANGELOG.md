# @alneas/eaos-plugins

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
