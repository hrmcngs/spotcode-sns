#!/bin/bash
# iOS / macOS共通のバージョン変更
#   bash ios/version.sh                 # 現在の番号を表示
#   bash ios/version.sh 1.0.2            # バージョンのみ変更
#   bash ios/version.sh 1.0.2 16         # バージョンとビルド番号を変更
#   bash ios/version.sh --build 16       # ビルド番号のみ変更
#   bash ios/version.sh --bump-build     # ビルド番号を1増やす
#   bash ios/version.sh --help          # 使い方
# iOSとmacOSはXcodeプロジェクトを共有するため、両方に反映されます。
# 既存のArchiveや配布済みアプリは変わりません。変更後に再ビルドしてください。
set -euo pipefail
exec bash "$(dirname "$0")/../macos/version.sh" "$@"
