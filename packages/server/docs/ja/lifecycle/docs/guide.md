---
title: "eaos-lifecycle 開発と境界"
description: "公開契約とホストの実行責任を分け、同じ機能の重複や権限の取り違えを防ぎます。"
sidebar:
  order: 20
archetype: "explanation"
project: "eaos-workspace"
tags: ["eaos", "explanation"]
---

# eaos-lifecycle 開発と境界

## 背景と目的

公開契約とホストの実行責任を分け、同じ機能の重複や権限の取り違えを防ぎます。

## 構成図

```mermaid
flowchart LR
  Host[Trusted host] --> Adapter[Scoped Server adapter]
  Adapter --> Store[Host-owned durable provider]
```

## トレードオフと判断

### 所有範囲

導入/更新/有効化・migration履歴・配置と完了記録。業務plugin・業務物理schema・顧客データ・秘密値・実環境設定・運用receiptは含めません。

### 開発



EAOS依存がまだ未公開の場合は、workspaceのビルド入口を使います。先行パッケージをtgzにして隔離環境へ導入し、型生成・テスト・packの成功後だけ最新receiptを更新します。

### 認可・永続化

tenant/user/rolesは検証済みホストから渡します。Lifecycleの有効状態とresource権限を実行時に再確認します。CASは古いrevisionを拒否し、監査/Outboxはホストがdurableなstoreへ保存します。SQL接続・provider資格情報はホストから注入します。

### 配布と適用

コードの導入、DB/infra適用、tenant有効化は別操作です。build/test/installは本番migrationやPulumi updateを実行しません。共通ドキュメントサイトの原稿はこのrepoのdocsが正本です。

See [Integrity-pinned schema baseline descriptors and a locked, non-DDL ledger rebase preserving historical evidence](../../../lifecycle/docs/baseline.md) for the architecture additions and their host boundaries.
