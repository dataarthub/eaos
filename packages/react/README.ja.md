# React ワークスペースとブラウザクライアント

[English](https://github.com/dataarthub/eaos/blob/main/packages/react/README.md) | [日本語](https://github.com/dataarthub/eaos/blob/main/packages/react/README.ja.md)

[ドキュメントサイトの日本語ページ](https://tech-docs.alneas.com/ja/eaos-workspace/react/)でプロジェクト全体の日本語ドキュメントを案内しています。未翻訳・レビュー待ちのページは英語にフォールバックする場合があります。公開サイトは公開済みバージョンの案内であり、この README の 0.2.0 候補と一致しない場合は、対応する英語ガイドと変更履歴を確認してください。

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js minimum 24](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/about/previous-releases) [![React peer major 19](https://img.shields.io/badge/React-19-149ECA?style=flat&logo=react&logoColor=white)](https://react.dev/)

## Elevator Pitch

アプリケーション開発者は React ワークスペースとホストに依存しないクライアントを使い、認証された製品 UI を接続できます。

## Why & Value

定義がドメインのフィールドとコマンドを表し、共通コンポーネントが表示とセッションの変更を扱います。バックエンドによる現在の状態の検査は引き続き必須です。この MIT パッケージの実装と型宣言は公開モノレポで管理します。

## Key Highlights

- 定義に基づくワークスペース
- セッションに結び付いた実行
- ブラウザ Worker による計算
- 共通ヘルプ

## Quickstart

この checkout は 0.2.0 のリリース準備用です。0.1.0 は公開済みです。0.2.0 の公開まではチェックサムを固定した候補 tarball を導入し、以下のコマンドは公開後に使用してください。

### 公開 API の import

ツールには Node.js 24 以上を使用し、ブラウザの React ホストを用意してください。対応する Core peer と Appkit Core 0.2.0 を導入します。この UI entry には、19 系の React と React DOM 19.2.3 以上、Appkit React ちょうど 0.3.0、および Lucide React が必要です。例のとおり Appkit の stylesheet を import し、ThemeProvider と SidebarProvider の両方の内側で描画してください。ヘッダーの表示だけでは利用者の認証や認可は行いません。subpath は import の対象であり、個別にインストールするパッケージではありません。

```bash
bun add @alneas/eaos-react@0.2.0 @alneas/eaos-core@^0.2.0 @alneas/appkit-core@^0.2.2 @alneas/appkit-react@^0.3.1 react@^19.2.3 react-dom@^19.2.3 lucide-react@^1.61.0
```

bundler がこの CSS entry の型を宣言しない場合は、`declare module '@alneas/appkit-react/styles';` を記述した `appkit-styles.d.ts` を TypeScript プロジェクトに含めてください。ブラウザの bundler は実際の stylesheet を解決して読み込みます。

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

アプリケーションの React ルートから `WorkspaceExample` を描画してください。クライアント専用の import は要件が異なるため、パッケージガイドを確認してください。

## Next Steps

- [変更履歴](https://github.com/dataarthub/eaos/blob/main/packages/react/CHANGELOG.md)
- [アーキテクチャと境界](docs/guide.md)
- [API リファレンス](docs/api.md)
- [EAOS の構成](https://tech-docs.alneas.com/eaos-workspace/architecture/)

英語での質問・不具合報告を [GitHub Issues](https://github.com/dataarthub/eaos/issues) で受け付けています。非公開の脆弱性報告には [GitHubの非公開報告機能](https://github.com/dataarthub/eaos/security/advisories/new)を利用できます。
