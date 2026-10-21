---
title: "EAOS public API catalog"
description: "EAOS public API catalog: source-derived declarations, parameter tables, return types and public import examples."
sidebar:
  order: 30
archetype: "reference"
project: "eaos-workspace"
tags: ["api", "generated"]
---

<!-- Generated from public package manifests; detailed cards are owned by each package. -->

# EAOS public API catalog

## [MODULE] `@alneas/eaos-core`

See [the complete reference](../packages/core/docs/api.md) and [package overview](../packages/core/docs/index.md).

### Signature

```typescript
type PublicModule = typeof import('@alneas/eaos-core')
```

### Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| — | — | — | Importing a module takes no call parameters. |

### Returns

The public module namespace. Host-dependent functions require separately configured adapters.

### Example

```typescript
import * as API from '@alneas/eaos-core'

console.log(Object.keys(API))
```

## [MODULE] `@alneas/eaos-server`

See [the complete reference](../packages/server/docs/api.md) and [package overview](../packages/server/docs/index.md).

### Signature

```typescript
type PublicModule = typeof import('@alneas/eaos-server/lifecycle-engine')
```

### Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| — | — | — | Importing a module takes no call parameters. |

### Returns

The public module namespace. Host-dependent functions require separately configured adapters.

### Example

```typescript
import * as API from '@alneas/eaos-server/lifecycle-engine'

console.log(Object.keys(API))
```

## [MODULE] `@alneas/eaos-react`

See [the complete reference](../packages/react/docs/api.md) and [package overview](../packages/react/docs/index.md).

### Signature

```typescript
type PublicModule = typeof import('@alneas/eaos-react')
```

### Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| — | — | — | Importing a module takes no call parameters. |

### Returns

The public module namespace. Host-dependent functions require separately configured adapters.

### Example

```typescript
import * as API from '@alneas/eaos-react'

console.log(Object.keys(API))
```

## [MODULE] `@alneas/eaos-cli`

See [the complete reference](../packages/cli/docs/api.md) and [package overview](../packages/cli/docs/index.md).

### Signature

```typescript
type PublicModule = typeof import('@alneas/eaos-cli/baseline')
```

### Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| — | — | — | Importing a module takes no call parameters. |

### Returns

The public module namespace. Host-dependent functions require separately configured adapters.

### Example

```typescript
import * as API from '@alneas/eaos-cli/baseline'

console.log(Object.keys(API))
```

## [MODULE] `@alneas/eaos-plugins`

See [the complete reference](../plugins/docs/api.md) and [package overview](../plugins/docs/index.md).

### Signature

```typescript
type PublicModule = typeof import('@alneas/eaos-plugins/approval/manifest')
```

### Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| — | — | — | Importing a module takes no call parameters. |

### Returns

The public module namespace. Host-dependent functions require separately configured adapters.

### Example

```typescript
import * as API from '@alneas/eaos-plugins/approval/manifest'

console.log(Object.keys(API))
```

