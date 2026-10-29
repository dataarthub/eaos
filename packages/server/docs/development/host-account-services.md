---
title: "Connect Host directory and contract services"
description: "Use common Server routes/services while the application retains verified identity, persistence adapters and privileged configuration."
archetype: how-to
project: eaos-workspace
tags: [server, host, development]
---

# Connect Host directory and contract services

These are unreleased source-candidate APIs. This guide is excluded from default
released portal ingestion; use the exact verified archive until publication.

## Prerequisites

A Host is the runnable application project, not another SDK package. It supplies
real identity and database connections. Server supplies common directory
validation/admission and audited contract behavior over injected ports. Keep
company-specific schemas and provider normalization outside this public package.
Use its declared Core, Hono and selected runtime dependencies.

## Public import

```typescript
import {createUserDirectoryRoutes,type UserDirectoryRouteOptions} from '@alneas/eaos-server/platform'
import {
  createPlatformEntitlementService,
  createEntitlementAdminRoutes,
  type PlatformEntitlementServiceOptions,
  type EntitlementAdminRouteOptions,
} from '@alneas/eaos-server/entitlements'

export const directory=(ports:UserDirectoryRouteOptions)=>createUserDirectoryRoutes(ports)
export const contracts=(ports:PlatformEntitlementServiceOptions)=>createPlatformEntitlementService(ports)
export const adminRoutes=(ports:EntitlementAdminRouteOptions)=>createEntitlementAdminRoutes(ports)
```

These factories do not connect a provider, create a connection pool or apply
schema. A port type describes a required capability, not verified connectivity.

## Step-by-Step Implementation

### Connect business directory routes

Supply explicit opt-in/provider mode, current `readIdentity`, tenant-scoped
`resolveRepository` and browser origins. Mount behind trusted middleware setting
`userId`, `tenantId` and workspace context. Public code does not choose a business
table/column mapping.

| Relative route | Admission and result |
| --- | --- |
| `POST /person/ensure` | Active current membership, provider display name and tenant/identity-only idempotent registration |
| `GET /directory` | Active membership or current provider Platform administrator; at most 500 contacts |
| `POST /directory` | Current tenant or Platform administrator; allowlisted contact fields |
| `PATCH /directory/:id` | Same mutation admission; missing scoped record returns 404 |

The feature must be enabled and use explicit `kratos` membership mode; otherwise
routes return 409. Mutations require `X-EAOS-Request: user-directory`. A supplied
Origin must match the configured list. Unknown JSON fields, identity assignments
and role writes are rejected. An API-key identity cannot register an account
person. A Platform administrator without membership is not automatically enrolled.

The repository must preserve existing names, never link accounts by email and
enforce its explicit tenant arguments. Provider lookup failure returns 503 before
persistence; directory categories/contacts never grant account membership.

### Connect durable contract updates

Supply a shared control-plane `AtomicSqlDriver`, adopted manifests and current
Lifecycle callback. Install `tenantEntitlementContract` and `entitlementAuditSql`
only through reviewed schema operations. The returned service exposes read/save
and a runtime using the same atomic repository.

`save` accepts `{commandId, revision, contract}`. It validates tenant scope and
known addon/quota identifiers, checks the current revision and atomically persists
the contract with replay information and durable audit. Stale updates return 409;
audit/storage failure rolls back. Privileged caller authorization is still required
before calling this service directly.

### Mount privileged administration

`createEntitlementAdminRoutes` exposes GET/PUT
`/tenants/:tenantId/entitlements` relative to the Host's chosen prefix. Supply
current Platform admin authorization, trusted tenant existence and the service
resolver. PUT requires an allowed Origin and `X-EAOS-Request: tenant-contract`.
No request body can grant administration or substitute a foreign contract tenant.
Unclassified service failures return 503, and responses are private/no-store.

The Host chooses who may grant contracts and owns actual control-plane storage.
Server does not issue payments, activate features or infer provider state.

## Verification

Check actual Hono requests with current identity/membership, inactive/foreign
scope, read/write authority, header/origin denial and rejected body fields. Use
real temporary transactions to test command replay, CAS and audit rollback.
Type-check supported imports and exercise the exact packed export identities.
Provider and production database acceptance remain separate Host evidence.

## Troubleshooting / Common Pitfalls

- A directory row is a business person, not login or membership authority.
- Neither a repository adapter nor a contract service authorizes arbitrary direct
  callers; compose them behind trusted admission.
- Do not use a tenant business DB as an unreviewed duplicate contract authority.
- Reconcile a conflict before attempting a different mutation; do not blindly retry.
