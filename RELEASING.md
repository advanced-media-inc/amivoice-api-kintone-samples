# リリース手順（メンテナー向け）

プラグインの zip はリポジトリにコミットしません。GitHub でリリースを公開すると、ワークフロー（`.github/workflows/plugins.yml`）が `src/` から zip をビルドして署名し、そのリリースに添付します。

## リリースに添付されるもの

| ファイル                                                   | 内容                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `ami_stt_{version}.zip`                                    | Speech to Text プラグイン                             |
| `ami_cost_{version}.zip`                                   | 月次使用量表示プラグイン                              |
| `ami_vocab_{version}.zip`                                  | ユーザー辞書登録プラグイン                            |
| `AmiSimpleES.zip`、`AmiCostViewerES.zip`、`AmiWordRegES.zip` | アプリテンプレート（`apps/` のファイルをそのまま添付） |
| `ami_maskkey.js`                                           | APIキーのマスク表示スクリプト                         |

`{version}` は各プラグインの `src/<dir>/manifest.json` の `version` です。リリースのタグとは別に管理します。

## 1. 署名鍵を登録する（最初の 1 回だけ）

kintone のプラグインIDは、署名に使う秘密鍵（`.ppk`）で決まります。アプリテンプレートと、すでにプラグインを導入している環境は、次のIDを参照しています。別の鍵で署名するとIDが変わり、別のプラグインとして扱われます。

| プラグイン            | プラグインID                       | シークレット名                     |
| --------------------- | ---------------------------------- | ---------------------------------- |
| speech-to-text        | `abdkpbfddpickggcokdhngcgdhmjkgdb` | `PLUGIN_PPK_SPEECH_TO_TEXT`        |
| monthly-usage         | `bpfdlgdkkfbaninlhohpoieocfjfchng` | `PLUGIN_PPK_MONTHLY_USAGE`         |
| vocabulary-management | `cdjjdnbhjhillfdcbinppcgedbpapjom` | `PLUGIN_PPK_VOCABULARY_MANAGEMENT` |

1. これまで zip の署名に使ってきた鍵 3 つを用意します。鍵はリポジトリに入れないでください（`.gitignore` で `*.ppk` を除外しています）。
2. 鍵が正しいかを手元で確かめます。任意のディレクトリに `speech-to-text.ppk`・`monthly-usage.ppk`・`vocabulary-management.ppk` の名前で置き、次を実行します。IDが一致しなければエラーで止まります。

   ```bash
   scripts/build-plugins.sh --keys-dir <鍵を置いたディレクトリ>
   ```

3. 鍵の中身を、リポジトリの Settings → Secrets and variables → Actions に、上表のシークレット名で登録します。`gh` を使う場合は次のとおりです。

   ```bash
   gh secret set PLUGIN_PPK_SPEECH_TO_TEXT < speech-to-text.ppk
   gh secret set PLUGIN_PPK_MONTHLY_USAGE < monthly-usage.ppk
   gh secret set PLUGIN_PPK_VOCABULARY_MANAGEMENT < vocabulary-management.ppk
   ```

## 2. リリースを公開する

1. プラグインの中身を変えた場合は、そのプラグインの `src/<dir>/manifest.json` の `version` を上げ、main にマージします。同じ `version` のまま中身だけ変えると、利用者が新旧を見分けられません。
2. GitHub の Releases → Draft a new release で、main を対象にタグ `vX.Y.Z` を作り、「Publish release」を押します。`gh` を使う場合は次のとおりです。

   ```bash
   gh release create vX.Y.Z --target main --generate-notes
   ```

   下書き（Draft）のままではワークフローは動きません。公開した時点で動きます。
3. Actions の「Build kintone plugins」が成功し、リリースに上表のファイルが添付されたことを確かめます。

## 失敗したとき

| 症状                                               | 対処                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `PLUGIN_PPK_... secret is empty`                   | シークレットが未登録。1 の手順で登録し、失敗したジョブを再実行する                              |
| `プラグインIDが一致しません`                       | 登録した鍵が違う。1 の手順 2 で正しい鍵を確かめてから登録し直し、再実行する                     |
| ビルドは通ったが添付に失敗した、添付し直したい     | 失敗したジョブを再実行する（同じ名前のファイルは上書きされる）                                  |

## 手元で確かめる

鍵を指定せずに実行すると、使い捨ての鍵で署名した zip を `dist/` に作ります。中身の確認用で、IDが違うため配布には使えません。PR と main への push でも、ワークフローが同じ確認用のビルドを行います。

```bash
scripts/build-plugins.sh
```
