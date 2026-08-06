#!/bin/sh

set -eu

# Xcode Cloud's non-interactive shell can omit Homebrew from PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

install_with_homebrew() {
    package=$1

    if ! command -v brew >/dev/null 2>&1; then
        echo "error: Homebrew is required to install $package, but brew is not available." >&2
        exit 1
    fi

    brew install "$package"
}

if ! command -v npm >/dev/null 2>&1; then
    echo "npm not found; installing Node.js with Homebrew."
    install_with_homebrew node
fi

if ! command -v pod >/dev/null 2>&1; then
    echo "pod not found; installing CocoaPods with Homebrew."
    install_with_homebrew cocoapods
fi

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
IOS_DIR=$(dirname "$SCRIPT_DIR")
REPOSITORY_DIR=$(CDPATH= cd "$IOS_DIR/../.." && pwd)

echo "Node: $(node --version)"
echo "npm: $(npm --version)"
echo "CocoaPods: $(pod --version)"

cd "$REPOSITORY_DIR"
npm ci --ignore-scripts

cd "$IOS_DIR"
pod install
