# @alneas/eaos-react

## 0.3.0

### Minor Changes

- 11f1579: Add browser-only record/command workspace composition helpers and an explicit query resource chooser. Hosts and feature owners retain operation catalogs, labels and resource scopes. Snapshot adapters validate tenant/record/revision envelopes and keep domain DTO validation with their owners. Resolve the record form schema type through the supported Appkit form props instead of a nonexistent schema subpath.
- 11f1579: Add a Host-configured workspace JSON API and connected workspace binding contract. Requests enforce safe endpoint/path construction, cancellation and deadlines; connected pages reject stale results after identity or feature-grant changes. Existing workspace and plugin runtime APIs remain supported.
- 11f1579: Add `/workspace-application` with standard login, header/sidebar composition, current-session tenant refresh, shared navigation projection and a feature boundary. Hosts supply their existing public Appkit 0.2 providers, tenant loader, router, effective pages and branding. Optimistic users and mismatched or failed tenant contexts cannot reveal protected content. Existing shell APIs remain supported.

### Patch Changes

- 11f1579: Use compatible caret ranges for distributed runtime and peer dependencies, with exact versions and integrity retained in the lockfile. Keep Appkit Core and React on their independently versioned compatible lines. Manifest and registry preflight checks now accept compatible Appkit ranges while rejecting unsupported lines. Host runtime builds preserve dynamic imports in separate chunks so optional implementations remain deferred.
- 11f1579: Compose selected connected workspace factories with required port types and exact owner/route validation. Generate selected browser bindings alongside server metadata in one transaction, rejecting edited files and preserving read-only freshness checks.
- 11f1579: Use a portable BrowserFetch call signature for workspace and verified compute asset adapters, allowing ordinary browser fetch functions when Bun adds static helpers to the global fetch type. Runtime credential, cancellation and checksum behavior remains unchanged.
- 11f1579: Preserve URL search syntax across workspace scope changes and multipart upload bodies in scoped transport. Enforce optional registered tenant restrictions in feature boundaries. Stage verified browser entries and explicit routes directly from application package registrations while retaining their tenant scope.
- Updated dependencies [11f1579]
  - @alneas/eaos-core@0.2.1

## 0.2.0

### Added

- Review AI draft edits through the owning Host approval route before saving. Bind exact inputs to current scope, resource and revision; retain pending review state and prevent duplicate saves.

### Changed

- Align English/Japanese setup and support guidance with actual package requirements; link the existing GitHub private reporting channel without adding a support guarantee.

- Declare EAOS Core ^0.2.0 explicitly and adopt Appkit React exactly 0.3.0 with Appkit Core 0.2.0.
- Align hosts with React/React DOM 19.2.3 or later, Lucide React 1.61 or later and shared Query/query-core 5.104.5.

### Upgrade

- Configure `reviewAiDraft` for AI draft saves and retain the documented Appkit stylesheet and providers. Update the host lockfile and follow Appkit's native drag migration for custom low-level drag composition.

### Security

- Update the development-only Happy DOM test dependency to 21.0.4 for GHSA-834v-8h66-3h79. Happy DOM is not a runtime dependency of the distributed React package.

## 0.1.0

### Changed

- Adopt public `@alneas/appkit-react@0.2.0` and require Node.js 24 or later. Use its supported `/tools` provider imports and `@alneas/appkit-react/styles` stylesheet.
- Compose the workspace help trigger through Base UI's `render` API. Hosts can bind `currentLanguage` and `onLanguageChange` explicitly.
- Ship complete React/React DOM 19, stylesheet and ThemeProvider/SidebarProvider setup examples, English API guides and package history.

### Fixed

- Make the scrollable help article reachable with Tab and scrollable through standard keyboard navigation.
- Keep the default workspace title compact on mobile so it cannot cover language/help controls. Preserve the full accessible title and custom host logos.

### Upgrade

- Install the exact Appkit React 0.2.0 peer, migrate legacy styles/provider imports, and supply the documented theme and sidebar providers. No additional migration is needed for the keyboard/mobile fixes.
