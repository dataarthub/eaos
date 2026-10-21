---
title: "Verify package and host adoption"
description: "Build the packages and pin one immutable artifact hash for every check. Provide disposable local stores and explicit host adapters. Production credentials and real tenant activation are outside ordinary package verification."
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "how-to"]
---

# Verify package and host adoption

## Prerequisites

Build the packages and pin one immutable artifact hash for every check. Provide disposable local stores and explicit host adapters. Production credentials and real tenant activation are outside ordinary package verification.

## Public import

Install the package; the subpath below is an import target, not a separate package. Registry installation requires a published EAOS release; before publication use the owning workspace's checksum-verified build artifact.

```bash
bun add @alneas/eaos-core
```

```typescript
import { createPluginTestHarness } from '@alneas/eaos-core/testing'

export const createHostHarness = createPluginTestHarness
```

The pure harness does not supply authentication or persistence. Pass real scoped test capabilities and an isolation probe for persistence checks; test HTTP admission separately.

## Step-by-Step Implementation

| Layer | Check | Evidence scope |
| --- | --- | --- |
| Package | Declarations, pure calculations, validation and revocation | Owning source and declared dependencies |
| Archive | Exports, JavaScript/types/resources, manifest and secret exclusion | Exact tarball bytes |
| Isolated consumer | Real tarball installation, execution, types and browser bundle | Pinned package interoperability |
| Persistence and lifecycle | Database, CAS, audit/Outbox, restart, dirty/stale plans | Selected local store and environment |
| UI | Load, input, save, reload, cancellation and foreign-tenant denial | Exercised screens and host ports |
| Deployed host | Identity, providers, DNS/TLS and target acceptance | Explicit environment and deployment |

Verify that identical record IDs do not cross tenant boundaries, revoked access blocks commit, and stale revisions cannot overwrite current data. Storage must reject scope escapes, foreign cursors, public uploads and excessive signed-URL lifetimes. UI must discard old responses after logout or context changes.

Reject edited/stale lifecycle plans, changes to applied migrations and automatic dirty-DDL retries. A database rollback does not undo an external delivery. Use registered native/training fixtures without treating synthetic model results as production accuracy or tenant acceptance.

## Verification

```bash
bun run eaos platform:deployment-plan --help
bun run eaos platform:deployment-status --help
bun run eaos platform:deployment-record --help
```

Assign inventory components/tasks to declared targets and append evidence to the existing journal. Record the artifact, operation and environment. Distinguish code installation, local DB checks, actual application, activation and business acceptance. Preserve old evidence when testing a new artifact.

## Troubleshooting / Common Pitfalls

Line coverage measures executed source lines; compiled dependencies may be counted separately. Unit tests and SSR do not prove every interactive screen, identity provider or deployed integration. Investigate untested failure/recovery paths rather than adding assertions solely to increase coverage. Retain uncertainty when an external result cannot be determined.
