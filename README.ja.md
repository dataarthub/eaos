# EAOS public monorepo

[English](README.md) | [日本語](README.ja.md)

日本語ドキュメントは[EAOSドキュメントサイト](https://tech-docs.alneas.com/ja/eaos-workspace/)で参照できます。未翻訳・レビュー待ちのページは英語表示です。未公開APIの開発ガイドはリポジトリ内に分けて掲載しています。

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Bun tooling](https://img.shields.io/badge/Bun-14151A?style=flat&logo=bun&logoColor=white)](https://bun.sh/docs) [![React UI](https://img.shields.io/badge/React-149ECA?style=flat&logo=react&logoColor=white)](https://react.dev/learn)

## Elevator Pitch

プラグインとアプリケーションの開発者が、認可された機能をサーバーとブラウザーのHostへ組み込むための公開パッケージ群です。

## Why & Value

4つのMIT基盤パッケージが純粋な契約、Server実装、Reactクライアント、CLIを分担します。任意の標準Pluginsを含めてnpm配布対象は5つです。EAOS自体は配備されるアプリではなく、Hostプロジェクトが採用機能と実接続を決定します。公開コードは非公開実装を参照しません。

## Key Highlights

- Core：SDK・スキーマ・利用権限の契約
- Server：HTTP/MCP・Lifecycle・DB・ストレージ
- React：ブラウザークライアント・Workspace・ヘルプ
- CLI：生成・検証・配布ツール。標準Pluginsは明示採用

## Quickstart

Node.js 24以上とAppkit Core 0.2.0が必要です。registryからの導入には公開済みの版が必要で、公開前は検証済みSHA固定tarballを使います。以下はプラグイン定義の例です。実行には検証済みの本人情報・現在の認可・テナント境界を持つデータadapterをHostから渡します。subpathはimport先であり、別パッケージのインストール名ではありません。

```bash
bun add @alneas/eaos-core @alneas/appkit-core@0.2.0
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

- [Contribute and verify](CONTRIBUTING.md)
- [Prepare a release](RELEASING.md)

- [Standard plugin collection](plugins/README.md)
- [Public API catalog](docs/api.md)
- [Composition and architecture](docs/architecture.md)
- [Author a plugin](docs/plugin-authoring.md)
- [Verify adoption](docs/testing.md)
- [Documentation ownership and preflight](docs/documentation.md)

英語での質問・不具合報告も[EAOS issue tracker](https://github.com/dataarthub/eaos/issues)で受け付けます。非公開テナントデータ・資格情報・運用receiptを記載しないでください。英語READMEを正本とします。
