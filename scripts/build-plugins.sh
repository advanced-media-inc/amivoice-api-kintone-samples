#!/usr/bin/env bash
# kintone プラグイン zip をソース (src/<dir>/) からビルドする。
#
# 使い方:
#   scripts/build-plugins.sh [--keys-dir DIR] [--out DIR]
#
#   --keys-dir DIR  DIR/<dir>.ppk (例: speech-to-text.ppk) を使って署名する。
#                    配布用ビルドではこれを指定し、プラグインIDが期待値と一致するか
#                    確認する。指定しない場合は使い捨て鍵で署名する（検証用ビルド）。
#   --out DIR        出力先ディレクトリ。既定はリポジトリ直下の dist。
set -euo pipefail

CLI_KINTONE_VERSION=1.21.3

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

OUT_DIR="$REPO_ROOT/dist"
KEYS_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keys-dir)
      KEYS_DIR="$2"
      shift 2
      ;;
    --out)
      OUT_DIR="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# src/<dir> : zip 名の接頭辞 : 期待するプラグインID
PLUGIN_DIRS=(speech-to-text monthly-usage vocabulary-management)
PLUGIN_PREFIXES=(ami_stt ami_cost ami_vocab)
PLUGIN_IDS=(abdkpbfddpickggcokdhngcgdhmjkgdb bpfdlgdkkfbaninlhohpoieocfjfchng cdjjdnbhjhillfdcbinppcgedbpapjom)

mkdir -p "$OUT_DIR"

CLEANUP_DIR=""
cleanup() {
  if [[ -n "$CLEANUP_DIR" ]]; then
    rm -rf "$CLEANUP_DIR"
  fi
}
trap cleanup EXIT

if [[ -z "$KEYS_DIR" ]]; then
  echo "警告: --keys-dir が指定されていません。使い捨て鍵で署名する検証用のビルドです。配布には使えません。" >&2
  CLEANUP_DIR="$(mktemp -d)"
  KEYS_DIR="$CLEANUP_DIR"
fi

for i in "${!PLUGIN_DIRS[@]}"; do
  dir="${PLUGIN_DIRS[$i]}"
  prefix="${PLUGIN_PREFIXES[$i]}"
  expected_id="${PLUGIN_IDS[$i]}"

  manifest="$REPO_ROOT/src/$dir/manifest.json"
  version="$(node -e "console.log(require('$manifest').version)")"
  out_zip="$OUT_DIR/${prefix}_${version}.zip"

  key_file="$KEYS_DIR/${dir}.ppk"
  if [[ "$CLEANUP_DIR" == "$KEYS_DIR" ]]; then
    npx --yes "@kintone/cli@${CLI_KINTONE_VERSION}" plugin keygen -o "$key_file"
  fi

  if [[ ! -f "$key_file" ]]; then
    echo "エラー: 鍵ファイルが見つかりません: $key_file" >&2
    exit 1
  fi

  npx --yes "@kintone/cli@${CLI_KINTONE_VERSION}" plugin pack \
    -i "$manifest" \
    -o "$out_zip" \
    --private-key "$key_file"

  if [[ "$CLEANUP_DIR" != "$KEYS_DIR" ]]; then
    actual_id="$(npx --yes "@kintone/cli@${CLI_KINTONE_VERSION}" plugin info --input "$out_zip" --format json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")"
    if [[ "${actual_id}" != "${expected_id}" ]]; then
      echo "エラー: ${dir} のプラグインIDが一致しません（期待: ${expected_id}, 実際: ${actual_id}）。鍵が違う可能性があります（IDが変わるとテンプレートや既存の導入先から別プラグイン扱いになります）。" >&2
      exit 1
    fi
  fi

  echo "built: $out_zip"
done
