#!/bin/bash
set -euo pipefail
# Preserve the existing archive command and its additional xcodebuild arguments.
exec bash "$(dirname "$0")/../macos/build.sh" archive "$@"
