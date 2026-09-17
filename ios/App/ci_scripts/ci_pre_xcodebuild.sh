#!/bin/sh
set -eu

# Record toolchain identity without exposing the build environment or secrets.
echo "Spotcode: archive environment"
date -u '+UTC %Y-%m-%dT%H:%M:%SZ'
xcodebuild -version
xcrun swiftc --version
sw_vers
