#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
IOS_DIR=$(dirname "$SCRIPT_DIR")
PROJECT_PATH="$IOS_DIR/App.xcodeproj/project.pbxproj"

# The iOS app is native SwiftUI and has no CocoaPods or npm dependencies.
# Xcode Cloud only needs the checked-in Xcode project.
if [ ! -f "$PROJECT_PATH" ]; then
    echo "error: Xcode project was not found at $PROJECT_PATH" >&2
    exit 1
fi

echo "SwiftUI project found. No post-clone dependencies to install."
