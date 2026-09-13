#!/bin/bash
# macOSアプリの起動
#   bash macos/run.sh          # 起動（未作成・バージョン不一致なら自動ビルド）
#   bash macos/run.sh --build  # 最新ソースでビルドしてから起動
#   bash macos/run.sh --help   # 使い方を表示
set -euo pipefail
cd "$(dirname "$0")/.."

rebuild=false
case "${1:-}" in
  "") ;;
  --build) rebuild=true; shift ;;
  -h|--help)
    printf '使い方: bash macos/run.sh [--build]\n\n未ビルド・バージョン不一致の場合は自動ビルドして起動します。\n--build: 最新ソースでビルドしてから起動します。\n'
    exit 0
    ;;
  *) printf '不明な引数: %s\n' "$1" >&2; exit 2 ;;
esac
if [ "$#" -gt 0 ]; then
  printf '使い方: bash macos/run.sh [--build]\n' >&2
  exit 2
fi

app_path="$PWD/macos/build-preview/Build/Products/Debug-maccatalyst/App.app"
settings=$(bash macos/version.sh --show)
expected_version=$(printf '%s\n' "$settings" | awk '/^Version:/ {print $2}')
expected_build=$(printf '%s\n' "$settings" | awk '/^Build:/ {print $2}')
actual_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_path/Contents/Info.plist" 2>/dev/null || true)
actual_build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app_path/Contents/Info.plist" 2>/dev/null || true)
if [ "$actual_version" != "$expected_version" ] || [ "$actual_build" != "$expected_build" ]; then
  printf '設定の %s (%s) に合わせてMacアプリを再ビルドします。\n' "$expected_version" "$expected_build"
  rebuild=true
fi
if [ "$rebuild" = true ]; then
  bash macos/build.sh preview
fi

# 通常終了を待ってから起動し、古い版のウィンドウを残さない。
if [ "$rebuild" = true ]; then
  /usr/bin/swift - "$app_path" <<'SWIFT'
import AppKit
let path = CommandLine.arguments[1]
let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "computer.ngs.hrmc.Spotcode")
    .filter { $0.bundleURL?.path == path }
for app in apps { _ = app.terminate() }
let deadline = Date().addingTimeInterval(10)
while apps.contains(where: { !$0.isTerminated }) && Date() < deadline {
    RunLoop.current.run(until: Date().addingTimeInterval(0.1))
}
guard apps.allSatisfy({ $0.isTerminated }) else {
    fputs("起動中のアプリを終了できませんでした。編集内容を保存して終了後、再実行してください。\n", stderr)
    exit(1)
}
SWIFT
fi
open "$app_path"
printf '起動しました: %s\n' "$app_path"
