---
title: "React workspaces and browser clients"
description: "Application authors use React workspaces and portable clients to bind authenticated product UI."
sidebar:
  order: 20
archetype: "explanation"
project: "eaos-workspace"
tags: ["eaos","explanation"]
---

<!-- Generated from packages/react/README.md; edit the README and run docs:readmes:prepare. -->

# React workspaces and browser clients

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js minimum 24](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/about/previous-releases) [![React peer major 19](https://img.shields.io/badge/React-19-149ECA?style=flat&logo=react&logoColor=white)](https://react.dev/)

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

This checkout prepares version 0.2.0; version 0.1.0 is already published. Until 0.2.0 is published, install the checksum-pinned candidate tarball. The command below applies after that release.

### Public import

Use Node.js 24 or later for tooling and a browser React host. Install the matching Core peer and Appkit Core 0.2.0. This UI entry needs React and React DOM 19.2.3 or later within major 19, Appkit React exactly 0.3.0 and Lucide React. Import the Appkit stylesheet and render inside both ThemeProvider and SidebarProvider, as shown. Header presentation does not authenticate or authorize a user. The subpath is an import target, not a separately installed package.

```bash
bun add @alneas/eaos-react@^0.3.0 @alneas/eaos-core@^0.2.1 @alneas/appkit-core@^0.2.2 @alneas/appkit-react@^0.3.1 react@^19.2.3 react-dom@^19.2.3 lucide-react@^1.61.0
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
- [Architecture and boundaries](guide.md)
- [API reference](api.md)
- [EAOS composition](https://tech-docs.alneas.com/eaos-workspace/architecture/)

Questions and issue reports in English are welcome in [GitHub Issues](https://github.com/dataarthub/eaos/issues). Private vulnerability reports can use [GitHub private reporting](https://github.com/dataarthub/eaos/security/advisories/new).
