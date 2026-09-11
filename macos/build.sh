#!/bin/bash
# =============================================================================
# macOSビルド一覧（リポジトリのルートで実行）
#
# 1. Release Archiveを作成
#    bash macos/build.sh
#    bash macos/build.sh archive
#    出力先: macos/Spotcode.xcarchive
#    中間ファイル: macos/build/
#
# 2. 動作確認・スクリーンショット撮影用のDebugアプリを作成
#    bash macos/build.sh preview
#    出力先: macos/build-preview/Build/Products/Debug-maccatalyst/App.app
#    起動: open macos/build-preview/Build/Products/Debug-maccatalyst/App.app
#    起動スクリプト: bash macos/run.sh
#    ビルドして起動: bash macos/run.sh --build
#
# 3. 作成済みArchiveからMac App Store提出用PKGを書き出す
#    bash macos/build.sh export
#    出力先: macos/export/
#    書き出し設定: macos/ExportOptions.plist
#    先に1のArchiveを作成し、XcodeのAppleアカウントと配布署名を設定する。
#    このコマンドはアップロードや審査提出を行わない。
#
# 4. 使い方を表示
#    bash macos/build.sh --help
#
# 共通: ios/App/App.xcodeproj / Appスキーム / Mac Catalyst
# 追加のxcodebuild引数はモードの後ろに指定できる。
# 例: bash macos/build.sh archive CURRENT_PROJECT_VERSION=16
# =============================================================================
set -euo pipefail

# Resolve paths from this file, so the script also works outside the repository.
cd "$(dirname "$0")/.."

mode="${1:-archive}"
case "$mode" in
  -h|--help|help)
    cat <<'HELP'
使い方: bash macos/build.sh [archive|preview|export] [xcodebuildの追加引数]

  archive  Release Archiveを作成（省略時の動作）
           出力: macos/Spotcode.xcarchive
  preview  動作確認用のDebugアプリを作成
           出力: macos/build-preview/Build/Products/Debug-maccatalyst/App.app
  export   作成済みのArchiveからApp Store提出用PKGを書き出す
           出力: macos/export/

Xcodeと署名用のApple Developerアカウントが必要です。
HELP
    exit 0
    ;;
  archive|preview|export) if [ "$#" -gt 0 ]; then shift; fi ;;
  *) printf '不明なモード: %s\n--help で使い方を確認してください。\n' "$mode" >&2; exit 2 ;;
esac

case "$mode" in
  archive)
    xcodebuild -project ios/App/App.xcodeproj -scheme App \
      -configuration Release \
      -destination 'generic/platform=macOS,variant=Mac Catalyst' \
      -derivedDataPath macos/build -archivePath macos/Spotcode.xcarchive \
      -allowProvisioningUpdates archive "$@"
    printf '\nArchive: %s/macos/Spotcode.xcarchive\n' "$PWD"
    ;;
  preview)
    xcodebuild -project ios/App/App.xcodeproj -scheme App \
      -configuration Debug \
      -destination 'platform=macOS,variant=Mac Catalyst' \
      -derivedDataPath macos/build-preview \
      -allowProvisioningUpdates build "$@"
    printf '\nアプリ: %s/macos/build-preview/Build/Products/Debug-maccatalyst/App.app\n' "$PWD"
    ;;
  export)
    if [ ! -d macos/Spotcode.xcarchive ]; then
      printf '先に bash macos/build.sh archive を実行してください。\n' >&2
      exit 1
    fi
    xcodebuild -exportArchive -archivePath macos/Spotcode.xcarchive \
      -exportPath macos/export -exportOptionsPlist macos/ExportOptions.plist \
      -allowProvisioningUpdates "$@"
    printf '\n書き出し先: %s/macos/export/\n' "$PWD"
    ;;
esac
