---
title: "Connect workspace pages"
description: "Supply explicit Host identity and API capabilities to connected feature pages."
archetype: how-to
project: eaos-workspace
tags: [react, workspace, development]
---

# Connect workspace pages

Development API: use a verified candidate archive containing these exports until
the corresponding release is published. This guide is not registered for released
portal ingestion.

## Prerequisites

Use React with the package's declared peers, its canonical verified Host context,
and a credentialed backend that independently enforces membership, feature
admission and resource permissions. Keep the existing authentication provider and
tenant store. Page registration never activates a feature.

## Step-by-Step Implementation

Create a browser API through the public client entry:

```typescript
import {createWorkspaceApi} from '@alneas/eaos-react/client'
export const api=createWorkspaceApi({endpoint:'/api/plugins',timeoutMs:15000})
```

The endpoint is a same-origin root-relative path or credential-free HTTPS URL,
without query or fragment. `request` uses a plugin-relative path; encode each
record ID before appending it. `command` appends the encoded operation and POSTs
its input. Both return parsed JSON typed by the caller; the feature must validate
its DTOs. Non-OK responses throw `WorkspaceApiError` with a status, without exposing
arbitrary provider error bodies.

Pass a `WorkspaceBindingEnvironment` to each adopted feature's connected factory.
Its `useIdentity` reads the existing verified context and returns tenant/user IDs,
session generation, roles and currently admitted feature IDs; return null while
identity is unverified or unavailable. `selectedIds` is explicit build adoption.
The Host supplies router query read/replace callbacks separately.

```typescript
import {useWorkspaceConnection,type WorkspaceBindingEnvironment} from '@alneas/eaos-react/workspace-binding'

export function useReportRequests(environment:WorkspaceBindingEnvironment){
 const connection=useWorkspaceConnection(environment)
 return {
  identity:connection.identity,
  read:()=>connection.request({pluginId:'reports',path:'/snapshot'}),
 }
}
```

Call the hook inside the feature's connected component. Its scoped connection
checks both current grants and adoption, cancels on scope change/unmount and
discards stale responses. It holds no tenant or snapshot cache. Existing
workspace Providers retain their canonical response-order and revision checks.

### Reuse record and command composition

The `/workspace-binding/record` entry provides `createRecordWorkspaceClient`,
`createRecordReferenceClient` and `createRecordWorkspacePages`. Supply the exact
owner list command, declared routes and existing Providers. References require
an explicit selected owner/list catalog and current feature admission.

The `/workspace-binding/command` entry provides `createCommandWorkspaceClient`,
`createCommandWorkspacePages` and `WorkspaceScope`. Owners declare their aggregate
route and any query field, resource label and submit label. Scope values stay
pinned through command/reload, and changing the chosen resource remounts its
content, discarding the previous draft and cancelling connected work.

Command adapters check tenant, record ID and revision and normalize raw or
enveloped snapshots. Their generic data type is the owner's transport contract,
not runtime validation of arbitrary business fields. Owners keep their canonical
DTO validation. These composition helpers do not import feature implementations.

## Verification

Test identity change during reads and command/reload chains, revoked grants,
unmount, malformed JSON, HTTP 403/409 and stalled transports. Verify actual
browser imports and packed exports with the Host bundler. The request deadline
defaults to 15000 ms; an abort cannot prove a remote write was rolled back.

## Troubleshooting / Common Pitfalls

- An unavailable connection requires fresh verified context; do not replace it
  with cached identity or dummy success data.
- A forbidden or conflict response is an error for owner presentation, not an
  empty dataset. Reconcile uncertain writes before retrying them.
- Keep server/database code and credentials outside browser entrypoints.
- Feature-specific renderers and workers remain explicit adopter ports.
