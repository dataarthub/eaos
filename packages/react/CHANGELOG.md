# @alneas/eaos-react

## 0.2.0

### Added

- Review AI draft edits through the owning Host approval route before saving. Bind exact inputs to current scope, resource and revision; retain pending review state and prevent duplicate saves.

### Changed

- Align English/Japanese setup and support guidance with actual package requirements; document private vulnerability reporting and as-is reporting terms without a support guarantee.

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
