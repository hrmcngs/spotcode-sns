#!/bin/sh
# Diagnostic failures must not replace the original archive result.
set -u

echo "Spotcode: archive result diagnostics"
date -u '+UTC %Y-%m-%dT%H:%M:%SZ'
if [ -z "${CI_RESULT_BUNDLE_PATH:-}" ] || [ ! -d "$CI_RESULT_BUNDLE_PATH" ]; then
    echo "No result bundle is available. Download the Archive action logs from Xcode Cloud."
    exit 0
fi

# Cloud may terminate before finalizing a result bundle or running this hook.
# Print to stdout: files created by custom scripts are not retained as artifacts.
echo "Build result summary:"
xcrun xcresulttool get build-results --path "$CI_RESULT_BUNDLE_PATH" --compact ||
    echo "Unable to read the build summary; the result bundle may be incomplete."
echo "Last build log lines:"
result_log=$(mktemp -t spotcode-build-log) || exit 0
trap 'rm -f "$result_log"' EXIT HUP INT TERM
if xcrun xcresulttool get log --path "$CI_RESULT_BUNDLE_PATH" --type build > "$result_log"; then
    tail -c 40000 "$result_log"
else
    echo "Unable to read the build log; download the Archive action logs."
fi
exit 0
