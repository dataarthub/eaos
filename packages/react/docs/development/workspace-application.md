---
title: Standard Workspace application (unreleased)
description: Compose existing Appkit providers with verified Workspace presentation.
archetype: how-to
project: eaos-workspace
tags: [react, workspace, development]
---

# Standard Workspace application (unreleased)

## Prerequisites

This API is an unreleased candidate. It is excluded from default portal ingestion.
Use the matching candidate archive for verification. Install React 18.3/19,
public `@alneas/appkit-react` and `@alneas/appkit-core` 0.2.0, their declared
peers, and the Host's existing provider setup and production Appkit stylesheet.
Keep the Host's production base reset (the archive fixture uses Tailwind 4
preflight) so browser default form colors do not override the intended controls.
The entry is `@alneas/eaos-react/workspace-application`.

## Connect an existing Host

1. Create a stable `createTenantModuleStore<WorkspaceContext>` from
   `@alneas/eaos-react`. Its loader owns authenticated transport, response
   validation and any registration operation. Honor its AbortSignal before
   starting a write and after awaited operations; cancellation does not undo
   a completed server write.
2. Supply a stable frame component accepting `WorkspaceFrameProps`. Mount its
   header, leftSidebar and children below the same Appkit AuthProvider,
   QueryClientProvider, ThemeProvider and SidebarProvider. Reuse an existing
   provider frame where available; do not nest duplicate providers.
3. Render `WorkspaceApplication` with that store/frame, current pathname,
   navigate callback, outlet and the effective shipped `{pluginId,path}` pages.
   Keep actual components in the router. Optional branding, routes, login,
   navigation resolver and notice slots retain Host choices.
4. Wrap registered feature components in `WorkspaceFeatureBoundary` with their
   plugin ID. Use `projectWorkspaceNavigation` for the home-page link list with
   the same session, tenant, pages and label resolver as the sidebar.

The default exact public paths are `/signup`, `/recovery`, `/verification` and
`/callback`; descendants do not inherit exemptions. Login methods remain explicit
Host settings. The default refresh event is `focus`; provider-specific events
must be passed through `refreshEvents`. Focus listeners coalesce an in-flight refresh; session-change events invalidate it
and are removed on replacement/unmount.

## Verify identity and errors

Only public Appkit `isSessionVerified === true` plus matching tenant/user identity
can display protected content. Optimistic display data cannot admit it. Context
errors display an alert and retry rather than an empty successful workspace.
Logout and identity/provider replacement clear the existing tenant store and
obsolete replies are discarded. Same-user auth and focus refreshes preserve component identity. During refresh,
Suspense hides already-mounted content until current admission resolves; it does
not display stale content or mount new protected children. Tenant/identity changes,
denial and errors discard the old content. Initial loads use loading presentation. Platform navigation requires explicit `isSuperAdmin === true`.

Navigation intersects server-admitted plugin IDs, enabled modules, allowed
pluginAccess and effective owner pages. Cross-plugin path collisions throw;
resolver links cannot add unshipped routes. This is presentation admission only:
every backend request still requires live server authorization.

Verify provider context identity in the production module graph when combining
compatibility entries, then exercise login/sidebar/theme/logout with real
providers and synthetic network responses. A successful mocked browser journey
does not establish real provider account lifecycle or deployment readiness.
