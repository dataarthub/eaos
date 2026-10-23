# Server execution and persistence

[English](README.md) | [日本語](README.ja.md)

日本語ドキュメントは[EAOSドキュメントサイト](https://tech-docs.alneas.com/ja/eaos-workspace/)で参照できます。未翻訳・レビュー待ちのページは英語表示です。未公開APIの開発ガイドはリポジトリ内に分けて掲載しています。

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js runtime](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs) [![Hono server](https://img.shields.io/badge/Hono-E36002?style=flat&logo=hono&logoColor=white)](https://hono.dev/docs/)

## Elevator Pitch

Hostの開発者がHTTP/MCP、Lifecycle、永続データサービスを組み立てるパッケージです。

## Why & Value

共通実装によって認可、CAS、監査、Outboxの整合性を保ちます。provider接続、現在の本人情報、配備方針はHostが所有します。実装と型定義は公開MIT monorepoにあります。

## Key Highlights

- HonoとMCPの統合
- レビュー可能なLifecycle計画
- 永続CASと監査
- スコープ付きDB・ストレージ

## Quickstart

Node.js 24以上とAppkit Core 0.2.0が必要です。公開前は検証済み候補アーカイブを使います。以下のcanonical化は純粋な処理で、DB接続や資格情報は不要です。実際のサーバー実行にはHostの本人確認・認可・永続化の接続が必要です。

```bash
bun add @alneas/eaos-server @alneas/appkit-core@0.2.0
```

```typescript
import { canonical } from '@alneas/eaos-server/lifecycle-engine'

console.log(canonical({ format: 1, operation: 'inspect' }))
```

## Next Steps

- [Change history](https://github.com/dataarthub/eaos/blob/main/packages/server/CHANGELOG.md)
- [Architecture and boundaries](docs/guide.md)
- [API reference](docs/api.md)
- [EAOS composition](https://tech-docs.alneas.com/eaos-workspace/architecture/)
- [Standard Host startup (development candidate)](https://github.com/dataarthub/eaos/blob/main/packages/server/docs/standard-host.md)

英語での質問・不具合報告も[EAOS issue tracker](https://github.com/dataarthub/eaos/issues)で受け付けます。非公開テナントデータ・資格情報・運用receiptを記載しないでください。英語READMEを正本とします。
