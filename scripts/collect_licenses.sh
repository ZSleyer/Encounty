#!/usr/bin/env bash
# collect_licenses.sh — Collects all third-party license information
# into a single JSON file that gets embedded into the binary.
#
# Output: internal/licenses/third_party.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$ROOT_DIR/backend/internal/licenses"
OUT_FILE="$OUT_DIR/third_party.json"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$OUT_DIR"

# Generate a fallback license text when no LICENSE file is found in the package.
# Args: $1 = license_type (e.g. "MIT"), $2 = package name
generate_fallback_license_text() {
  local license_type="$1"
  local pkg_name="$2"

  case "$license_type" in
    MIT)
      cat <<EOMIT
MIT License

Copyright (c) $pkg_name

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOMIT
      ;;
    Unlicense)
      cat <<EOUNLICENSE
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
EOUNLICENSE
      ;;
    *)
      echo "This package is licensed under $license_type. See the package repository for the full license text."
      ;;
  esac
}

# Search for a license file in a given directory, trying common name variants.
# Args: $1 = directory to search in
# Prints the path to the first match, or nothing if not found.
find_license_file() {
  local dir="$1"
  for candidate in LICENSE LICENSE.md LICENSE.txt LICENSE-MIT LICENSE-MIT.txt LICENCE license license.md license.txt UNLICENSE UNLICENSE.md UNLICENSE.txt; do
    if [ -f "$dir/$candidate" ]; then
      echo "$dir/$candidate"
      return
    fi
  done
}

GO_LICENSES="$(go env GOPATH)/bin/go-licenses"
if ! command -v "$GO_LICENSES" &>/dev/null; then
  echo "Installing go-licenses..."
  go install github.com/google/go-licenses@latest
fi

# --- Go dependencies ---------------------------------------------------------
echo "Collecting Go licenses..."
GO_SAVE_DIR="$TMP_DIR/go"
cd "$ROOT_DIR/backend"
"$GO_LICENSES" save ./... --save_path="$GO_SAVE_DIR" --ignore github.com/zsleyer/encounty 2>/dev/null || true

# Build Go entries using a Python-free jq-only approach:
# read the report line by line, look up license text from saved files
echo '[]' > "$TMP_DIR/go_entries.json"

"$GO_LICENSES" report ./... --ignore github.com/zsleyer/encounty 2>/dev/null | while IFS=, read -r mod url license_type; do
  [ -z "$mod" ] && continue
  version=$(echo "$url" | grep -oP 'v[0-9]+\.[0-9]+(\.[0-9]+)?' || echo "")
  license_file=$(find "$GO_SAVE_DIR/$mod" -maxdepth 1 \( -iname 'LICENSE*' -o -iname 'COPYING*' \) 2>/dev/null | head -1 || true)
  # Fallback: check Go module cache if go-licenses didn't save this module
  if [ -z "$license_file" ]; then
    mod_cache="$(go env GOMODCACHE)/${mod}@*"
    # shellcheck disable=SC2086
    license_file=$(find $mod_cache -maxdepth 1 \( -iname 'LICENSE*' -o -iname 'COPYING*' \) 2>/dev/null | head -1 || true)
  fi
  if [ -n "$license_file" ]; then
    # Use jq --rawfile to safely read the license text (handles all special chars)
    jq -n \
      --arg name "$mod" \
      --arg version "$version" \
      --arg license "$license_type" \
      --rawfile text "$license_file" \
      --arg source "go" \
      '{name: $name, version: $version, license: $license, text: $text, source: $source}' \
      >> "$TMP_DIR/go_entry_parts.jsonl"
  else
    fallback_text=$(generate_fallback_license_text "$license_type" "$mod")
    jq -n \
      --arg name "$mod" \
      --arg version "$version" \
      --arg license "$license_type" \
      --arg text "$fallback_text" \
      --arg source "go" \
      '{name: $name, version: $version, license: $license, text: $text, source: $source}' \
      >> "$TMP_DIR/go_entry_parts.jsonl"
  fi
done

if [ -f "$TMP_DIR/go_entry_parts.jsonl" ]; then
  jq -s '.' "$TMP_DIR/go_entry_parts.jsonl" > "$TMP_DIR/go_entries.json"
fi

# --- npm dependencies (production only) --------------------------------------
echo "Collecting npm licenses..."
cd "$ROOT_DIR/frontend"

echo '[]' > "$TMP_DIR/npm_entries.json"
npx --yes license-report --only=prod --output=json 2>/dev/null > "$TMP_DIR/npm_report.json" || echo "[]" > "$TMP_DIR/npm_report.json"

# Process each npm dependency
jq -c '.[]' "$TMP_DIR/npm_report.json" | while read -r row; do
  name=$(echo "$row" | jq -r '.name')
  version=$(echo "$row" | jq -r '.installedVersion')
  license_type=$(echo "$row" | jq -r '.licenseType')

  # Search for license file with expanded name variants
  license_file=$(find_license_file "node_modules/$name")

  # For scoped packages (@scope/pkg), check the parent scope directory
  if [ -z "$license_file" ] && [[ "$name" == @*/* ]]; then
    scope_dir="node_modules/${name%%/*}"
    license_file=$(find_license_file "$scope_dir")
  fi

  if [ -n "$license_file" ]; then
    jq -n \
      --arg name "$name" \
      --arg version "$version" \
      --arg license "$license_type" \
      --rawfile text "$license_file" \
      --arg source "npm" \
      '{name: $name, version: $version, license: $license, text: $text, source: $source}' \
      >> "$TMP_DIR/npm_entry_parts.jsonl"
  else
    fallback_text=$(generate_fallback_license_text "$license_type" "$name")
    jq -n \
      --arg name "$name" \
      --arg version "$version" \
      --arg license "$license_type" \
      --arg text "$fallback_text" \
      --arg source "npm" \
      '{name: $name, version: $version, license: $license, text: $text, source: $source}' \
      >> "$TMP_DIR/npm_entry_parts.jsonl"
  fi
done

if [ -f "$TMP_DIR/npm_entry_parts.jsonl" ]; then
  jq -s '.' "$TMP_DIR/npm_entry_parts.jsonl" > "$TMP_DIR/npm_entries.json"
fi

# --- Shipped devDependencies --------------------------------------------------
# These are devDependencies whose output ends up in the distributed app:
#   - tailwindcss: CSS output is compiled into the frontend bundle
#   - electron: the app runtime itself
echo "Collecting shipped devDependency licenses..."

SHIPPED_DEVDEPS="frontend:tailwindcss electron:electron"
for entry in $SHIPPED_DEVDEPS; do
  pkg_dir="${entry%%:*}"
  pkg_name="${entry##*:}"
  pkg_root="$ROOT_DIR/$pkg_dir/node_modules/$pkg_name"

  if [ ! -d "$pkg_root" ]; then
    echo "  WARN: $pkg_dir/node_modules/$pkg_name not found, skipping"
    continue
  fi

  version=$(jq -r '.version // ""' "$pkg_root/package.json")
  license_type=$(jq -r '.license // ""' "$pkg_root/package.json")

  # Search for license file with expanded name variants
  license_file=$(find_license_file "$pkg_root")

  # For scoped packages (@scope/pkg), check the parent scope directory
  if [ -z "$license_file" ] && [[ "$pkg_name" == @*/* ]]; then
    scope_dir="$(dirname "$pkg_root")/${pkg_name%%/*}"
    license_file=$(find_license_file "$scope_dir")
  fi

  if [ -n "$license_file" ]; then
    jq -n \
      --arg name "$pkg_name" \
      --arg version "$version" \
      --arg license "$license_type" \
      --rawfile text "$license_file" \
      --arg source "npm" \
      '{name: $name, version: $version, license: $license, text: $text, source: $source}' \
      >> "$TMP_DIR/npm_entry_parts.jsonl"
  else
    fallback_text=$(generate_fallback_license_text "$license_type" "$pkg_name")
    jq -n \
      --arg name "$pkg_name" \
      --arg version "$version" \
      --arg license "$license_type" \
      --arg text "$fallback_text" \
      --arg source "npm" \
      '{name: $name, version: $version, license: $license, text: $text, source: $source}' \
      >> "$TMP_DIR/npm_entry_parts.jsonl"
  fi
  echo "  Added $pkg_name@$version ($license_type)"
done

# Re-aggregate npm entries (now includes shipped devDeps)
if [ -f "$TMP_DIR/npm_entry_parts.jsonl" ]; then
  jq -s '.' "$TMP_DIR/npm_entry_parts.jsonl" > "$TMP_DIR/npm_entries.json"
fi

cd "$ROOT_DIR"

# --- Merge and write ----------------------------------------------------------
jq -s '.[0] + .[1]' "$TMP_DIR/go_entries.json" "$TMP_DIR/npm_entries.json" > "$OUT_FILE"

count=$(jq length "$OUT_FILE")
echo "Wrote $count license entries to $OUT_FILE"
