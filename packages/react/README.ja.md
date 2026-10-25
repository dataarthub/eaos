# eaos-react

## 概要

EAOSを組み込む開発者向けに、所有する公開機能と型付きの利用入口を提供します。

## 目的と利点

共通の実装を再利用し、業務機能とホストの接続・認可を分離します。実装の正本は公開Monorepoにあり、本番の設定や運用証拠は含めません。コードの導入、スキーマ適用、組織への有効化は別操作です。

## 主な機能

- 公開パッケージの型付きAPI
- 明示的なホスト接続と現在の認可
- パッケージ単位の検証と配布

## クイックスタート

このcheckoutは0.2.0のリリース候補です。0.1.0は公開済みですが、0.2.0の公開前はworkspaceが作成・検証したSHA固定tarballを使用してください。以下の導入コマンドは0.2.0の公開後に使用します。パッケージのsubpath自体をbun addの引数にはしません。

Node.js 24以上、および対応するCore peerとAppkit Core 0.2.0が必要です。このUI例にはReact/React DOM 19系、Appkit React 0.3.0、Lucide Reactが必要です。CSSと2つのProviderを含めて、ホストのReactルートから描画します。表示だけで認証・認可は行いません。

```bash
bun add @alneas/eaos-react@0.2.0 @alneas/eaos-core@^0.2.0 @alneas/appkit-core@0.2.0 @alneas/appkit-react@0.3.0 react@^19.2.3 react-dom@^19.2.3 lucide-react@^1.61.0
```

TypeScript環境でCSS entryの型宣言がない場合は、`declare module '@alneas/appkit-react/styles';` を記述した `appkit-styles.d.ts` をtsconfigの対象に含めてください。CSS自体はブラウザのbundlerが読み込みます。

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

## 次の手順

- [Architecture and boundaries](docs/guide.md)
- [API reference](docs/api.md)
- [EAOS composition](https://tech-docs.alneas.com/eaos-workspace/architecture/)

- [変更履歴](https://github.com/dataarthub/eaos/blob/main/packages/react/CHANGELOG.md)
