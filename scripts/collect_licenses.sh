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
SPDX_FILE="$ROOT_DIR/packaging/aur/licenses.spdx"

# Licenses of Encounty's own code. Everything else comes from OUT_FILE.
OWN_LICENSES=('AGPL-3.0-only')

# print_spdx_list - deduplicated, sorted SPDX identifiers of everything the
# distributed app ships. Feeds license=() in packaging/aur/PKGBUILD.in.
#
# "A AND B" means both apply, so it is split into its components. "A OR B" is a
# choice and stays intact, splitting it would claim obligations that never
# applied.
print_spdx_list() {
  {
    printf '%s\n' "${OWN_LICENSES[@]}"
    jq -r '.[].license | split(" AND ")[]' "$OUT_FILE"
  } | sort -u
}

if [ "${1:-}" = "--spdx-list" ]; then
  if [ ! -f "$OUT_FILE" ]; then
    echo "$OUT_FILE is missing, run 'make licenses' first" >&2
    exit 1
  fi
  print_spdx_list
  exit 0
fi

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
# resolve_package_dir - locate an installed package inside node_modules. Yarn
# hoists almost everything to the top level, but a version conflict can leave a
# copy nested under its dependent.
# Args: $1 = package name
resolve_package_dir() {
  local name="$1"
  if [ -f "node_modules/$name/package.json" ]; then
    echo "node_modules/$name"
    return
  fi
  find node_modules -maxdepth 4 -type d -path "*/node_modules/$name" -print -quit 2>/dev/null
}

# read_package_license - SPDX identifier out of a package.json, covering both
# the current string form and the legacy object and array forms.
# Args: $1 = path to package.json
read_package_license() {
  jq -r '
    if (.license | type) == "string" then .license
    elif (.license | type) == "object" then (.license.type // "")
    elif (.licenses | type) == "array" then (.licenses[0].type // "")
    else "" end
  ' "$1" 2>/dev/null
}

# collect_npm_dir - append the full production dependency closure of one
# workspace to the shared entry list. Both workspaces ship into the distributed
# app: frontend/ becomes the web bundle, electron/ becomes app.asar.
#
# "yarn list --production" walks the whole tree, unlike license-report, which
# only ever reported the direct dependencies named in package.json and so left
# every transitive dependency unattributed.
# Args: $1 = workspace directory relative to the repository root
collect_npm_dir() {
  local workspace="$1"
  local entry name version pkg_dir license_type license_file scope_dir fallback_text

  echo "Collecting npm licenses in ${workspace}/..."
  cd "$ROOT_DIR/$workspace"

  yarn list --production --json --no-progress 2>/dev/null \
    | jq -r 'select(.type == "tree") | .data.trees[].name' \
    > "$TMP_DIR/npm_tree.txt" || : > "$TMP_DIR/npm_tree.txt"

  if [ ! -s "$TMP_DIR/npm_tree.txt" ]; then
    echo "  ERROR: yarn list returned nothing in ${workspace}/, are dependencies installed?" >&2
    exit 1
  fi

  while read -r entry; do
    [ -z "$entry" ] && continue
    # Split "@scope/pkg@1.2.3" on the last "@" into name and version.
    name="${entry%@*}"
    version="${entry##*@}"

    pkg_dir=$(resolve_package_dir "$name")
    if [ -z "$pkg_dir" ]; then
      echo "  WARN: $name not found in ${workspace}/node_modules, skipping" >&2
      continue
    fi

    license_type=$(read_package_license "$pkg_dir/package.json")

    # Search for license file with expanded name variants
    license_file=$(find_license_file "$pkg_dir")

    # For scoped packages (@scope/pkg), check the parent scope directory
    if [ -z "$license_file" ] && [[ "$name" == @*/* ]]; then
      scope_dir="$(dirname "$pkg_dir")"
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
  done < "$TMP_DIR/npm_tree.txt"
}

echo '[]' > "$TMP_DIR/npm_entries.json"
collect_npm_dir frontend
collect_npm_dir electron

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
# extra_licenses.json holds hand-maintained entries for data sources that are
# neither a Go module nor an npm package (the reference data generated by
# scripts/gen-catchrefs). Without this merge a regeneration would silently drop
# their attribution.
jq -s '.[0] + .[1] + .[2]' \
  "$TMP_DIR/go_entries.json" \
  "$TMP_DIR/npm_entries.json" \
  "$SCRIPT_DIR/extra_licenses.json" > "$TMP_DIR/merged.json"

# --- Normalise to SPDX --------------------------------------------------------
# Packages whose metadata carries no machine-readable identifier. Each value is
# read off that package's own LICENSE file, so verify before adding an entry.
#
# ponytail: a lookup table instead of an SPDX scanner dependency (reuse,
# licensee). One entry so far. Revisit once this grows past a dozen.
SPDX_OVERRIDE=$(jq -n '{
  "modernc.org/mathutil": "BSD-3-Clause"
}')

# Deprecated or non-SPDX spellings that upstreams still publish.
SPDX_ALIAS=$(jq -n '{
  "GPL-3.0": "GPL-3.0-only",
  "GPL-2.0": "GPL-2.0-only",
  "LGPL-3.0": "LGPL-3.0-only",
  "LGPL-2.1": "LGPL-2.1-only",
  "AGPL-3.0": "AGPL-3.0-only",
  "Apache 2.0": "Apache-2.0",
  "Apache License 2.0": "Apache-2.0",
  "BSD-3": "BSD-3-Clause",
  "BSD-2": "BSD-2-Clause"
}')

jq --argjson override "$SPDX_OVERRIDE" --argjson alias "$SPDX_ALIAS" '
  map(.license = ($override[.name] // .license))
  | map(.license = ($alias[.license] // .license))
  | unique_by([.source, .name, .version])
' "$TMP_DIR/merged.json" > "$OUT_FILE"

# A wrong attribution is worse than a failed build: an ambiguous identifier
# cannot be turned into a valid license=() entry for the AUR package.
invalid=$(jq -r '
  .[]
  | select(.license == null or .license == ""
           or (.license | test("^(Unknown|UNKNOWN|NOASSERTION|UNLICENSED|BSD|GPL)$")))
  | "  \(.source)/\(.name): \(.license // "<empty>")"
' "$OUT_FILE")

if [ -n "$invalid" ]; then
  echo "Ambiguous license identifiers, add them to SPDX_OVERRIDE or SPDX_ALIAS:" >&2
  echo "$invalid" >&2
  exit 1
fi

print_spdx_list > "$SPDX_FILE"

count=$(jq length "$OUT_FILE")
echo "Wrote $count license entries to $OUT_FILE"
echo "Wrote $(wc -l < "$SPDX_FILE") SPDX identifiers to $SPDX_FILE"
