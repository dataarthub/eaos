---
title: "Configure additional field presentation"
description: "Use an administrator account with current organization/resource permission. Review the meaning, unit and impact of each field with the people entering data."
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "how-to"]
---

# Configure additional field presentation

## Prerequisites

Use an administrator account with current organization/resource permission. Review the meaning, unit and impact of each field with the people entering data.

## Step-by-Step Implementation

1. Select the allowed business resource and one of its permitted fields.
2. Edit the display label, placeholder or help text.
3. Save and reload the configuration. Required base fields cannot be hidden; base types and required validation cannot be changed.

## Verification

Confirm the new presentation in a consuming business screen while stored values and validation retain their meaning. Saving presentation settings and saving a business record are separate operations.

## Troubleshooting / Common Pitfalls

A label change does not migrate old data. Reload after stale revisions, revoked access or feature disablement. This screen cannot edit another organization's settings or arbitrary database columns.

Developers configuring this screen should use the [host integration guide](maintainer-guide.md) for package imports and host requirements.
