# @alneas/eaos-react

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
