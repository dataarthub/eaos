---
title: "Host integration"
description: "Use installed public packages and a trusted local project. Host integration requires real scoped persistence, verified identity and current resource authorization. Use synthetic inputs for local checks."
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "how-to"]
---

# Host integration

## Prerequisites

Use installed public packages and a trusted local project. Host integration requires real scoped persistence, verified identity and current resource authorization. Use synthetic inputs for local checks.

## Public import

Install `@alneas/eaos-plugins` once; `/admin` is this feature's import selector, not a separate npm package. Use Node.js 24 or later and Appkit Core exactly 0.2.0 with the declared EAOS Core/Server and Hono peers. Registry installation requires a published EAOS release; before publication use the owning workspace's checksum-verified build artifact.

```bash
bun add @alneas/eaos-plugins @alneas/appkit-core@0.2.0
```

```typescript
import { createPlugin } from '@alneas/eaos-plugins/admin'

export function bindHostPlugin(...args: Parameters<typeof createPlugin>) {
  return createPlugin(...args)
}
```

Server integration requires a verified principal resolver, live authorization and the plugin's durable host ports. React views use the separate `@alneas/eaos-plugins/admin/react` export. Install `@alneas/eaos-react`, `@alneas/appkit-react@0.3.0`, React/React DOM ^19.2.3 and Lucide React, import `@alneas/appkit-react/styles`, and supply authenticated API/session bindings plus the selected workspace and Appkit form/schema providers; importing the server entry requires no CSS.

## Step-by-Step Implementation

This module forwards the actual host ports without inventing identity or persistence:

```typescript
import { createPlugin } from '@alneas/eaos-plugins/admin'

export function bindHostPlugin(
  options: Parameters<typeof createPlugin>[0],
  resolvePrincipal: Parameters<typeof createPlugin>[1],
) {
  return createPlugin(options, resolvePrincipal)
}
```

Use the feature API with host-owned options and a verified principal resolver. `authorize` must check current lifecycle activation, tenant membership and the requested resource on every operation. No tenant ID or role from a request body grants access.

Supply an explicit resource/column catalog, tenant-filtered driver and durable audit callback. The explorer is read-only and never discovers or exposes tables automatically.

`@alneas/eaos-plugins/admin/runtime` exports `createExtension({ tenantIds, bindings })` for the Platform loader. `bindings` contains `{ options, resolvePrincipal }`; missing live host adapters fail closed. Pass these in the trusted loader option `bindings['@alneas/eaos-plugins/admin']`, never in JSON settings or HTTP data. Generic deployment inspection does not execute this factory.

Build/test/pack never apply production DDL, deploy infrastructure or enable tenants. Verify local persistence, cross-tenant refusal, revoked authorization and stale revisions using the packaged plugin before host adoption.

## Verification

Build and install the actual tarball in an isolated consumer. Verify the declared behavior, foreign-tenant denial, stale revisions and revoked access. Importing or installing a package does not activate tenants or apply production changes.

## Troubleshooting / Common Pitfalls

Missing host bindings must fail closed. Do not substitute empty success adapters, infer addon budgets or treat a visible route as permission. Check the owning API reference and current host policy.
