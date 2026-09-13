#!/bin/bash
# iOS / macOS共通のバージョン変更（Debug・Releaseをまとめて更新）
#   bash macos/version.sh                 # 現在の番号を表示
#   bash macos/version.sh 1.0.2           # バージョンのみ変更
#   bash macos/version.sh 1.0.2 16        # バージョンとビルド番号を変更
#   bash macos/version.sh --build 16      # ビルド番号のみ変更
#   bash macos/version.sh --bump-build    # ビルド番号を1増やす
# 更新後: bash macos/build.sh archive    # 提出用Archiveを作り直す
# ソース設定のみを更新します。既存のアプリ・Archive・PKGは更新しません。
set -euo pipefail
cd "$(dirname "$0")/.."
project="ios/App/App.xcodeproj/project.pbxproj"

usage() {
  cat <<'HELP'
使い方:
  bash macos/version.sh [--show]
  bash macos/version.sh VERSION [BUILD]
  bash macos/version.sh --build BUILD
  bash macos/version.sh --bump-build

VERSION: 1.0.2 のような3つの整数（先頭の不要な0は不可）
BUILD:   1〜999999999の整数
iOS・macOS共通のDebug／Release設定を更新します。
VERSIONだけ指定した場合、ビルド番号はそのままです。
HELP
}
fail() { printf '%s\n' "$*" >&2; exit 1; }
if [ "${1:-}" = --help ] || [ "${1:-}" = -h ]; then usage; exit 0; fi

read_setting() {
  awk -v key="$1" '$1 == key && $2 == "=" { value=$3; sub(/;$/, "", value); print value }' "$project" | sort -u
}
old_version=$(read_setting MARKETING_VERSION)
old_build=$(read_setting CURRENT_PROJECT_VERSION)
valid_version() { [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; }
valid_build() { [[ "$1" =~ ^[1-9][0-9]{0,8}$ ]]; }
valid_version "$old_version" || fail '現在のバージョン設定が不正、または構成間で一致していません。'
valid_build "$old_build" || fail '現在のビルド番号が不正、または構成間で一致していません。'
version="$old_version"
build="$old_build"
case "${1:---show}" in
  --show)
    [ "$#" -le 1 ] || fail '引数が多すぎます。--help を確認してください。'
    printf 'Version: %s\nBuild: %s\n' "$version" "$build"
    exit 0 ;;
  --build)
    [ "$#" -eq 2 ] || fail '--build の後にビルド番号を指定してください。'
    build="$2" ;;
  --bump-build)
    [ "$#" -eq 1 ] || fail '--bump-build に追加の引数は指定できません。'
    [ "$old_build" -lt 999999999 ] || fail 'ビルド番号が上限に達しています。'
    build=$((old_build + 1)) ;;
  *)
    [ "$#" -le 2 ] || fail '引数が多すぎます。--help を確認してください。'
    version="$1"
    build="${2:-$old_build}" ;;
esac
valid_version "$version" || fail 'バージョンは 1.0.2 のように指定してください。'
valid_build "$build" || fail 'ビルド番号は1〜999999999の整数を指定してください。'
if [ "$version" = "$old_version" ] && [ "$build" = "$old_build" ]; then
  printf '変更なし: %s (%s)\n' "$version" "$build"
  exit 0
fi

# 同じディレクトリの一時ファイルで検証してから置き換える。
temporary=$(mktemp "${project}.version.XXXXXX")
trap 'rm -f "$temporary"' EXIT
cp -p "$project" "$temporary"
awk -v version="$version" -v build="$build" '
  /^[[:space:]]*MARKETING_VERSION = / { sub(/= [^;]*;/, "= " version ";") }
  /^[[:space:]]*CURRENT_PROJECT_VERSION = / { sub(/= [^;]*;/, "= " build ";") }
  { print }
' "$project" > "$temporary"
plutil -lint "$temporary" >/dev/null
mv "$temporary" "$project"
printf 'Version: %s → %s\nBuild: %s → %s\n' "$old_version" "$version" "$old_build" "$build"
printf 'iOS・macOS共通の設定を更新しました。提出前にArchiveを作り直してください。\n'
