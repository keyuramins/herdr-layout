#!/bin/sh
# Builds Studio Dictation from main.swift with this Mac's own Swift compiler
# (Xcode or the Command Line Tools), into <mod folder>/.build/, which Herdr's
# hot reload ignores (hidden). Writes build.log, and build.status last: 0 = ok.
#   sh build.sh <mod folder>
mod="$1"
out="$mod/.build"
app="$out/StudioDictation.app"
mkdir -p "$out"
rm -f "$out/build.status"
(
  set -e
  rm -rf "$app.tmp"
  mkdir -p "$app.tmp/Contents/MacOS"
  cp "$mod/dictation/Info.plist" "$app.tmp/Contents/Info.plist"
  xcrun swiftc -swift-version 5 -O "$mod/dictation/main.swift" -o "$app.tmp/Contents/MacOS/StudioDictation"
  codesign --force --sign - "$app.tmp" || true
  rm -rf "$app"
  mv "$app.tmp" "$app"

) > "$out/build.log" 2>&1
echo $? > "$out/build.status"
