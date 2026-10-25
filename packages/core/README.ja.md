# Core の契約とプラグイン SDK

[English](https://github.com/dataarthub/eaos/blob/main/packages/core/README.md) | [日本語](https://github.com/dataarthub/eaos/blob/main/packages/core/README.ja.md)

[ドキュメントサイトの日本語ページ](https://tech-docs.alneas.com/ja/eaos-workspace/core/)でプロジェクト全体の日本語ドキュメントを案内しています。未翻訳・レビュー待ちのページは英語にフォールバックする場合があります。公開サイトは公開済みバージョンの案内であり、この README の 0.2.0 候補と一致しない場合は、対応する英語ガイドと変更履歴を確認してください。

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js minimum 24](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/about/previous-releases) [![Appkit Core peer 0.2.0](https://img.shields.io/badge/Appkit_Core-0.2.0-3178C6?style=flat)](https://www.npmjs.com/package/@alneas/appkit-core)

## Elevator Pitch

プラグイン開発者は Core を使い、ホストに依存しない機能、データの所有権、利用権限の契約を宣言できます。

## Why & Value

純粋な契約は Server、データベースドライバー、ブラウザ UI に依存せず利用できます。識別情報と実際の実行能力は信頼できるホストが提供します。この MIT パッケージの実装と型宣言は公開モノレポで管理します。

## Key Highlights

- 純粋なプラグイン SDK
- バージョン管理されたデータ契約
- 利用権限の契約
- 分離したテストハーネス

## Quickstart

この checkout は 0.2.0 のリリース準備用です。0.1.0 は公開済みです。0.2.0 の公開まではチェックサムを固定した候補 tarball を導入し、以下のコマンドは公開後に使用してください。

### 公開 API の import

Node.js 24 以上を使用し、必須 peer の Appkit Core 0.2.0 を導入してください。この例はプラグインを定義します。組み込みには、検証済みの識別情報、現在の認可、スコープを限定したデータアダプターを持つ信頼できるホストが必要です。subpath は import の対象であり、個別にインストールするパッケージではありません。

```bash
bun add @alneas/eaos-core@0.2.0 @alneas/appkit-core@0.2.0
```

```typescript
import { definePlugin } from '@alneas/eaos-core'

export const notes = definePlugin({
  id: 'notes',
  entitlement: { tier: 'public' },
  routes(router) {
    router.post<{ id: string }>('/read', async (ctx, input) =>
      ctx.db.findOne('notes', input.id))
  },
})
```

## Next Steps

- [変更履歴](https://github.com/dataarthub/eaos/blob/main/packages/core/CHANGELOG.md)
- [アーキテクチャと境界](docs/guide.md)
- [API リファレンス](docs/api.md)
- [EAOS の構成](https://tech-docs.alneas.com/eaos-workspace/architecture/)

英語での質問・不具合報告を [GitHub Issues](https://github.com/dataarthub/eaos/issues) で受け付けています。非公開の脆弱性報告には [GitHubの非公開報告機能](https://github.com/dataarthub/eaos/security/advisories/new)を利用できます。
