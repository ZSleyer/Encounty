#!/bin/sh
# 7za wrapper for electron-builder, selected via ELECTRON_BUILDER_7ZIP_PATH.
#
# electron-builder 26 bundles a 7-Zip >= 21.02, which auto-applies the ARM64 BCJ branch
# filter when compressing arm64 executables into app-arm64.7z. The older 7z decoder in
# electron-builder's NSIS install stub does not understand that filter and silently skips
# exactly those files, so the installed app is missing its main exe and native DLLs and
# never starts. Disabling the filter on archive creation (-mf=off) keeps the payload as
# plain LZMA2, which the stub can unpack. Only the "a" (add) command is affected; every
# other invocation passes through unchanged.
for candidate in 7za 7zz 7z; do
  if command -v "$candidate" >/dev/null 2>&1; then
    SZ="$candidate"
    break
  fi
done
if [ -z "$SZ" ]; then
  echo "7za-nofilter.sh: no 7z binary (7za/7zz/7z) found on PATH" >&2
  exit 1
fi

if [ "$1" = "a" ]; then
  exec "$SZ" "$@" -mf=off
fi
exec "$SZ" "$@"
