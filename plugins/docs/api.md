---
title: "@alneas/eaos-plugins API"
description: "@alneas/eaos-plugins API: source-derived declarations, parameter tables, return types and public import examples."
sidebar:
  order: 30
archetype: "reference"
project: "eaos-workspace"
tags: ["api", "generated"]
---

<!-- Generated from public collection exports; feature symbols remain scoped to their own reference. -->

# @alneas/eaos-plugins API

## Public entrypoints

| Import | Contract |
| --- | --- |
| `@alneas/eaos-plugins/catalog.json` | Declarative feature discovery; does not load or activate a feature. |

## [MODULE] `@alneas/eaos-plugins/approval`

See [the feature reference](../approval/docs/api.md) and [feature overview](../approval/docs/index.md).

### Signature

```typescript
type PublicModule = typeof import('@alneas/eaos-plugins/approval/manifest')
```

### Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| — | — | — | Importing metadata takes no call parameters. |

### Returns

The selected feature metadata namespace. Code selection does not activate a tenant.

### Example

```typescript
import { manifest } from '@alneas/eaos-plugins/approval/manifest'

console.log(manifest.id, manifest.version)
```

## [MODULE] `@alneas/eaos-plugins/field-customization`

See [the feature reference](../field-customization/docs/api.md) and [feature overview](../field-customization/docs/index.md).

### Signature

```typescript
type PublicModule = typeof import('@alneas/eaos-plugins/field-customization/manifest')
```

### Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| — | — | — | Importing metadata takes no call parameters. |

### Returns

The selected feature metadata namespace. Code selection does not activate a tenant.

### Example

```typescript
import { manifest } from '@alneas/eaos-plugins/field-customization/manifest'

console.log(manifest.id, manifest.version)
```

## [MODULE] `@alneas/eaos-plugins/admin`

See [the feature reference](../admin/docs/api.md) and [feature overview](../admin/docs/index.md).

### Signature

```typescript
type PublicModule = typeof import('@alneas/eaos-plugins/admin/manifest')
```

### Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| — | — | — | Importing metadata takes no call parameters. |

### Returns

The selected feature metadata namespace. Code selection does not activate a tenant.

### Example

```typescript
import { manifest } from '@alneas/eaos-plugins/admin/manifest'

console.log(manifest.id, manifest.version)
```
