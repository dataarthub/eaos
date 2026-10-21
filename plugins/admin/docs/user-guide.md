---
title: "Inspect an operation audit"
description: "Use an administrator account authorized for an explicitly exposed resource in the current organization."
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "how-to"]
---

# Inspect an operation audit

## Prerequisites

Use an administrator account authorized for an explicitly exposed resource in the current organization.

## Step-by-Step Implementation

1. Select the business resource and review operation, actor, time and record hash.
2. Load the next audit page when more entries are available.
3. Run the integrity check to compare the current journal chain with saved execution records.
4. Reload to confirm that saved history remains available.

## Verification

Verify that the selected resource and available history match the requested scope. The check demonstrates database-internal consistency, not an external tamper-proof attestation. Historical records outside this journal are not covered.

## Troubleshooting / Common Pitfalls

Payloads and secrets are not displayed. Revocation, disablement or failed verification clears the view and reports uncertainty. The plugin does not provide record editing, deletion or arbitrary SQL execution.

Developers configuring this screen should use the [host integration guide](maintainer-guide.md) for package imports and host requirements.
