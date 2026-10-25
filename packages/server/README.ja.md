# Server の実行と永続化

[English](https://github.com/dataarthub/eaos/blob/main/packages/server/README.md) | [日本語](https://github.com/dataarthub/eaos/blob/main/packages/server/README.ja.md)

[ドキュメントサイトの日本語ページ](https://tech-docs.alneas.com/ja/eaos-workspace/server/)でプロジェクト全体の日本語ドキュメントを案内しています。未翻訳・レビュー待ちのページは英語にフォールバックする場合があります。公開サイトは公開済みバージョンの案内であり、この README の 0.2.0 候補と一致しない場合は、対応する英語ガイドと変更履歴を確認してください。

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Node.js minimum 24](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/about/previous-releases) [![Hono](https://img.shields.io/badge/Hono-E36002?style=flat&logo=hono&logoColor=white)](https://hono.dev/docs/)

## Elevator Pitch

ホスト開発者は Server を使い、HTTP/MCP、ライフサイクル、永続データサービスを構成できます。

## Why & Value

共通実装により、認可、CAS、監査、Outbox の振る舞いを揃えます。プロバイダーへの接続、現在の識別情報、デプロイ方針はホストが管理します。この MIT パッケージの実装と型宣言は公開モノレポで管理します。

## Key Highlights

- Hono と MCP の連携
- レビューを経たライフサイクル計画
- 永続的な CAS と監査
- スコープを限定したデータベースとストレージ

## Quickstart

この checkout は 0.2.0 のリリース準備用です。0.1.0 は公開済みです。0.2.0 の公開まではチェックサムを固定した候補 tarball を導入し、以下のコマンドは公開後に使用してください。

### 公開 API の import

Node.js 24 以上と、必須 peer の Appkit Core 0.2.0 を使用してください。以下の正規化の例は純粋な処理で、データベース接続や認証情報は不要です。Server の実行には、別途ホストが管理する識別情報、認可、永続化の接続が必要です。subpath は import の対象であり、個別にインストールするパッケージではありません。

```bash
bun add @alneas/eaos-server@0.2.0 @alneas/appkit-core@0.2.0
```

```typescript
import { canonical } from '@alneas/eaos-server/lifecycle-engine'

console.log(canonical({ format: 1, operation: 'inspect' }))
```

## Next Steps

- [変更履歴](https://github.com/dataarthub/eaos/blob/main/packages/server/CHANGELOG.md)
- [アーキテクチャと境界](docs/guide.md)
- [API リファレンス](docs/api.md)
- [EAOS の構成](https://tech-docs.alneas.com/eaos-workspace/architecture/)

英語での質問・不具合報告を [GitHub Issues](https://github.com/dataarthub/eaos/issues) で受け付けています。非公開の脆弱性報告には [GitHubの非公開報告機能](https://github.com/dataarthub/eaos/security/advisories/new)を利用できます。
