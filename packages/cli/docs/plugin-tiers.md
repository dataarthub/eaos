---
title: "Plugin tiers and generation"
description: "Use installed public packages and a trusted local project. Host integration requires real scoped persistence, verified identity and current resource authorization. Use synthetic inputs for local checks."
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "how-to"]
---

# Plugin tiers and generation

## Prerequisites

Use installed public packages and a trusted local project. Host integration requires real scoped persistence, verified identity and current resource authorization. Use synthetic inputs for local checks.

## Public import

Install the package; the subpath below is an import target, not a separate package. Registry installation requires a published EAOS release; before publication use the owning workspace's checksum-verified build artifact.

```bash
bun add @alneas/eaos-cli
```

```typescript
import { preparePluginDeployment } from '@alneas/eaos-cli/platform/deployment-assets'

export async function prepareStagedPlugin(stagingDirectory: string) {
  return preparePluginDeployment(stagingDirectory)
}
```

Bun development tooling only. Call on an isolated built staging directory with canonical package metadata; the function writes deployment inventory, so do not pass a released archive or a live host directory.

## Step-by-Step Implementation

```bash
eaos plugin generate --name example --tier public
eaos plugin diagnose --plugin example --check
```

`eaos plugin generate --name example` creates a Public plugin named `@alneas/eaos-plugin-example` with an explicit public entitlement. `--tier standard` uses `@dataarthub/plugin-example`; `--tier pro` uses `@dataarthub/pro-example`; `--tier corporate --allowed-tenants tenant-a` creates a local private package locked to those tenants. Legacy free/premium flags map to public/pro. These generated names describe independent third-party packages. The built-in standard plugins are modules of the single `@alneas/eaos-plugins` package; select them through `/approval`, `/field-customization` or `/admin`, and import each module through its explicit subpaths.

Pro requires an add-on ID (`--addon-id`, default `addon-<id>`) and an admitted-request quota (`--monthly-quota`, default zero). Zero denies execution until the host supplies a positive contract quota. The budget counts admitted HTTP/MCP attempts, including handler failures. This is not a price or a domain-specific simulation/forecast billing unit. The host owns subscription updates and invoicing. Corporate cannot be generated without an explicit tenant allowlist.

The public MIT plugins approval, field-customization and admin use live, in-memory host bindings. Preset configuration contains package names, never function implementations or credentials. The trusted host calls `loadRegisteredPlatformModules(root, config, {tenantIds, bindings: {[packageName]: {options, resolvePrincipal}}})`. Options must provide current lifecycle and resource authorization plus durable storage or a reviewed admin resource catalog and audit sink. No activation is implied by installation.

Public packages are packed with exact inventory hashes by `preparePluginDeployment(stagingDirectory)` from `@alneas/eaos-cli/platform/deployment-assets`. Run this on an isolated built package after restoring its canonical package.json and before packing it. It resolves selectors into shipped assets and registers `dist/runtime.js`. Do not modify a released package after this step.

## Verification

Build and install the actual tarball in an isolated consumer. Verify the declared behavior, foreign-tenant denial, stale revisions and revoked access. Importing or installing a package does not activate tenants or apply production changes.

## Troubleshooting / Common Pitfalls

Missing host bindings must fail closed. Do not substitute empty success adapters, infer addon budgets or treat a visible route as permission. Check the owning API reference and current host policy.
