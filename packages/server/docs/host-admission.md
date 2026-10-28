---
title: "Bind shared host admission"
description: "Supply current membership, module licensing and lifecycle providers to reusable HTTP/MCP admission helpers."
archetype: how-to
project: eaos-workspace
tags: [server, authorization, host]
---

# Bind shared host admission

Development API: use a verified candidate archive until the new exports are released.

## Prerequisites

Use Node 24 or newer and Hono. The application must authenticate identities before
binding tenant/user context and must supply live membership and activation reads.
Keep resource authorization and tenant database selection in their owning ports.

## Public import

Use `@alneas/eaos-server/extensions` for manifest composition, module licensing,
request authorization and safe client availability.

## Step-by-Step Implementation

```typescript
import { Hono } from 'hono'
import { createPluginAuthorizationMiddleware, type PluginAuthorizationOptions } from '@alneas/eaos-server/extensions'

export function bindVerifiedApplication(app: Hono, providers: PluginAuthorizationOptions) {
  // Install trusted authentication/membership middleware on app before this call.
  app.use('*', createPluginAuthorizationMiddleware(providers))
  return app
}
```

The port rechecks current membership and lifecycle activation when a principal is
resolved. Lookup failures deny access. A host-verified API-key identity retains
the host's existing user-role policy; never synthesize it from request bodies.

`createHostModulePolicy` supplies licensing middleware and a module guard. Its
optional bypass callback is an explicit application policy; the library does not
infer permission from NODE_ENV. Legacy licensing aliases and database queries
remain application-owned. Prefix restrictions match complete path segments.

`createHostManifestCatalog` removes unbound executable metadata and accepts only
reviewed route/tool bindings. `resolveClientPlugins` filters licensed, active and
tenant-owned metadata without exposing executable handlers.

## Verification

Exercise real Hono requests and MCP delegation after authentication. Verify
revoked membership/activation, foreign tenant, missing principal and stale
resource state. A visible menu or installed package never authorizes an API call.

## Troubleshooting / Common Pitfalls

- Missing trusted context produces denial; do not use a default tenant.
- Static manifests need executable host ports before their routes/tools are available.
- Private client navigation without server routes must be explicitly selected using `navigationPluginIds`.
- Domain-specific permission, transactions and database isolation remain separate requirements.
