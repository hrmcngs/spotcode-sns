#!/bin/bash
# =============================================================================
# iOS・macOSを同時にビルド（リポジトリ外からも実行可能）
#
# 1. 両方のRelease Archiveを並行して作り、成功したArchiveをXcodeで開く
#    bash build.sh
#    bash build.sh archive
#    出力先: ios/Spotcode.xcarchive / macos/Spotcode.xcarchive
#
# 2. 両方のDebugアプリを並行してビルド
#    bash build.sh preview
#
# 3. 作成済みArchiveからIPA・PKGを並行して書き出す
#    bash build.sh export
#    出力先: ios/export/ / macos/export/
#    アップロードや審査提出は行わない。
#
# 4. 使い方を表示
#    bash build.sh --help
#
# ログ: ios/build-<モード>.log / macos/build-<モード>.log（毎回上書き）
# 実行中は10秒ごとに経過時間と状態を表示する。
# 追加引数は両方のxcodebuildへ渡す。
# 例: bash build.sh archive CURRENT_PROJECT_VERSION=17
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

mode="${1:-archive}"
case "$mode" in
  -h|--help|help)
    cat <<'HELP'
使い方: bash build.sh [archive|preview|export] [xcodebuildの追加引数]

  archive  iOS・macOSのArchiveを並行作成し、Xcodeで開く（省略時）
  preview  iOS Simulator・Mac CatalystのDebugアプリを並行ビルド
  export   作成済みArchiveからIPA・PKGを並行して書き出す

ログ: ios/build-<モード>.log / macos/build-<モード>.log
両方の完了を待ち、片方でも失敗した場合は終了コード1を返します。
HELP
    exit 0
    ;;
  archive|preview|export) if [ "$#" -gt 0 ]; then shift; fi ;;
  *) printf '不明なモード: %s\n--help で使い方を確認してください。\n' "$mode" >&2; exit 2 ;;
esac

printf 'iOS・macOSの %s を並行実行します。\n' "$mode"
printf 'ログ: %s/ios/build-%s.log\n      %s/macos/build-%s.log\n' "$PWD" "$mode" "$PWD" "$mode"

run_platform() {
  local platform="$1"
  shift
  local status=0
  bash "$platform/build.sh" "$mode" "$@" >"$platform/build-$mode.log" 2>&1 || status=$?
  if [ "$status" -eq 0 ]; then
    printf '[%s] %s 完了\n' "$platform" "$mode"
  else
    printf '[%s] %s 失敗（終了コード %s）。ログ: %s/build-%s.log\n' "$platform" "$mode" "$status" "$platform" "$mode" >&2
  fi
  return "$status"
}

run_platform ios "$@" &
ios_pid=$!
run_platform macos "$@" &
macos_pid=$!

started=$SECONDS
next_update=$SECONDS
while kill -0 "$ios_pid" 2>/dev/null || kill -0 "$macos_pid" 2>/dev/null; do
  if [ "$SECONDS" -ge "$next_update" ]; then
    ios_state='終了'
    macos_state='終了'
    if kill -0 "$ios_pid" 2>/dev/null; then ios_state='実行中'; fi
    if kill -0 "$macos_pid" 2>/dev/null; then macos_state='実行中'; fi
    printf '[経過 %s秒] iOS: %s / macOS: %s\n' "$((SECONDS - started))" "$ios_state" "$macos_state"
    next_update=$((SECONDS + 10))
  fi
  sleep 1
done

ios_status=0
macos_status=0
wait "$ios_pid" || ios_status=$?
wait "$macos_pid" || macos_status=$?

result=0
for platform in ios macos; do
  if [ "$platform" = ios ]; then status=$ios_status; else status=$macos_status; fi
  if [ "$status" -eq 0 ]; then
    printf '%s: %s 完了\n' "$platform" "$mode"
  else
    printf '%s: %s 失敗（終了コード %s）\n' "$platform" "$mode" "$status" >&2
    tail -n 30 "$platform/build-$mode.log" >&2
    printf 'ログ全文: %s/%s/build-%s.log\n' "$PWD" "$platform" "$mode" >&2
    result=1
  fi
done
exit "$result"
