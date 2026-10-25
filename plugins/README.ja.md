# @alneas/eaos-plugins

[English](https://github.com/dataarthub/eaos/blob/main/plugins/README.md) | [日本語](https://github.com/dataarthub/eaos/blob/main/plugins/README.ja.md)

[ドキュメントサイトの日本語ページ](https://tech-docs.alneas.com/ja/eaos-workspace/plugins/)でプロジェクト全体の日本語ドキュメントを案内しています。未翻訳・レビュー待ちのページは英語にフォールバックする場合があります。公開サイトは公開済みバージョンの案内であり、この README の 0.2.0 候補と一致しない場合は、対応する英語ガイドと変更履歴を確認してください。

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js minimum 24](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/about/previous-releases) [![Hono](https://img.shields.io/badge/Hono-E36002?style=flat&logo=hono&logoColor=white)](https://hono.dev/docs/)

## Elevator Pitch

EAOS のホスト開発者は、この MIT コレクションから機能モジュールを明示的に選び、承認、フィールド表示のカスタマイズ、管理の機能を追加できます。

## Why & Value

任意の1つの npm パッケージが、3つの標準機能とそのリリースライフサイクルを管理します。機能別の subpath によって、信頼できるサーバーファクトリーと React フロントエンドを分離し、ビルド出力と配布対象一覧を個別に保ちます。永続化、検証済みの識別情報、現在のリソース認可はホストが提供します。コードの選択とテナントへの有効化は別の判断です。

## Key Highlights

- 承認の申請、判断、永続的な履歴
- ホストが所有する基礎スキーマに基づくフィールド表示のカスタマイズ
- 明示的に公開されたリソースと監査履歴の管理
- 宣言的なカタログ探索と機能別の runtime・frontend entry

## Quickstart

この checkout は `0.2.0` のリリース準備用です。`0.1.0` は公開済みです。0.2.0 の公開まではチェックサムを検証した候補 tarball を導入してください。以下のコマンドは 0.2.0 の公開後に使用します。Node.js 24 以上、Appkit Core ちょうど 0.2.0、および対応する EAOS Core/Server ^0.2.0 と Hono ^4.13.13 peer を使用します。パッケージの導入は1回で、機能別 subpath は import の対象であり個別のパッケージではありません。

```bash
bun add @alneas/eaos-plugins@0.2.0 @alneas/appkit-core@0.2.0
```

承認 runtime を実際のホストアダプターに接続してください。このラッパーには、検証済みの具体的な tenant ID と型付きの接続を渡します。ストアや認証済み principal を自動的に作成することはありません。

```typescript
import {
  createExtension as createApprovalExtension,
  type PublicPluginBindings as ApprovalBindings,
} from '@alneas/eaos-plugins/approval/runtime'

export function bindApprovalHost(
  tenantIds: string[],
  bindings: ApprovalBindings,
) {
  return createApprovalExtension({ tenantIds, bindings })
}
```

承認の接続には、永続的でスコープを限定したストア、テンプレートリゾルバー、現在の認可、検証済み principal のリゾルバーが必要です。extension の作成は必須アダプターとテナントカタログを検査しますが、マイグレーションの適用やテナントの有効化は行いません。`preset.plugins` で `@alneas/eaos-plugins/approval` などの論理的な所有者を選び、そのキーで信頼できるローダーに接続を渡してください。`catalog.json` は利用可能なモジュールを記述するだけです。

`/approval/react`、`/field-customization/react`、`/admin/react` を使う場合は、対応する `@alneas/eaos-react`、`@alneas/appkit-react@0.3.0`、React/React DOM ^19.2.3、Lucide React も導入してください。アプリケーションの境界で `@alneas/appkit-react/styles` を import します。認証済みの API・セッションの接続、機能の workspace provider、選択したビューが必要とする Appkit の form/schema provider を用意してください。詳細は各ホスト統合ガイドを確認してください。

## Next Steps

- [承認機能と API](approval/README.md)
- [フィールドカスタマイズ機能と API](field-customization/README.md)
- [管理機能と API](admin/README.md)
- [コレクションのアーキテクチャ](docs/architecture.md)
- [変更履歴](https://github.com/dataarthub/eaos/blob/main/plugins/CHANGELOG.md)

英語での質問・不具合報告を [GitHub Issues](https://github.com/dataarthub/eaos/issues) で受け付けています。非公開の脆弱性報告には [GitHubの非公開報告機能](https://github.com/dataarthub/eaos/security/advisories/new)を利用できます。
