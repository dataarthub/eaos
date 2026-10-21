---
title: "プラグインを作る"
description: "対象の機能・組織に対する現在の権限と、必要なホスト接続を確認します。実環境の資格情報を業務入力に含めないでください。"
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "how-to"]
---

# プラグインを作る

## 前提条件

対象の機能・組織に対する現在の権限と、必要なホスト接続を確認します。実環境の資格情報を業務入力に含めないでください。

## 手順

公開CLIとSDKで作る新しいプラグインの手順です。業務プラグインや実環境設定を共通基盤に取り込む必要はありません。公開前の開発ではworkspaceが作成した固定tgzを使い、公開後は利用プロジェクトのlockfileで版を固定します。

### 導入と雛形

```bash
bun add @alneas/eaos-core hono react
bun add -d @alneas/eaos-cli
bun run eaos plugin generate --name notes
bun run eaos plugin diagnose --plugin notes --check
```

生成先はplugins/notesです。manifest、API、MCPツール、サービス契約、画面の原稿、ガイド、deployment.jsonをまとめて持ちます。生成されたものは永続化を持たないサンプルです。業務ロジック、保存、認証されたホスト接続、ビルド設定と公開exportsは利用プロジェクトで実装します。

### 機能の契約を決める

PluginManifestやMcpToolDefinitionなどの契約は `@alneas/eaos-core/plugin-sdk` を使います。プラグインID、公開操作名、入力・出力JSON Schema、必要な権限、副作用の区分を揃えます。MCPのschemaは静的に診断できる宣言を優先し、秘密値や実行するhandlerをmetadata取得のために評価させません。

API、MCP、jobs、webhookの実処理では、ホストが検証したprincipalと現在のLifecycle状態を使います。リクエスト本文のtenantやroleを採用しません。省略された認可を成功扱いにしない、読み取り後やcommit直前にも失効を確認する、古いrevisionをCASで拒否する、といった境界をテストしてください。

汎用のschema/data-access/storageはapp-core、UI部品はreact-tools、CAS・監査・OutboxはEAOS Serverを使います。ホストの永続storeやproviderへの接続は明示的に注入し、同じ仕組みを業務プラグイン内に再実装しません。

### DBが必要になったとき

物理テーブルとmigrationは版付きDataContractで所有します。機能が必要とするschemaDependenciesと、別機能の有効化を必要とする依存を分けます。DBの共通契約はeaos-core、適用計画と履歴はeaos-server/lifecycle-engineです。既存の適用済みmigrationは変更せず、新しいmigrationを追加します。

保存に必要なtenant列、所有するJSON namespace、外部参照、整合性と容量制約を定義し、実SQLiteなどを使って適用・再起動・再適用なし・別tenant拒否を確認します。コードのinstall、DBへのapply、tenantのenableは別の操作です。

### 画面とNative

汎用画面・Context・共有ヘルプはeaos-reactを使います。クライアントの実行先とWeb/LINEの公開routeはeaos-react/clientの契約に従います。ビルド時のroute登録はtenantへの利用許可を表しません。

Native操作はホストが登録した操作を呼び出します。実行ファイルや秘密参照、tenantを画面から自由に選ばせません。Native失敗時にserverへデータを自動転送しないことも確認します。実OSの資格情報・ファイル・プロセスやSwift SDKを使う既存ホスト実装は、private Framework側で個別に扱います。

ガイドはMarkdownと版付きJSONを別に保ち、コンポーネント内へ長文を埋め込みません。ユーザー向け手順と保守向けの接続・復旧手順を、実装の変更と合わせて更新します。

### 診断と梱包

```bash
bun run eaos plugin sync-agents --plugin notes
bun run eaos plugin diagnose --plugin notes --check
bun run eaos plugin detect-secrets --plugin notes --check
```

SDKを更新するときは、実際の利用側で公開entryを導入して確認します。兄弟repoのsrcへのaliasを使わず、build済みのJS・型・必要なresourceを梱包し、exportsとdeployment.jsonの資産・hashを一致させます。雛形の診断だけでは、保存や業務フローの受入が完了したことにはなりません。

[導入を検証する](testing.md)と[構成・実行境界](architecture.md)も参照してください。

### ローカル開発と階層

`definePlugin` のSDKルートは `eaos dev --config eaos.dev.ts` で動かせます。宣言したSQLite契約とseedを使い、テナント・ロール・契約プランを切り替えます。`clients.web` / `clients.line` へローカルReact entryを指定するとWebとLIFFモックのプレビュー、同じプラグインのregistry / Gatekeeperを `mcp` に指定すると実MCPツールの確認ができます。jobs / webhook / secretsは明示登録した開発ポートのみを実行します。本番identityや資格情報は読み込みません。

生成時の階層は `--tier public|standard|pro|corporate`。公開名は `@alneas/eaos-plugin-*`、非公開の基本機能は `@dataarthub/plugin-*`、Proは `@dataarthub/pro-*`、Corporateは `private: true` のローカルパッケージです。Proの追加契約・予算、Corporateのテナントallowlistをmanifestへ明示します。Pro予算の初期値は0で、利用枠や価格を推測しません。無料のPublicでも、認証・現在の有効状態・対象への権限は別途必要です。

MITの汎用approval・field-customization・adminは公開Monorepoにあり、ホストのdurable storeと現在の認可を注入して利用します。独立した業務プラグインには、業務データや専用provider設定を残します。

## 確認方法

保存結果や最新状態を再取得し、対象と結果を確認します。ローカルの成功、スキーマ適用、実組織での受入は分けて記録します。

## 問題が起きたとき

競合・権限失効・未接続の場合は最新状態とホスト設定を確認します。結果が不明な外部操作を自動で再送しないでください。
