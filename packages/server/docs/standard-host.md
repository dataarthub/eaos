---
title: "Compose an authenticated Host"
description: "Start an explicitly adopted multitenant backend with injected authentication, admission and runtime capabilities."
sidebar:
  order: 35
archetype: how-to
project: eaos
tags: [server, host, authentication]
---

# Compose an authenticated Host

This guide describes an unreleased development candidate. Verify and adopt the exact tested archive before using the new `/host` entry. It is not a registry availability or deployment claim.

## Public import

The entry belongs to `@alneas/eaos-server`. Install the owning candidate or a release that exports `/host`, its declared `@alneas/eaos-core` peer and Hono. Use registry dependencies and a committed lockfile for normal consumption. Backend execution requirements and optional provider peers remain those declared by the installed owner manifests.

```typescript
import {
  createStandardHost,
  type StandardHostOptions,
} from '@alneas/eaos-server/host'

export async function startApplication(options: StandardHostOptions) {
  const { app, context } = await createStandardHost(options)
  return { app, context }
}
```

Creating a Host opens no listener, creates no credentials/pools, applies no schema migrations and activates no tenants. The application owns its process listener and any public gateway outside the authenticated app.

## Choose adopted features

Supply `adoption.manifests` from the application's effective generated catalog, together with executable route factories and selected MCP IDs. `pluginIds` omitted means exactly that supplied catalog plus trusted contributed manifests. An explicit empty array adopts nothing. Unknown or duplicate IDs and competing extension ownership reject before runtime services are constructed. Catalog growth does not implicitly add dependencies.

Already verified extension registrations retain explicit tenant restrictions. The Server validates and snapshots their metadata; it does not acquire packages, discover deployment configuration or import private implementations. Owning implementations enter through typed callbacks. Snapshots copy metadata while retaining trusted function/router references; this is not sandboxing untrusted executable code.

`createStandardHostPolicy` is the supported lower-level policy composition entry. Existing Engine and extension helpers remain available for applications that need different assembly.

## Supply real capabilities

`auth.verifier` verifies sessions/API keys. `auth.membership` resolves the authorized tenant and sets verified workspace context after authentication. Account/provider reads and database routing remain application adapters. No browser-supplied role or tenant field establishes membership by itself.

`admission.store` provides the current workspace membership store, while `loadEnabledModules` reads current licensing. Alias/path mappings and a bypass policy are explicit inputs; the standard API grants no environment-based bypass. `runtime.loadLifecycle` resolves the existing backend/tenant runtime. `runtime.createEntitlements` receives the completed selection and Lifecycle context so entitlement persistence can use the same current activation checks. Missing Lifecycle does not mean active.

Construction follows metadata validation, Lifecycle resolution, entitlement runtime construction, Engine initialization and route assembly. Rejection yields no completed app; separate startup calls have independent registries and runtime context. Settings and adapter references are copied before awaiting initialization. The functions behind those adapters remain live capabilities.

## Connect routes and tools

Authenticated requests pass through Engine authentication, optional release header, verified membership, module context and canonical plugin authorization before plugin-specific gates. Existing authentication prefix exemptions and Engine CORS behavior remain unchanged; supply the application's reviewed exact origins and skip-path configuration.

`createRoutes(context)` constructs application routers with resolved policy, Lifecycle and entitlement capabilities. These routers retain their own authorization; mounting a custom route grants no plugin permission automatically. User/admin routes, database probes and public/private business algorithms remain with their owners.

For nonempty effective MCP IDs, supply `mcp.bindPlugin` and a trusted request-local `requestContext` bridge. The standard adapter compares current tenant/user/feature admission before binding and rechecks immediately before invoking a named tool with current roles. A missing feature, denied binder or unknown tool remains unavailable. `createHostMcpToolContext` exposes the same adapter for compatible lower-level integrations; never implement its current context with a process-wide variable.

## Verify the adopted candidate

Use actual Hono requests and owning workflow tests to verify exact and nested routes, tenant-restricted extensions, HTTP/MCP records, stale writes and revoked membership. The owning public archive consumer checks `/host` runtime and strict declarations in a disposable registry/packed install. A private aggregate receipt verifies only the dependencies that it actually embeds; it does not establish adoption of a different public Server archive.

See [Host admission](host-admission.md) for the canonical membership/module primitives and [the Server README](../README.md) for package/runtime requirements. Deployment, migration and tenant activation are separate operations.
