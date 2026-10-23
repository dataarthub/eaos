# Core contracts and plugin SDK

[English](README.md) | [日本語](README.ja.md)

日本語ドキュメントは[EAOSドキュメントサイト](https://tech-docs.alneas.com/ja/eaos-workspace/)で参照できます。未翻訳・レビュー待ちのページは英語表示です。未公開APIの開発ガイドはリポジトリ内に分けて掲載しています。

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js runtime](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs) [![Bun tooling](https://img.shields.io/badge/Bun-14151A?style=flat&logo=bun&logoColor=white)](https://bun.sh/docs)

## Elevator Pitch

プラグイン作者が可搬な機能、データ所有権、利用権限を定義するSDKです。

## Why & Value

純粋な契約はServer、DB driver、ブラウザーUIなしで利用できます。本人確認と実行能力は信頼されたHostが提供します。実装と型定義の正本は公開MIT monorepoです。

## Key Highlights

- 純粋なプラグインSDK
- 版管理されたデータ契約
- 利用権限の契約
- 隔離テスト用ハーネス

## Quickstart

Node.js 24以上とAppkit Core 0.2.0が必要です。以下はプラグインの宣言で、公開済み版または検証済み候補アーカイブを使います。実行時の本人確認・認可・テナント別データ接続はHostが提供します。subpath自体をインストールしません。

```bash
bun add @alneas/eaos-core @alneas/appkit-core@0.2.0
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

- [Change history](https://github.com/dataarthub/eaos/blob/main/packages/core/CHANGELOG.md)
- [Architecture and boundaries](docs/guide.md)
- [API reference](docs/api.md)
- [EAOS composition](https://tech-docs.alneas.com/eaos-workspace/architecture/)

英語での質問・不具合報告も[EAOS issue tracker](https://github.com/dataarthub/eaos/issues)で受け付けます。非公開テナントデータ・資格情報・運用receiptを記載しないでください。英語READMEを正本とします。
