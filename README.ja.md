# EAOS 公開モノレポ

[English](README.md) | [日本語](README.ja.md)

[ドキュメントサイトの日本語ページ](https://tech-docs.alneas.com/ja/eaos-workspace/)でプロジェクト全体の日本語ドキュメントを案内しています。未翻訳・レビュー待ちのページは英語にフォールバックする場合があります。公開サイトは公開済みバージョンの案内であり、この README の 0.2.0 候補と一致しない場合は、対応する英語ガイドと変更履歴を確認してください。

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js minimum 24](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/about/previous-releases) [![Bun repository toolchain 1.4.3](https://img.shields.io/badge/Bun-1.4.3-000000?style=flat&logo=bun&logoColor=white)](https://bun.sh/docs)

## Elevator Pitch

EAOS は、プラグインやアプリケーションの開発者が、サーバーとブラウザのホストに認可された機能を組み込むためのフレームワークです。

## Why & Value

MIT ライセンスの4つの基盤パッケージが、純粋な契約、Server の実装、React クライアント、CLI ツールを分担します。任意の `@alneas/eaos-plugins` は、承認・フィールド表示のカスタマイズ・管理の各機能を個別に選択できるコレクションで、配布対象は合計5つの npm パッケージです。業務プラグインや本番の接続設定はそれぞれの所有者が管理し、公開コードは非公開の実装を import しません。

## Key Highlights

- `@alneas/eaos-core`: SDK、スキーマ、利用権限の契約
- `@alneas/eaos-server`: HTTP/MCP、ライフサイクル、データベース、ストレージ
- `@alneas/eaos-react`: ブラウザクライアント、ワークスペース、ヘルプ
- `@alneas/eaos-cli`: 生成、診断、ベースライン、リリースのツール

## Quickstart

この checkout は EAOS 0.2.0 のリリース準備用です。EAOS 0.1.0 は公開済みです。0.2.0 の公開までは、チェックサムを固定した候補 tarball を分離した利用環境に導入してください。Appkit Core 0.2.0 と React 0.3.0 は公開 npmjs 依存パッケージです。リポジトリの開発には Node.js 24 以上と Bun 1.4.3 を使用します。

このリポジトリのルートで、コミットされた lockfile に従って依存関係を導入し、既存の品質ゲートを実行します。

```bash
bun install --frozen-lockfile
bun run check
```

このゲートは5つのパッケージをビルドし、ソース、テスト、ドキュメント、シークレットを検査します。以下の利用者向けコマンドは 0.2.0 の公開後に使用します。

### 公開 API の import

Node.js 24 以上を使用し、必須 peer の Appkit Core 0.2.0 を導入してください。この例はプラグインを定義します。組み込みには、検証済みの識別情報、現在の認可、スコープを限定したデータアダプターを持つ信頼できるホストが必要です。subpath は import の対象であり、個別にインストールするパッケージではありません。

```bash
bun add @alneas/eaos-core@0.2.0 @alneas/appkit-core@0.2.0
```

```typescript
import { definePlugin } from '@alneas/eaos-core'

export const status = definePlugin({
  id: 'status',
  entitlement: { tier: 'public' },
  routes(router) {
    router.post('/ping', async () => ({ ready: true }))
  },
})
```

## Next Steps

- [開発と検証](CONTRIBUTING.md)
- [リリース準備](RELEASING.md)

- [標準プラグインコレクション](plugins/README.md)
- [公開 API カタログ](docs/api.md)
- [構成とアーキテクチャ](docs/architecture.md)
- [プラグインの開発](docs/plugin-authoring.md)
- [導入の検証](docs/testing.md)
- [ドキュメントの所有権と事前検査](docs/documentation.md)

英語での質問・不具合報告を [GitHub Issues](https://github.com/dataarthub/eaos/issues) で受け付けています。非公開の脆弱性報告は[セキュリティ方針](https://github.com/dataarthub/eaos/blob/main/SECURITY.md)に従ってください。
