# @alneas/eaos-plugins

[English](README.md) | [日本語](README.ja.md)

日本語ドキュメントは[EAOSドキュメントサイト](https://tech-docs.alneas.com/ja/eaos-workspace/)で参照できます。未翻訳・レビュー待ちのページは英語表示です。未公開APIの開発ガイドはリポジトリ内に分けて掲載しています。

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Hono server](https://img.shields.io/badge/Hono-E36002?style=flat&logo=hono&logoColor=white)](https://hono.dev/docs/) [![React UI](https://img.shields.io/badge/React-149ECA?style=flat&logo=react&logoColor=white)](https://react.dev/learn)

## Elevator Pitch

Host開発者が承認・項目設定・管理機能を明示的に採用するためのMIT標準Pluginsです。

## Why & Value

1つの任意npmパッケージが3機能とその配布を所有します。サーバーfactoryとReact画面は別の入口・出力・inventoryを持ちます。永続化、本人確認、現在のresource認可はHostから渡し、コード採用とテナント有効化を分けます。

## Key Highlights

- 承認申請・判断・永続履歴
- Host所有の基底Schemaに対する項目表示設定
- 明示的に公開した管理resourceと監査履歴
- 機能別runtime・frontend入口と宣言catalog

## Quickstart

初期0.1.0候補は未公開です。公開前は検証済みtarballを使います。Node.js 24以上、Appkit Core 0.2.0、互換EAOS Core/Server ^0.1.0とHono ^4.13.13が必要です。以下のruntime接続には永続スコープ付きstore・template resolver・現在の認可・検証済みprincipal resolverを渡します。生成だけではmigrationやテナント有効化を行いません。`preset.plugins`で論理ownerを採用し、そのowner keyでtrusted loaderへbindingsを渡します。catalog.jsonは利用可能機能の記述だけです。React入口には互換EAOS React・Appkit React 0.2.0・React/React DOM ^19.2.3・Lucide ReactとAppkit CSS、認証済みAPI/session、機能Providerと必要なform/schema Providerを追加します。

```bash
bun add @alneas/eaos-plugins @alneas/appkit-core@0.2.0
```

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

## Next Steps

- [Approval feature and API](approval/README.md)
- [Field customization feature and API](field-customization/README.md)
- [Administration feature and API](admin/README.md)
- [Collection architecture](docs/architecture.md)
- [Change history](https://github.com/dataarthub/eaos/blob/main/plugins/CHANGELOG.md)

英語での質問・不具合報告も[EAOS issue tracker](https://github.com/dataarthub/eaos/issues)で受け付けます。非公開テナントデータ・資格情報・運用receiptを記載しないでください。英語READMEを正本とします。
