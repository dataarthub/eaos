# @alneas/eaos-plugins/admin

[English](https://github.com/dataarthub/eaos/blob/main/plugins/admin/README.md) | [日本語](https://github.com/dataarthub/eaos/blob/main/plugins/admin/README.ja.md)

[ドキュメントサイトの日本語ページ](https://tech-docs.alneas.com/ja/eaos-workspace/plugins/admin/)でプロジェクト全体の日本語ドキュメントを案内しています。未翻訳・レビュー待ちのページは英語にフォールバックする場合があります。公開サイトは公開済みバージョンの案内であり、この README の 0.2.0 候補と一致しない場合は、対応する英語ガイドと変更履歴を確認してください。

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js minimum 24](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/about/previous-releases) [![Hono](https://img.shields.io/badge/Hono-E36002?style=flat&logo=hono&logoColor=white)](https://hono.dev/docs/)

## Elevator Pitch

管理者は汎用の管理プラグインを使い、明示的に公開されたリソースと監査履歴を確認できます。

## Why & Value

これは共通の[標準プラグインコレクション](https://github.com/dataarthub/eaos/blob/main/plugins/README.md)の機能ガイドであり、個別に公開されるパッケージではありません。MIT の実装は、信頼できる principal、現在の有効化状態、リソース認可の契約をホストと共有します。永続ストアと監査は明示的なホストの接続です。インストールによってテナントが有効化されたり業務ワークフローが実行されたりすることはありません。

## Key Highlights

- 汎用 API と React entrypoint
- ホストが制御するリソースアクセス
- 永続的な履歴と古い revision の検査
- チェックサム付きのデプロイ対象一覧

## Quickstart

この機能は `@alneas/eaos-plugins@0.2.0` のリリース候補に含まれます。0.1.0 は公開済みです。新しいバージョンが利用可能になるまでは、チェックサムを検証した 0.2.0 の tarball を使用してください。

### 公開 API の import

Node.js 24 以上を使用してください。この manifest のみを使う例はメタデータを読むもので、UI、認証情報、テナントの有効化は不要です。Appkit Core 0.2.0 は、依存する Core/Server の必須 peer です。任意の /react entry を使う場合は、@alneas/eaos-react、@alneas/appkit-react@0.3.0、React/React DOM ^19.2.3、Lucide React も導入し、@alneas/appkit-react/styles を import して、ホスト統合ガイドに記載された provider を使用してください。`@alneas/eaos-plugins` の導入は1回で、`/admin` とその下の subpath がこの機能を選びます。subpath は import の対象であり、個別にインストールするパッケージではありません。

```bash
bun add @alneas/eaos-plugins@0.2.0 @alneas/appkit-core@0.2.0
```

```typescript
import { manifest } from '@alneas/eaos-plugins/admin/manifest'

console.log(manifest.id, manifest.version)
```

## Next Steps

- [変更履歴](https://github.com/dataarthub/eaos/blob/main/plugins/admin/CHANGELOG.md)
- [利用者ガイド](docs/user-guide.md)
- [ホスト統合](docs/maintainer-guide.md)
- [API リファレンス](docs/api.md)
- [アーキテクチャ](docs/guide.md)

英語での質問・不具合報告を [GitHub Issues](https://github.com/dataarthub/eaos/issues) で受け付けています。非公開の脆弱性報告は[セキュリティ方針](https://github.com/dataarthub/eaos/blob/main/SECURITY.md)に従ってください。
