---
title: "Author and package a plugin"
description: "Use Bun and the public Core/CLI packages, plus Hono and React for the corresponding surfaces. Before publication, install checksum-pinned tarballs produced by the workspace build; registry coordinates in examples require an available release. Prepare a trusted host with real persistence, identity..."
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "how-to"]
---

# Author and package a plugin

## Prerequisites

Use Bun and the public Core/CLI packages, plus Hono and React for the corresponding surfaces. Before publication, install checksum-pinned tarballs produced by the workspace build; registry coordinates in examples require an available release. Prepare a trusted host with real persistence, identity and authorization adapters.

## Public import

Install the package; the subpath below is an import target, not a separate package. Registry installation requires a published EAOS release; before publication use the owning workspace's checksum-verified build artifact.

```bash
bun add @alneas/eaos-core
```

```typescript
import { definePlugin } from '@alneas/eaos-core'

export const plugin = definePlugin({
  id: 'notes',
  entitlement: { tier: 'public' },
  routes(router) {
    router.post('/ping', async () => ({ ready: true }))
  },
})
```

Core declarations are framework-free. Install the CLI separately for generation; Hono and React are needed only by the corresponding server/UI surfaces.

## Step-by-Step Implementation

```bash
bun add @alneas/eaos-core hono react
bun add -d @alneas/eaos-cli
bun run eaos plugin generate --name notes
bun run eaos plugin diagnose --plugin notes --check
```

The generated `plugins/notes` contains metadata, API/MCP declarations, service contracts, UI drafts, guides and deployment inventory. It is a stateless starting point. Implement persistence, business rules, host bindings, build settings and public exports before adoption.

Declare stable operation names, input/output schemas, required permissions and side-effect categories with the [Core SDK](../packages/core/docs/plugin-sdk.md). Metadata inspection must not execute handlers or load secrets. Bind verified principals and current lifecycle/resource authorization on HTTP, MCP, jobs and webhooks; never accept tenant identity or roles from request bodies.

Reuse Appkit Core for schema/data/storage adapters, Appkit React for UI, and EAOS Server for CAS, audit and Outbox. Inject provider connections explicitly. Avoid a second implementation of these generic services inside a plugin.

Own physical tables in versioned Data Contracts. Declare `schemaDependencies`, tenant columns, JSON namespaces, references and limits separately from feature dependencies. Append migrations; never edit applied SQL. Installation and tenant activation remain separate.

Use React workspace definitions and common help instead of copying screens. Register browser/LINE routes at build time and check live access at runtime. Native hosts own the operation catalog, executable distribution and filesystem policy; failures do not authorize server fallback.

The standard approval, field-customization and admin implementations belong to
`@alneas/eaos-plugins`, using explicit feature selectors such as
`@alneas/eaos-plugins/approval`. The collection owns one package manifest and
release; its declarative catalog does not activate features. A generated custom
plugin remains a separate author-owned package unless deliberately integrated
into a collection.

Generate with `--tier public|standard|pro|corporate`. Public names use `@alneas/eaos-plugin-*`; Standard and Pro use `@dataarthub/plugin-*` and `@dataarthub/pro-*`. Corporate packages are private and require an explicit allowlist. Pro addon grants and budgets are explicit; zero quota admits no metered executions.

## Verification

```bash
bun run eaos plugin sync-agents --plugin notes
bun run eaos plugin diagnose --plugin notes --check
bun run eaos plugin detect-secrets --plugin notes --check
```

Install the actual tarball into an isolated consumer. Verify exports, JavaScript, declarations, resources and inventory hashes. Exercise restart/persistence, cross-tenant denial, authorization revocation and stale revisions with real local stores. Keep user guides and maintainer guides in their owning package.

## Troubleshooting / Common Pitfalls

- A generated manifest is not evidence of a working business workflow. Connect real host ports before acceptance.
- A visible route is not an authorization grant. Recheck access before commit and before returning results.
- A native failure is not permission to upload data. Register fallback explicitly when the product requires it.
- Missing unpublished packages require pinned build artifacts, not source aliases.

See [composition boundaries](architecture.md), [local development](../packages/cli/docs/plugin-dev.md) and [verification](testing.md).
