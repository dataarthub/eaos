# CLI authoring and release tools

[English](README.md) | [日本語](README.ja.md)

日本語ドキュメントは[EAOSドキュメントサイト](https://tech-docs.alneas.com/ja/eaos-workspace/)で参照できます。未翻訳・レビュー待ちのページは英語表示です。未公開APIの開発ガイドはリポジトリ内に分けて掲載しています。

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/docs/) [![Bun tooling](https://img.shields.io/badge/Bun-14151A?style=flat&logo=bun&logoColor=white)](https://bun.sh/docs) [![Node.js runtime](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs)

## Elevator Pitch

プラグインとHostの開発者がEAOSパッケージを生成・診断・検証するCLIです。

## Why & Value

開発と配布で同じメタデータと配備inventoryを使います。計画、実際の適用、テナント有効化は別の操作です。実装と型定義の正本は公開MIT monorepoです。

## Key Highlights

- プラグイン生成とsandbox
- チェックサム付きinventory
- 検証可能なDB baseline
- OCI配備計画

## Quickstart

Node.js 24以上を使います。公開前は検証済み候補アーカイブが必要です。以下のbaseline画像inventory参照にはDB・UI Provider・CSS・OCI資格情報は不要です。Appkit Core 0.2.0はパッケージ依存です。Pulumi/OCI peerは対応するinfra入口だけで必要です。subpathを別パッケージとしてインストールしません。

```bash
bun add @alneas/eaos-cli
```

```typescript
import { baselineImages } from '@alneas/eaos-cli/baseline'

console.log(baselineImages.postgres)
console.log(baselineImages.oracle)
```

## Next Steps

- [Change history](https://github.com/dataarthub/eaos/blob/main/packages/cli/CHANGELOG.md)
- [Architecture and boundaries](docs/guide.md)
- [API reference](docs/api.md)
- [EAOS composition](https://tech-docs.alneas.com/eaos-workspace/architecture/)
- [Host generation, build and artifact composition (development candidate)](https://github.com/dataarthub/eaos/blob/main/packages/cli/docs/host-composition.md)

英語での質問・不具合報告も[EAOS issue tracker](https://github.com/dataarthub/eaos/issues)で受け付けます。非公開テナントデータ・資格情報・運用receiptを記載しないでください。英語READMEを正本とします。
