---
title: "導入を検証する"
description: "対象の機能・組織に対する現在の権限と、必要なホスト接続を確認します。実環境の資格情報を業務入力に含めないでください。"
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "how-to"]
---

# 導入を検証する

## 前提条件

対象の機能・組織に対する現在の権限と、必要なホスト接続を確認します。実環境の資格情報を業務入力に含めないでください。

## 手順

ビルド、配布、接続、実環境の受入を順に確認します。テストが使うartifactと、完了記録が指すartifactを同じSHA-256で固定してください。

| 層 | 確認すること | 成功の範囲 |
| --- | --- | --- |
| repo単体 | 型生成、純粋計算、入力検証、例外・権限失効 | そのrepoのコードと宣言した依存 |
| 梱包 | exports、JS/型/resource、manifest、秘密ファイルの除外 | 作成したtgzの内容 |
| 隔離した利用側 | 実tgzのinstall、実行、型検査、ブラウザbundle | 固定した配布物の相互運用 |
| 保存とLifecycle | 実DB、CAS、監査/Outbox、再起動、dirty/stale plan | 指定した検証環境とstore |
| 業務UI | 読込、入力、保存、再取得、失効、中断、別tenant拒否 | 実際に操作した画面とホスト接続 |
| 実環境 | 認証、provider、DNS/TLS、配備、実tenantでの受入 | そのenvironment・配置先・tenant |

### 必須の異常系

同じIDを使う別tenantから読めないこと、操作中に失効した権限がcommitを許さないこと、古いrevisionが更新を上書きしないことを確認します。保存の失敗を成功通知へ変換しないこと、外部配信の失敗をDB transactionのrollbackと取り違えないことも必要です。

Lifecycleでは、編集されたplan、古いplan、適用済みmigrationの変更、dirtyなDDLの再実行を拒否します。Storageはprefixからの脱出、別scopeのcursor、public upload、許可範囲を超えた署名URLを拒否します。ブラウザはlogoutやContext切替後の古い応答を採用しません。

Native/Pythonは登録済みの信頼された処理で確認し、実providerや本番への書込みを伴う試験は対象環境を別に指定します。オフライン学習や合成データでの成功を、本番モデルや実tenantの受入として記録しません。

### カバレッジの読み方

行カバレッジは実行した行の割合です。compiled dependencyの実行が元repoのsrcの割合へ計上されない場合があります。また、サーバーの単体試験、ReactのSSR、共有部品のテストだけで、すべての画面の対話・実認証・provider接続が検証されたことにはなりません。

低い値は未検証の経路を調べる入口に使います。値を上げるためだけのテストを増やすより、失敗時の情報漏れ、失効、再実行、永続化と復旧を確かめる試験を優先します。

### 完了記録

deployment.jsonのcomponentとtaskを、利用アプリのeaos.platform.jsonの実行先へ割り当てます。同じjournalからプラグイン別と配置先別に残作業を集計できます。

```bash
bun run eaos platform:deployment-plan --help
bun run eaos platform:deployment-status --help
bun run eaos platform:deployment-record --help
```

記録には固定artifact、操作、environment、配置先、必要ならtenant、証拠を含めます。artifact単体の成功、ローカルDB適用、実環境への適用、有効化、業務受入は区別して残します。古いjournalを上書きせず、新しいartifactを別に検証します。

## 確認方法

保存結果や最新状態を再取得し、対象と結果を確認します。ローカルの成功、スキーマ適用、実組織での受入は分けて記録します。

## 問題が起きたとき

競合・権限失効・未接続の場合は最新状態とホスト設定を確認します。結果が不明な外部操作を自動で再送しないでください。
