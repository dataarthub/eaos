# CLI の開発・リリースツール

[English](https://github.com/dataarthub/eaos/blob/main/packages/cli/README.md) | [日本語](https://github.com/dataarthub/eaos/blob/main/packages/cli/README.ja.md)

[ドキュメントサイトの日本語ページ](https://tech-docs.alneas.com/ja/eaos-workspace/cli/)でプロジェクト全体の日本語ドキュメントを案内しています。未翻訳・レビュー待ちのページは英語にフォールバックする場合があります。公開サイトは公開済みバージョンの案内であり、この README の 0.2.0 候補と一致しない場合は、対応する英語ガイドと変更履歴を確認してください。

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js minimum 24](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/about/previous-releases) [![Appkit Core dependency 0.2.0](https://img.shields.io/badge/Appkit_Core-0.2.0-3178C6?style=flat)](https://www.npmjs.com/package/@alneas/appkit-core)

## Elevator Pitch

プラグインやホストの開発者は CLI を使い、EAOS パッケージの生成、診断、検証を行えます。

## Why & Value

1つのツールチェーンで、開発からリリースまでメタデータとデプロイ対象一覧を共有します。計画、実際の適用、テナントへの有効化は別々の操作です。この MIT パッケージの実装と型宣言は公開モノレポで管理します。

## Key Highlights

- プラグイン生成とサンドボックス
- チェックサム付きの配布対象一覧
- 検証済みデータベースベースライン
- OCI のリリース計画

## Quickstart

この checkout は 0.2.0 のリリース準備用です。0.1.0 は公開済みです。0.2.0 の公開まではチェックサムを固定した候補 tarball を導入し、以下のコマンドは公開後に使用してください。

### 公開 API の import

Node.js 24 以上を使用してください。以下のベースラインイメージ一覧の例には、データベース、UI provider、stylesheet、OCI 認証情報は不要です。Appkit Core 0.2.0 はパッケージの依存関係として導入されます。Pulumi/OCI peer は対応するインフラ用 entrypoint にのみ必要です。デプロイ設定の前に該当ガイドを確認してください。subpath は import の対象であり、個別にインストールするパッケージではありません。

```bash
bun add @alneas/eaos-cli@0.2.0
```

```typescript
import { baselineImages } from '@alneas/eaos-cli/baseline'

console.log(baselineImages.postgres)
console.log(baselineImages.oracle)
```

## Next Steps

- [変更履歴](https://github.com/dataarthub/eaos/blob/main/packages/cli/CHANGELOG.md)
- [アーキテクチャと境界](docs/guide.md)
- [API リファレンス](docs/api.md)
- [EAOS の構成](https://tech-docs.alneas.com/eaos-workspace/architecture/)

英語での質問・不具合報告を [GitHub Issues](https://github.com/dataarthub/eaos/issues) で受け付けています。非公開の脆弱性報告は[セキュリティ方針](https://github.com/dataarthub/eaos/blob/main/SECURITY.md)に従ってください。
