---
title: "Run the local plugin sandbox"
description: "Use installed public packages and a trusted local project. Host integration requires real scoped persistence, verified identity and current resource authorization. Use synthetic inputs for local checks."
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "how-to"]
---

# Run the local plugin sandbox

## Prerequisites

Use installed public packages and a trusted local project. Host integration requires real scoped persistence, verified identity and current resource authorization. Use synthetic inputs for local checks.

## Public import

Install the package; the subpath below is an import target, not a separate package. Registry installation requires a published EAOS release; before publication use the owning workspace's checksum-verified build artifact.

```bash
bun add @alneas/eaos-cli
```

```typescript
import { defineDevConfig } from '@alneas/eaos-cli/dev'

export const configureSandbox = defineDevConfig
```

Run with Bun and its supported node:sqlite API. UI simulation additionally needs the React/React DOM and EAOS React peers; supply explicit web/LINE modules and real test host capabilities.

## Step-by-Step Implementation

Run with Bun from a trusted plugin project:

```bash
eaos dev --config eaos.dev.ts --port 4310
```

The default dev entry is `src/index.ts`, exporting a Core `definePlugin` definition. A configured entry may instead export `{ plugin, contracts, seed, services, clients, mcp, jobs, webhooks, resolveSecret }`; `defineDevConfig` is available from `@alneas/eaos-cli/dev`. Declare Data Contracts through `schemaDependencies`. Missing contracts or SQLite migrations fail instead of silently omitting tables. `seed(adapter, principal)` runs on the first access for each tenant.

The server binds only `127.0.0.1` and rejects foreign origins/hostnames. Its API console switches Tenant A/B, Admin/Member/Guest and Free/Standard/Pro. Each tenant has a separate in-memory SQLite database using the canonical app-core adapter. Pro personas get the plugin's declared addon. A zero quota stays denied unless `monthlyQuotas` explicitly supplies a local test budget keyed by add-on/plugin ID; no production allowance is inferred. Guests are denied; this local role gate is not a reproduction of production resource permissions. Schemas, seed data, file storage and audit are disposable. It is a developer runtime for trusted code, not an OS sandbox. Secrets/jobs require a configured test host; webhook verification does not fabricate success. Optional `clients.web` and `clients.line` entries select trusted local React modules (`{entry:'src/page.tsx',exportName:'Page'}`). Web and phone-sized LINE frames use the shared PluginRuntimeProvider and TenantModuleProvider. The LINE frame supplies an explicitly labelled disposable LIFF profile. UI modules receive `principal` and `surface` props and may export a client `compute` adapter. Server config and secret ports are never imported into the UI bundle. A missing LINE module reuses the Web component in the simulator.

For MCP, pass `mcp:{registry,gatekeeper}` with exactly the current plugin and matching entitlement. The console discovers and executes the real registered tools through the Server MCP router. Each tool receives the same tenant-scoped DB/storage/audit capabilities as HTTP plus the current local principal. Guests and missing add-ons are rejected on discovery/execution. Persona switches rebuild UI sessions and reject delayed replies through the public client SDK.

Only explicitly registered `jobs` run; queued/running/completed/failed states are visible at `/__eaos/jobs/<id>` to that tenant. Job status and completion come from actual execution, with durable local audit. `webhooks` are named test validators and `resolveSecret(principal,key)` is an explicit local resolver. Missing ports reject work. No production secret environment is loaded implicitly. HTTP method selection for `usePluginApi` uses declared routes: GET without input, POST with input when available, otherwise the unique declared method. Ambiguous routes require an explicit host UI transport.


For independent schema release work, use [baseline generation](baseline.md).

## Verification

Build and install the actual tarball in an isolated consumer. Verify the declared behavior, foreign-tenant denial, stale revisions and revoked access. Importing or installing a package does not activate tenants or apply production changes.

## Troubleshooting / Common Pitfalls

Missing host bindings must fail closed. Do not substitute empty success adapters, infer addon budgets or treat a visible route as permission. Check the owning API reference and current host policy.
