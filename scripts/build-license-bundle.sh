#!/usr/bin/env bash
# build-license-bundle.sh - Pack every license that applies to the distributed
# app into one release asset.
#
# Usage: scripts/build-license-bundle.sh <appimage> [output-path]
#   appimage     a built Linux AppImage, used for the Electron and Chromium texts
#   output-path  defaults to electron/release/Encounty-licenses.tar.gz
#
# The AUR package installs the unpacked contents into
# /usr/share/licenses/encounty-bin/. Arch requires a package-local copy for MIT,
# BSD, ISC and Python licenses because their copyright line is specific to each
# package, so pointing at /usr/share/licenses/common/ is not enough.
set -euo pipefail

appimage=${1:?usage: build-license-bundle.sh <appimage> [output-path]}
[ -f "$appimage" ] || { echo "no such AppImage: $appimage" >&2; exit 1; }
appimage=$(readlink -f "$appimage")

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
THIRD_PARTY="$ROOT_DIR/backend/internal/licenses/third_party.json"
output=${2:-"$ROOT_DIR/electron/release/Encounty-licenses.tar.gz"}

[ -f "$THIRD_PARTY" ] || { echo "$THIRD_PARTY missing, run 'make licenses' first" >&2; exit 1; }

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

staging="$TMP_DIR/licenses"
mkdir -p "$staging"

# Encounty's own license.
cp "$ROOT_DIR/LICENSE" "$staging/LICENSE"

# Electron and Chromium ship their texts inside the AppImage. --appimage-extract
# is handled by the runtime itself and needs no FUSE mount, so this also works in
# a build container.
echo "Extracting the runtime licenses from $(basename "$appimage")..."
(cd "$TMP_DIR" && "$appimage" --appimage-extract >/dev/null)

for f in LICENSE.electron.txt LICENSES.chromium.html; do
  if [ ! -f "$TMP_DIR/squashfs-root/$f" ]; then
    echo "$f missing from the AppImage, Electron changed its layout" >&2
    exit 1
  fi
  cp "$TMP_DIR/squashfs-root/$f" "$staging/$f"
done

# Everything collected by scripts/collect_licenses.sh, rendered as plain text.
echo "Rendering THIRD-PARTY.txt from $(jq length "$THIRD_PARTY") entries..."
{
  cat <<'EOHEADER'
Third-party licenses bundled with Encounty
==========================================

Encounty itself is licensed under the GNU Affero General Public License v3.0,
see the LICENSE file next to this one. The components below are redistributed
as part of the application and keep their own licenses.

EOHEADER

  jq -r '
    sort_by(.source, .name)[]
    | "-" * 78,
      "\(.name)\(if .version == "" then "" else " " + .version end)",
      "SPDX-License-Identifier: \(.license)",
      "Origin: \(.source)",
      "-" * 78,
      "",
      .text,
      ""
  ' "$THIRD_PARTY"
} > "$staging/THIRD-PARTY.txt"

mkdir -p "$(dirname "$output")"
tar -czf "$output" -C "$TMP_DIR" licenses

echo "Wrote $output ($(du -h "$output" | cut -f1))"
tar -tzf "$output"
