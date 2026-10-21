---
title: "eaos-db"
description: "EAOSを組み込む開発者向けに、所有する公開機能と型付きの利用入口を提供します。"
sidebar:
  order: 20
archetype: "explanation"
project: "eaos-workspace"
tags: ["eaos", "explanation"]
---

# eaos-db

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

```bash
bun add @alneas/eaos-server
```

```typescript
import * as capability from '@alneas/eaos-server/db'

console.log(Object.keys(capability))
```

## 次の手順


- [Architecture and host boundaries](../../db/docs/guide.md)
- [API reference](../../db/docs/api.md)
- [Owning package](../../../README.md)
