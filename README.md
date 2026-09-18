# AmiVoice API kintone Samples

[AmiVoice API](https://docs.amivoice.com/amivoice-api/manual) を kintone 上で利用するためのプラグイン・アプリテンプレート・カスタマイズスクリプトのサンプル集です。

## 概要

本リポジトリには、次の3つのアプリケーションが含まれています。

| アプリ                                    | 概要                                                                                 | 詳細ガイド                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **AmiSimpleES**<br>（Speech to Text）     | kintone レコードに添付した音声ファイルを AmiVoice API で文字起こしする               | [speech-to-text-app_start_quide.md](docs/speech-to-text-app_start_quide.md)               |
| **AmiCostViewerES**<br>（月次使用量表示） | AmiVoice API の使用量 CSV を取得し、使用量（ミリ秒）と料金（円）を表として表示する     | [monthly-usage-app_start_quide.md](docs/monthly-usage-app_start_quide.md)                 |
| **AmiWordRegES**<br>（ユーザー辞書登録）  | AmiVoice API のユーザー辞書（プロファイル単語）を kintone 画面から一括登録・編集する | [vocabulary-management-app_start_quide.md](docs/vocabulary-management-app_start_quide.md) |

各アプリは、kintone アプリテンプレート（.zip）とプラグイン（.zip）で構成されます。月次使用量表示とユーザー辞書登録では、さらに共通カスタマイズスクリプト（`ami_maskkey.js`）を利用します。

## リポジトリ構成

```text
apps/                       kintoneアプリテンプレート（レコード・画面定義のzip）
  monthly-usage-app/          AmiCostViewerES.zip
  speech-to-text-app/         AmiSimpleES.zip
  vocabulary-management-app/  AmiWordRegES.zip

plugins/                    kintoneプラグイン本体（配布用zip）
  monthly-usage/               ami_cost_100.zip
  speech-to-text/              ami_stt_100.zip
  vocabulary-management/       ami_vocab_100.zip

src/                        各プラグインのソースコード（プラグイン化前のJavaScript）
  monthly-usage/js/main.js
  speech-to-text/js/main.js
  vocabulary-management/js/main.js

JavaScript_customize/
  ami_maskkey.js             APIキー入力欄をマスク表示する共通カスタマイズスクリプト

docs/                       各アプリの導入・操作手順（スタートガイド）
requirements/                各アプリの要件定義メモ
```

## 各アプリの機能

### 1. Speech to Text（AmiSimpleES）

- kintone レコードに添付した音声ファイルを、レコード詳細画面表示時に AmiVoice API へ送信して文字起こしします。
- 認識結果・API レスポンス・処理状態をレコードのフィールドに保存します。
- 認識エンジン（会話汎用、医療、E2E日本語/多言語 など）をレコード上のドロップダウンで選択できます。

### 2. 月次使用量表示（AmiCostViewerES）

- レコードに入力した APIキー・サービスID・対象年月（YYYYMM）を使い、AmiVoice API の使用量 CSV を取得します。
- 使用量明細（`quantity_table`）とエンジンプラン別の料金合計（`cost_table`）をテーブルに自動反映します。
- 取得完了後、APIキーはレコードから自動的に削除されます。

### 3. ユーザー辞書登録（AmiWordRegES）

- エンジン・profileID ごとに AmiVoice API のユーザー辞書（単語一覧）を取得・編集・一括登録できます。
- 新規 profileID への登録、既存辞書の読み出し・追記・上書きに対応します。
- レコード保存時に APIキーは自動的に空文字へ置き換えられ、保存されません。

### 共通カスタマイズ：APIキーのマスク表示（ami_maskkey.js）

月次使用量表示とユーザー辞書登録アプリの APIキー入力欄をパスワード形式（マスク表示）にする、kintone の JavaScript カスタマイズファイルです。両アプリで導入を推奨します。

## セットアップ

1. `apps/` 配下の zip をテンプレートとして kintone アプリを作成します。
2. `plugins/` 配下の対応するプラグイン zip を kintone のプラグイン管理からインストールし、作成したアプリに追加します。
3. `JavaScript_customize/ami_maskkey.js` を対象アプリの「JavaScript / CSS カスタマイズ」に追加します（スコープ: デスクトップ）。
4. 各アプリのスタートガイド（`docs/`）に従い、フィールド設定・プラグイン設定を行います。

詳細な手順は [docs/getting-started.md](docs/getting-started.md) およびアプリごとのスタートガイドを参照してください。

## ドキュメント

- [docs/architecture.md](docs/architecture.md) — システム構成
- [docs/getting-started.md](docs/getting-started.md) — 導入の全体的な流れ
- [requirements/monthly-usage_requirement.md](requirements/monthly-usage_requirement.md) — 月次使用量表示アプリの要件
- [requirements/vocabulary-management-app_requirements.md](requirements/vocabulary-management-app_requirements.md) — ユーザー辞書登録アプリの要件

## ライセンス

[LICENSE](LICENSE) を参照してください。
