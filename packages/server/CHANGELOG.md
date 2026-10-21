# @alneas/eaos-server

## 0.1.0

### Added

- Allow unrestricted, unmetered Public entitlement rules to skip an external paid entitlement runtime. Authentication and host lifecycle/resource admission remain mandatory.

### Changed

- Adopt public `@alneas/appkit-core@0.2.0`, require Node.js 24 or later, and consume `@alneas/eaos-core@^0.1.0`.
- Use the portable storage download contract: downloads return `Uint8Array` or `null`. Decode text with `TextDecoder`; Node hosts can explicitly wrap bytes with `Buffer`.
- Ship English guides, source-derived API references, complete installation requirements and package history.

### Fixed

- Read current tenant contracts inside the quota reservation's existing transaction instead of nesting a control database transaction.

### Upgrade

- Install the exact Appkit Core 0.2.0 peer, upgrade Node.js to 24 or later, and update adapters expecting a Buffer-only download result.
