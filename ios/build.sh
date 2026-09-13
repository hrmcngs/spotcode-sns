#!/bin/bash
# =============================================================================
# iOSビルド一覧（リポジトリのルートで実行）
#
# 1. App Store提出用のRelease Archiveを作成
#    bash ios/build.sh
#    bash ios/build.sh archive
#    出力先: ios/Spotcode.xcarchive
#    中間ファイル: ios/build/
#    成功後、作成したArchiveをXcodeで自動的に開く。
#
# 2. iOS Simulator用のDebugアプリを作成
#    bash ios/build.sh preview
#    出力先: ios/build-preview/Build/Products/Debug-iphonesimulator/App.app
#    起動済みSimulatorへのインストール:
#    xcrun simctl install booted ios/build-preview/Build/Products/Debug-iphonesimulator/App.app
#    起動: xcrun simctl launch booted computer.ngs.hrmc.Spotcode
#
# 3. 作成済みArchiveからApp Store提出用IPAを書き出す
#    bash ios/build.sh export
#    出力先: ios/export/
#    書き出し設定: ios/ExportOptions.plist
#    先にArchiveを作成し、XcodeのAppleアカウントと配布署名を設定する。
#    このコマンドはアップロードや審査提出を行わない。
#
# 4. 使い方を表示
#    bash ios/build.sh --help
#
# 共通: ios/App/App.xcodeproj / Appスキーム
# 追加のxcodebuild引数はモードの後ろに指定できる。
# 例: bash ios/build.sh archive CURRENT_PROJECT_VERSION=17
# バージョン変更: bash ios/version.sh 1.0.2 17（macOSとも共通）
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

mode="${1:-archive}"
case "$mode" in
  -h|--help|help)
    cat <<'HELP'
使い方: bash ios/build.sh [archive|preview|export] [xcodebuildの追加引数]

  archive  実機向けRelease Archiveを作成（省略時の動作）
           出力: ios/Spotcode.xcarchive
           成功後、ArchiveをXcodeで開く
  preview  iOS Simulator用のDebugアプリを作成
           出力: ios/build-preview/Build/Products/Debug-iphonesimulator/App.app
  export   作成済みArchiveからApp Store提出用IPAを書き出す
           出力: ios/export/

Xcodeが必要です。archiveとexportには署名用Apple Developerアカウントも必要です。
アップロードや審査提出は行いません。
HELP
    exit 0
    ;;
  archive|preview|export) if [ "$#" -gt 0 ]; then shift; fi ;;
  *) printf '不明なモード: %s\n--help で使い方を確認してください。\n' "$mode" >&2; exit 2 ;;
esac

case "$mode" in
  archive)
    xcodebuild -project ios/App/App.xcodeproj -scheme App \
      -configuration Release -destination 'generic/platform=iOS' \
      -derivedDataPath ios/build -archivePath ios/Spotcode.xcarchive \
      -allowProvisioningUpdates archive "$@"
    printf '\nArchive: %s/ios/Spotcode.xcarchive\n' "$PWD"
    open -a Xcode "$PWD/ios/Spotcode.xcarchive"
    ;;
  preview)
    xcodebuild -project ios/App/App.xcodeproj -scheme App \
      -configuration Debug -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath ios/build-preview CODE_SIGNING_ALLOWED=NO build "$@"
    printf '\nアプリ: %s/ios/build-preview/Build/Products/Debug-iphonesimulator/App.app\n' "$PWD"
    ;;
  export)
    if [ ! -d ios/Spotcode.xcarchive ]; then
      printf '先に bash ios/build.sh archive を実行してください。\n' >&2
      exit 1
    fi
    xcodebuild -exportArchive -archivePath ios/Spotcode.xcarchive \
      -exportPath ios/export -exportOptionsPlist ios/ExportOptions.plist \
      -allowProvisioningUpdates "$@"
    printf '\n書き出し先: %s/ios/export/\n' "$PWD"
    ;;
esac
