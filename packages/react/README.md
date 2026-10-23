# React workspaces and browser clients

[English](README.md) | [日本語](README.ja.md)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![React UI](https://img.shields.io/badge/React-149ECA?style=flat&logo=react&logoColor=white)](https://react.dev/learn) [![Bun tooling](https://img.shields.io/badge/Bun-14151A?style=flat&logo=bun&logoColor=white)](https://bun.sh/docs)

## Elevator Pitch

Application authors use React workspaces and portable clients to bind authenticated product UI.

## Why & Value

Definitions carry domain fields and commands while shared components handle presentation and session changes. Live backend checks remain mandatory. This MIT package owns its implementation and declarations in the public monorepo.

## Key Highlights

- Definition-driven workspaces
- Session-bound execution
- Browser Worker computation
- Shared help

## Quickstart

Registry installation requires a published release. During pre-publication development, install the checksum-pinned tarballs produced by the workspace build instead of assuming these names exist in a registry.

### Public import

Use Node.js 24 or later for tooling and a browser React host. This UI entry needs React and React DOM 19.2.3 or later within major 19, Appkit React exactly 0.2.0 and Lucide React. Import the Appkit stylesheet and render inside both ThemeProvider and SidebarProvider, as shown. Header presentation does not authenticate or authorize a user. The subpath is an import target, not a separately installed package.

```bash
bun add @alneas/eaos-react @alneas/appkit-react@0.2.0 react@^19.2.3 react-dom@^19.2.3 lucide-react@^1.57.0
```

Include an `appkit-styles.d.ts` containing `declare module '@alneas/appkit-react/styles';` in your TypeScript project when the bundler does not declare this CSS entry. The browser bundler still resolves and loads the real stylesheet.

```tsx
import * as React from 'react'
import '@alneas/appkit-react/styles'
import { ThemeProvider } from '@alneas/appkit-react/tools/core'
import { SidebarProvider } from '@alneas/appkit-react/tools/sidebar'
import { WorkspaceHeader, type WorkspaceHeaderProps } from '@alneas/eaos-react/workspace-layout'

export function WorkspaceExample() {
  const [language, setLanguage] = React.useState<NonNullable<WorkspaceHeaderProps['currentLanguage']>>('en')
  return <ThemeProvider><SidebarProvider>
    <WorkspaceHeader title="Workspace" currentLanguage={language} onLanguageChange={setLanguage} />
  </SidebarProvider></ThemeProvider>
}
```

Render `WorkspaceExample` from your application's React root. Portable client-only imports have different requirements; see the package guide.

## Next Steps

- [Change history](https://github.com/dataarthub/eaos/blob/main/packages/react/CHANGELOG.md)
- [Architecture and boundaries](docs/guide.md)
- [API reference](docs/api.md)
- [EAOS composition](https://tech-docs.alneas.com/eaos-workspace/architecture/)
- [Standard Workspace application (development candidate)](https://github.com/dataarthub/eaos/blob/main/packages/react/docs/development/workspace-application.md)
- [Connected workspace bindings (development candidate)](https://github.com/dataarthub/eaos/blob/main/packages/react/docs/development/workspace-bindings.md)

English questions and issue reports are welcome in the [EAOS issue tracker](https://github.com/dataarthub/eaos/issues). Do not include private tenant data, credentials or operator receipts.
