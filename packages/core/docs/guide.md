---
title: "Pure contracts and SDK"
description: "Plugin SDK, schema ownership, entitlement contracts and shared event types. Core never imports Server or a database implementation. Business plugins, customer data, credentials, actual infrastructure settings and operator receipts remain outside this public package."
sidebar:
  order: 20
archetype: "explanation"
project: "eaos-workspace"
tags: ["eaos", "explanation"]
---

# Pure contracts and SDK

## Motivation

Plugin SDK, schema ownership, entitlement contracts and shared event types. Core never imports Server or a database implementation. Business plugins, customer data, credentials, actual infrastructure settings and operator receipts remain outside this public package.

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
bun add @alneas/eaos-core
```

```typescript
import { definePlugin } from '@alneas/eaos-core'

export const defineFeature = definePlugin
```

Pure contracts run in server and browser hosts. Supply verified capabilities at the host boundary.

## Trade-offs & Decisions

The host supplies verified identity and current lifecycle/resource authorization. CAS rejects stale revisions; durable host stores retain audit and Outbox. Provider connections and secrets are injected through trusted ports.

Code installation, database/infrastructure application and tenant activation are separate operations. Import/build/test/install do not perform production migrations or infrastructure updates. Before registry publication, build and test checksum-pinned tarballs in isolated consumers instead of linking sibling source.


See the [declarative SDK](plugin-sdk.md) for policy and scoped context contracts.
