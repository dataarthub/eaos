---
title: "OCI Presetとリリース"
description: "CLIと承認済みの配布パッケージを導入し、oci-adbまたは同義のoci-adb-standardを選びます。実Oracle・認証の資格情報、環境全体のlock、全instanceのdrain、固定画像とレビュー済みmigration executorはホストが用意します。以下は予約済みの例示ドメインと架空の識別子です。"
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "how-to"]
---

# OCIの構成とリリースを検証する

## 前提条件

CLIと承認済みの配布パッケージを導入し、`oci-adb`または同義の`oci-adb-standard`を選びます。実Oracle・認証の資格情報、環境全体のlock、全instanceのdrain、固定画像とレビュー済みmigration executorはホストが用意します。以下は予約済みの例示ドメインと架空の識別子です。

## 手順

`eaos.platform.json`で採用するパッケージを宣言します。

```json
{
  "preset": "oci-adb",
  "platform": { "appName": "example-platform", "baseDomain": "example.com" },
  "plugins": ["@example/standard-bundle"],
  "corporatePackages": [
    { "id": "example-extension", "path": "./vendor/example-extension", "tenants": ["example-tenant"] }
  ]
}
```

各パッケージの`./deployment.json`には、資産のSHA-256、runtime、Lifecycle bundle、componentとtaskを記録します。検査はruntime factoryを実行しません。`loadRegisteredPlatformModules`にはホストが検証したtenant一覧とbindingsを渡します。`stagePlatformPackages`が作る検証済みtreeと固定したruntime依存をまとめて配布してください。

Frontend、API/MCP、WorkerとOracleの役割を分け、追加DB・既存resource・Function・native・外部サービスは明示placementsで解決します。必須配置先が不明なら生成を拒否します。コードの選択はtenantへの利用権を付与しません。

### インフラ定義を生成する

```bash
eaos preset:init
cd pulumi
bun install
pulumi stack init staging
pulumi preview
```

実compartment、availability domain、対応image、SSH CIDRと公開鍵、DB版、storage namespaceを生成されたPulumi schemaで設定します。DB passwordはPulumi secretとして扱います。初期化は編集済みソースを保持し、previewは実適用しません。

テンプレートはedge、private ARM worker、NAT/service gateway、network ACL、保護したADB、非公開のversioned storageとVaultを定義します。IAM、DNS/TLSと既存resourceの採用はホストが所有します。`pulumi/custom.ts`で引数やresourceを追加でき、秘密outputをplatform JSONやreceiptへ保存しません。

### ホスト操作を接続する

`@alneas/eaos-cli/platform/operations`の`definePlatformOperations`で、信頼する`eaos.operations.ts`を作ります。環境lock、Lifecycle catalog/executor、healthとbootstrapの制御DB・認証・管理者コード発行を実adapterへ接続します。空の成功callbackで代用しません。管理者コードは短期限・単回とし、hashだけを保存し、平文はoperatorへ直接渡します。

Kamal/SSHとimmutable imageを設定します。`dev`、`local`、`latest`はreleaseで拒否します。既存ホストでは`deploy({ role, image, version, configFile, context })`と`bootstrap.provisionInfrastructure(context, stack)`を明示接続し、既存のKamal/Pulumi identityを維持します。実行前に画像版とstackを照合します。

### 適用前にplanを確認する

```bash
eaos platform:generate
eaos bootstrap --stack org/example-platform/staging --plan
eaos release --plan
eaos up --plan
```

`--plan`はホスト操作コードをimportしません。実操作はlocal/shared環境lockを取得し、配布物・設定・ソース・lockfileのhashを確認してから進めます。bootstrapはインフラ、制御DB、認証と単回登録コード配信を行います。releaseは選択したLifecycleを導入・更新し、有効な機能のupgradeにはdrainを必須とします。Worker→Backend→Frontendを展開し、readinessと`X-EAOS-Release`を各画像版に照合します。操作自身が停止した有効状態だけを復元し、完了記録を追記します。新規tenantの自動有効化は行いません。

### Baselineとローカル実行を接続する

レビュー済み`baselines: [{ backendId, baseline }]`と同じtarget Data Contractを使います。既存台帳は完全履歴のchecksumを確認しDDLなしでrebaseし、新規DBはtarget DDLを適用します。元契約と旧台帳を保持します。Baseline生成は破棄可能なローカルOracle/PostgreSQL/SQLiteで行い、本番DBを推測しません。

`eaos up`にはlocal origins、画像build、runtime認証設定とpassword fileを用意し、HTTPSにはTLS directoryも指定します。既存passwordやvolumeは置換しません。DB→認証migration→アプリの順で起動し、readinessの失敗を成功扱いしません。

## 確認方法

inventory、runtime contract、配置planと固定画像を確認します。`src/`または`scripts/`に置いたadapter、Pulumiソースと操作宣言も入力hashに含めます。外部adapterは実行直前の状態を再確認します。配置先ごとのreadinessと版headerを確認して受入します。

## 問題が起きたとき

- 必須配置を解決してから生成します。任意nativeが未採用ならその状態を保持します。
- 失敗したstep以降は停止し、失敗証拠を追記します。dirtyなDDLと台帳を調査・整合してから再実行します。
- lockは期限だけで解除しません。ownerと保守状態を確認します。
- 復旧後は明示Lifecycle操作で停止した機能を再開します。
- 非公開という設定値だけでproviderの実保護を完了扱いにしません。
