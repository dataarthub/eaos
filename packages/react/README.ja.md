# React workspaces and browser clients

[English](README.md) | [日本語](README.ja.md)

日本語ドキュメントは[EAOSドキュメントサイト](https://tech-docs.alneas.com/ja/eaos-workspace/)で参照できます。未翻訳・レビュー待ちのページは英語表示です。未公開APIの開発ガイドはリポジトリ内に分けて掲載しています。

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![React UI](https://img.shields.io/badge/React-149ECA?style=flat&logo=react&logoColor=white)](https://react.dev/learn) [![Bun tooling](https://img.shields.io/badge/Bun-14151A?style=flat&logo=bun&logoColor=white)](https://bun.sh/docs)

## Elevator Pitch

認証済みの業務UIを組み込むためのReact Workspaceとブラウザークライアントです。

## Why & Value

業務定義が項目とコマンドを持ち、共通部品が表示とセッション変更を扱います。バックエンドの現在の認可確認は引き続き必須です。実装と型定義の正本は公開MIT monorepoです。

## Key Highlights

- 定義から組み立てるWorkspace
- セッションに結び付いた実行
- ブラウザーWorker計算
- 共通ヘルプ

## Quickstart

ツール実行にはNode.js 24以上が必要です。このUI例にはReact/React DOM 19.2.3以上の19系、Appkit React 0.2.0、Lucide Reactが必要です。Appkit CSSを読み込み、ThemeProviderとSidebarProviderの両方で囲んでアプリのReactルートから描画します。ヘッダー表示自体は認証・認可を行いません。公開前は検証済み候補アーカイブを使います。CSS型宣言がない環境ではappkit-styles.d.tsへ `declare module '@alneas/appkit-react/styles';` を追加します。実CSSはbundlerが解決します。クライアント専用importの要件は別です。

```bash
bun add @alneas/eaos-react @alneas/appkit-react@0.2.0 react@^19.2.3 react-dom@^19.2.3 lucide-react@^1.57.0
```

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

## Next Steps

- [Change history](https://github.com/dataarthub/eaos/blob/main/packages/react/CHANGELOG.md)
- [Architecture and boundaries](docs/guide.md)
- [API reference](docs/api.md)
- [EAOS composition](https://tech-docs.alneas.com/eaos-workspace/architecture/)
- [Standard Workspace application (development candidate)](https://github.com/dataarthub/eaos/blob/main/packages/react/docs/development/workspace-application.md)
- [Connected workspace bindings (development candidate)](https://github.com/dataarthub/eaos/blob/main/packages/react/docs/development/workspace-bindings.md)

英語での質問・不具合報告も[EAOS issue tracker](https://github.com/dataarthub/eaos/issues)で受け付けます。非公開テナントデータ・資格情報・運用receiptを記載しないでください。英語READMEを正本とします。
