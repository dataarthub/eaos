---
title: "Compose verified host artifacts"
description: "Acquire frontend contributions and generate explicitly selected feature registrations without activating tenants."
archetype: how-to
project: eaos-workspace
tags: [cli, host]
---

# Compose verified host artifacts

Development API: these additions require a candidate package containing the new exports until its reviewed release is published.

## Prerequisites

Use Node 24 or newer and the owning project's pinned CLI package. Supply built,
checksummed deployment inventories and host-reviewed feature descriptors. Keep
credentials and tenant authorization in the host.

## Public import

Import these functions from `@alneas/eaos-cli/platform`.

## Step-by-Step Implementation

```typescript
import { acquireFrontendArtifact, stageFrontendArtifacts } from '@alneas/eaos-cli/platform'

export async function prepareFrontend(root: string, inventory: string) {
  await acquireFrontendArtifact(root, inventory)
  return stageFrontendArtifacts(root, {
    output: 'web/private-contributions.ts',
    reservedRoutes: ['/', '/settings/profile'],
  })
}
```

The catalog defaults to `frontend.packages.json`. Existing selections are
preserved when validation fails. Acquisition verifies files without executing
their JavaScript. The generated module exports `privateNavigation` and
`privatePages`; the application still enforces current tenant and API admission.

Use `eaos frontend acquire <inventory>` and `eaos frontend stage --out <module>`
for the same operations. Pass repeated reserved route values with
`--reserved-route <routes...>`.

`generateFeatureRegistrations` accepts explicit `selectedIds`, data-only
descriptors and separate manifest/lifecycle/web output paths. Version/identity
checks bind runtime registrations to those descriptors. `selectClientBindings`
can prune static host client registration rows and unreachable adapters; validate
remaining dynamic peer imports against the build selection as well.

## Verification

Use `generateFeatureRegistrations` with `check: true` to detect stale generated
modules without repairing them. Test artifact loading through the application's
real bundler and verify that browser output has no server/provider dependencies.
Registration and compilation are separate from deployment and tenant activation.

## Troubleshooting / Common Pitfalls

- A malformed catalog is an error; only an absent optional catalog means no selected contributions.
- A held operation lock requires reconciling the task that owns it; do not silently overwrite another writer.
- Changed checksums, invalid component exports, duplicate routes and reserved routes must be fixed at their owning artifact/declaration.
- Explicitly adopt required feature dependencies; new catalog entries are never adopted automatically.

## Connected workspace generation

Add `outputs.bindings` to `generateFeatureRegistrations` to emit a connected
browser module. Every selected web route requires `workspace` metadata naming
its published factory, export and exact fallback label. `workspace: false`
explicitly retains a raw-only route outside standard composition; headless
features have no browser routes. A missing declaration fails generation.

The generated `createOfficialWorkspacePages(environment, options)` calls the
public React composition contract. Its options type preserves each selected
factory's required ports. Multi-route owners import one factory. Configure
`reservedRoutes` with application-owned paths; duplicates are rejected.
Generated browser modules import selected factories only and never server
entries. Hosts must install the matching React and feature peers.

All outputs update under one exclusive project lock with staged replacements
and rollback on failure. Ownership hashes reject unmanaged or hand-edited
outputs. Review and back up old unmanaged outputs before a one-time migration;
normal generation has no force-overwrite mode. Check mode compares exact bytes
without creating directories or locks. The trusted project directory must not
be concurrently replaced with symlinks by another process.

For bundler-specific Host capabilities, set `workspacePorts` to owner-keyed
`{entry: './workspace-ports/example', exportName: 'ports'}` declarations relative
to the generated bindings module. Only selected connected owners import those
modules. The generated `officialWorkspaceOptions` uses
`satisfies OfficialWorkspaceOptions`, so missing mandatory ports fail the Host
typecheck. Keep domain API operations in the owning factory; these modules
configure assets, transport origins and adopted presentation resources only.
