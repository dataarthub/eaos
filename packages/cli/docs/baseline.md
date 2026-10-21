---
title: "Generate a verified multi-dialect baseline"
description: "Use a trusted, database-scoped Data Contract JSON file and a newer target version. SQLite runs in memory. PostgreSQL and Oracle require a running local Docker Unix-socket context and preloaded, checksum-pinned images. No remote database URL, existing container, host mount or published port is acc..."
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "how-to"]
---

# Generate a verified multi-dialect baseline

## Prerequisites

Use a trusted, database-scoped Data Contract JSON file and a newer target version. SQLite runs in memory. PostgreSQL and Oracle require a running local Docker Unix-socket context and preloaded, checksum-pinned images. No remote database URL, existing container, host mount or published port is accepted.

The CLI exports `baselineImages` from `@alneas/eaos-cli/baseline`. Preload those digests with Docker before running the command. Image acquisition is an explicit operator step; generation uses `--pull=never`. Optional `--postgres-image` and `--oracle-image` flags select other **digest-pinned local** compatible images.

## Public import

Install the package; the subpath below is an import target, not a separate package. Registry installation requires a published EAOS release; before publication use the owning workspace's checksum-verified build artifact.

```bash
bun add @alneas/eaos-cli
```

```typescript
import { baselineImages } from '@alneas/eaos-cli/baseline'

export const requiredImages = baselineImages
```

Run with Bun in a trusted local project. Docker is required for PostgreSQL/Oracle, not SQLite. This import lists image configuration and does not download or run images.

## Step-by-Step Implementation

```bash
eaos db:baseline --contract data-contract.json --version 1.1.0 --out releases/baseline-1.1.0
```

The compiler processes **every declared dialect**. It applies the original history in an empty database, exports the final schema, rebuilds that export in an independent empty database and compares the resulting metadata. PostgreSQL uses `pg_dump --schema-only`; Oracle uses `DBMS_METADATA`. Oracle receives a private IP on a task-owned internal network because its database cannot boot with no network interface. PostgreSQL uses `network=none`. Neither database publishes ports or receives production credentials.

The new directory contains `baseline.json`, the target `contract.json`, archived original contract JSON, dialect SQL files and `verification.json`. Existing output directories are rejected. The original source remains unchanged. No existing database or migration ledger is modified.

## Verification

Check that every `verification.json` compiler reports `rebuilt: true`, and retain the entire directory with the release. Verify the archived source and replaced migration IDs, positions and checksums before adopting the target contract. Tables, final generated columns, indexes, composite foreign keys, views and triggers are rebuilt; PostgreSQL dumps also retain row-level security policies and function definitions.

To advance an already applied ledger, use the [baseline descriptor/rebase contract](../../server/docs/lifecycle/docs/baseline.md) and the host's existing writer-lock and drain workflow. Rebase is a separate host operation: exact applied history is required, old evidence is retained and no DDL runs during ledger rebase. Generation never performs production rebase or tenant activation.

## Troubleshooting

- **Image unavailable:** preload the exported image digest or supply a compatible local digest override. Floating tags are rejected.
- **Oracle startup timeout:** allow sufficient local CPU, disk and memory; the first boot expands its database files. The default startup limit is ten minutes.
- **Seed or data history:** move data migrations into a separately reviewed process. An automatic schema baseline must not discard seeded rows.
- **Metadata differs:** generation stops. Do not treat partial output as an approved baseline. Oracle comparison disregards only independent inline constraint ordering; it preserves column order, expressions, constraints and other DDL.
- **Unsupported Oracle object or VPD policy:** generation refuses to omit it. Host security policies and unsupported object classes need an explicit provider compiler/adoption process. Grants, production roles, physical storage and credentials remain host-owned.

Task-owned containers, volumes and internal networks are removed after success or failure. A force-killed CLI may require removing only the containers/networks identified by its `org.alneas.eaos.baseline` label.
