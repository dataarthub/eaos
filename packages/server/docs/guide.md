---
title: "Server boundaries"
description: "Hono/MCP, identity integration, durable CAS/audit/Outbox, lifecycle, database and scoped storage implementations. Business plugins, customer data, credentials, actual infrastructure settings and operator receipts remain outside this public package."
sidebar:
  order: 20
archetype: "explanation"
project: "eaos-workspace"
tags: ["eaos", "explanation"]
---

# Server boundaries

## Motivation

Hono/MCP, identity integration, durable CAS/audit/Outbox, lifecycle, database and scoped storage implementations. Business plugins, customer data, credentials, actual infrastructure settings and operator receipts remain outside this public package.

## Architectural Diagram

```mermaid
flowchart LR
  Contract[Public contract] --> Host[Verified host bindings]
  Host --> Runtime[Scoped runtime operation]
  Runtime --> Evidence[Durable result and audit]
```

## Public import

Install the package; the subpath below is an import target, not a separate package. Registry installation requires a published EAOS release; before publication use the owning workspace's checksum-verified build artifact.

```bash
bun add @alneas/eaos-server
```

```typescript
import { createSdkPluginRouter } from '@alneas/eaos-server/plugin-sdk'

export const bindSdkRouter = createSdkPluginRouter
```

Server runtime only. Install the package's Hono dependency and provide verified identity, scoped context and current authorization.

## Trade-offs & Decisions

The host supplies verified identity and current lifecycle/resource authorization. CAS rejects stale revisions; durable host stores retain audit and Outbox. Provider connections and secrets are injected through trusted ports.

Code installation, database/infrastructure application and tenant activation are separate operations. Import/build/test/install do not perform production migrations or infrastructure updates. Before registry publication, build and test checksum-pinned tarballs in isolated consumers instead of linking sibling source.

See [live entitlements](entitlements.md), [database boundaries](db/docs/guide.md), [lifecycle](lifecycle/docs/guide.md) and [storage](storage/docs/guide.md).

## User directory connection

`createUserDirectoryRoutes` from `@alneas/eaos-server/platform` provides the common `/person/ensure` and `/directory` routes. Mount it behind trusted `userId`/`tenantId` middleware. Supply explicit feature/provider mode, allowed browser origins, a current normalized provider identity reader and a tenant-scoped `DirectoryRepository`. The repository owns database column mapping; the public service contains no business table names. Writes require current administrator authority and `X-EAOS-Request: user-directory`. Contacts and person categories never grant account access.

Registration requires an actual provider display name and preserves an existing business name. Repositories must identify an account person only by tenant and provider identity, never by email. Provider failures return 503 without touching the repository; inactive memberships are denied before any directory operation.
