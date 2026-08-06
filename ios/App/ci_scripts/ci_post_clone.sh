#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
IOS_DIR=$(dirname -- "$SCRIPT_DIR")
REPOSITORY_DIR=$(CDPATH= cd -- "$IOS_DIR/../.." && pwd)

cd "$REPOSITORY_DIR"
npm ci --ignore-scripts

cd "$IOS_DIR"
pod install
