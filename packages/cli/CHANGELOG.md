# @alneas/eaos-cli

## 0.2.0

### Changed

- Align English/Japanese setup and support guidance with actual package requirements; document private vulnerability reporting and as-is reporting terms without a support guarantee.

- Consume matching EAOS Core, Server and optional React ^0.2.0 contracts.
- Derive generated plugin Core requirements and platform receipt framework versions from the independently versioned Core package instead of the CLI version.

### Upgrade

- Install Core and Server 0.2.0 before CLI 0.2.0. UI consumers also adopt React 0.2.0 and its Appkit React 0.3.0 requirements. Headless CLI workflows do not require React. No schema or tenant activation change is performed.

## 0.1.0

### Added

- Select independent standard-plugin modules from `@alneas/eaos-plugins` through safe package subpaths, finalize per-module deployment hashes, and stage only selected module assets without executing their runtime factories.

- Generate checksum-pinned PostgreSQL and Oracle final-schema baselines in egress-isolated local database sandboxes, rebuild exported DDL in an independent empty database, and retain source history and compiler verification. Existing SQLite and immutable-ledger rebase contracts remain compatible.
- Support Public, Standard, Pro and Corporate generation with explicit entitlement metadata and verified deployment inventories.
- Render explicit Web/LINE development clients with local persona providers, execute registered MCP tools, and expose allowlisted job, webhook and secret ports.

### Changed

- Adopt public Appkit 0.2.0 dependencies and Node.js 24 or later. Consume EAOS Core, Server and React at `^0.1.0` where required.
- Ship complete installation requirements, English guides, source-derived API references and package history.

### Fixed

- Generate Pulumi projects with the generating CLI's release version instead of the stale `^0.4.4` range.
- Inherit the main SSH user for worker/agent roles and use the provider-supported 256-byte RSA key default.

### Security

- Remove the fixed Kamal database password. Resolve mandatory host bindings through Kamal's inline secrets extractor, preserve secret bytes and token selectors, and reject missing or failed lookups without exposing values.
- Preserve Pulumi configuration as data and native Vault overrides as secret values without re-encoding them. Pin imported adapter sources and existing Pulumi operation inputs throughout a release.

### Upgrade

- For the initial standard-plugin collection candidate, install `@alneas/eaos-plugins` once and select `@alneas/eaos-plugins/approval`, `/field-customization` or `/admin` in preset manifests. Lifecycle plugin IDs and tenant binding requirements remain unchanged.

- Install the exact documented Appkit 0.2.0 peers and upgrade the host to Node.js 24 or later. Generated Kamal templates require Kamal 2.12 or later.
- Review regenerated templates. The default Pulumi directory is now `pulumi`; set `pulumiDir` explicitly when retaining the former directory. Existing customized source remains host-owned.
