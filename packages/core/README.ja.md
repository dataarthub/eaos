# eaos-core

## 概要

EAOSを組み込む開発者向けに、所有する公開機能と型付きの利用入口を提供します。

## 目的と利点

共通の実装を再利用し、業務機能とホストの接続・認可を分離します。実装の正本は公開Monorepoにあり、本番の設定や運用証拠は含めません。コードの導入、スキーマ適用、組織への有効化は別操作です。

## 主な機能

- 公開パッケージの型付きAPI
- 明示的なホスト接続と現在の認可
- パッケージ単位の検証と配布

## クイックスタート

registryからの導入には公開済みの版が必要です。公開前はworkspaceが作成・検証したSHA固定tarballを使用してください。パッケージのsubpath自体をbun addの引数にはしません。

Node.js 24以上が必要です。Appkit Core 0.2.0の必須peerを一緒に導入します。実行ホストが認証・認可・接続を設定してください。

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

## 次の手順

- [Architecture and boundaries](docs/guide.md)
- [API reference](docs/api.md)
- [EAOS composition](https://tech-docs.alneas.com/eaos-workspace/architecture/)

- [変更履歴](https://github.com/dataarthub/eaos/blob/main/packages/core/CHANGELOG.md)
