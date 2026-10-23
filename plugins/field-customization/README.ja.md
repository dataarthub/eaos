# @alneas/eaos-plugins/field-customization

[English](README.md) | [日本語](README.ja.md)

日本語ドキュメントは[EAOSドキュメントサイト](https://tech-docs.alneas.com/ja/eaos-workspace/)で参照できます。未翻訳・レビュー待ちのページは英語表示です。未公開APIの開発ガイドはリポジトリ内に分けて掲載しています。

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Hono server](https://img.shields.io/badge/Hono-E36002?style=flat&logo=hono&logoColor=white)](https://hono.dev/docs/) [![React UI](https://img.shields.io/badge/React-149ECA?style=flat&logo=react&logoColor=white)](https://react.dev/learn)

## Elevator Pitch

管理者が許可された項目の表示を設定する汎用機能です。

## Why & Value

標準Pluginsコレクション内の機能であり、独立した配布パッケージではありません。検証済みprincipal、現在の有効化とresource認可をHostと共有し、永続storeと監査をHostから渡します。インストールだけではテナント有効化や業務処理を実行しません。

## Key Highlights

- 汎用APIとReact入口
- Hostが管理するresourceアクセス
- 永続履歴と古いrevisionの拒否
- チェックサム付き配備inventory

## Quickstart

未公開の@alneas/eaos-plugins@0.1.0候補に含まれます。公開前は検証済みtarballを使います。Node.js 24以上、Appkit Core 0.2.0が必要です。以下はmanifest参照のみでUI・資格情報・テナント有効化は不要です。任意のReact入口にはEAOS React、Appkit React 0.2.0、React/React DOM ^19.2.3、Lucide React、Appkit CSSとガイド指定のProviderが必要です。コレクションを1回インストールし、機能subpathはimportに使います。

```bash
bun add @alneas/eaos-plugins @alneas/appkit-core@0.2.0
```

```typescript
import { manifest } from '@alneas/eaos-plugins/field-customization/manifest'

console.log(manifest.id, manifest.version)
```

## Next Steps

- [Change history](https://github.com/dataarthub/eaos/blob/main/plugins/field-customization/CHANGELOG.md)
- [User guide](docs/user-guide.md)
- [Host integration](docs/maintainer-guide.md)
- [API reference](docs/api.md)
- [Architecture](docs/guide.md)

英語での質問・不具合報告も[EAOS issue tracker](https://github.com/dataarthub/eaos/issues)で受け付けます。非公開テナントデータ・資格情報・運用receiptを記載しないでください。英語READMEを正本とします。
