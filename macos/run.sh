#!/bin/bash
# macOSアプリの起動
#   bash macos/run.sh          # ビルド済みアプリを起動（未作成ならビルド）
#   bash macos/run.sh --build  # 最新ソースでビルドしてから起動
#   bash macos/run.sh --help   # 使い方を表示
set -euo pipefail
cd "$(dirname "$0")/.."

rebuild=false
case "${1:-}" in
  "") ;;
  --build) rebuild=true; shift ;;
  -h|--help)
    printf '使い方: bash macos/run.sh [--build]\n\n未ビルドの場合は自動ビルドして起動します。\n--build: 最新ソースでビルドしてから起動します。\n'
    exit 0
    ;;
  *) printf '不明な引数: %s\n' "$1" >&2; exit 2 ;;
esac
if [ "$#" -gt 0 ]; then
  printf '使い方: bash macos/run.sh [--build]\n' >&2
  exit 2
fi

app_path="$PWD/macos/build-preview/Build/Products/Debug-maccatalyst/App.app"
if [ "$rebuild" = true ] || [ ! -d "$app_path" ]; then
  bash macos/build.sh preview
fi

# A rebuilt app needs a new process to run the updated executable.
if [ "$rebuild" = true ]; then
  open -n "$app_path"
else
  open "$app_path"
fi
printf '起動しました: %s\n' "$app_path"
