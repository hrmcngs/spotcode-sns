#!/bin/bash
# macOSアプリの起動
#   bash macos/run.sh          # 最新ソースを差分ビルドして起動
#   bash macos/run.sh --build  # 最新ソースでビルドしてから起動
#   bash macos/run.sh --help   # 使い方を表示
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
  "") ;;
  --build) shift ;;
  -h|--help)
    printf '使い方: bash macos/run.sh [--build]\n\n毎回Xcodeで変更を確認し、最新ソースを差分ビルドして起動します。\n--build: 通常起動と同じ動作です（互換オプション）。\n'
    exit 0
    ;;
  *) printf '不明な引数: %s\n' "$1" >&2; exit 2 ;;
esac
if [ "$#" -gt 0 ]; then
  printf '使い方: bash macos/run.sh [--build]\n' >&2
  exit 2
fi

app_path="$PWD/macos/build-preview/Build/Products/Debug-maccatalyst/App.app"
# Version numbers do not change for every local source edit. Let Xcode's
# dependency tracking decide what needs rebuilding on every launch.
bash macos/build.sh preview

# 通常終了を待ってから起動し、古い版のウィンドウを残さない。
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
# Launch this exact bundle even if a separately installed copy is running.
open -n "$app_path"
printf '起動しました: %s\n' "$app_path"
