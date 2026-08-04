#!/usr/bin/env bash
# Render packaging/aur/PKGBUILD.in into a ready-to-push PKGBUILD for one release.
#
# Usage: scripts/render-aur-pkgbuild.sh <version> [output-path]
#   version      release version without the leading "v", e.g. 0.19.1
#   output-path  defaults to packaging/aur/PKGBUILD
#
# Checksums are taken from the assets actually published on the GitHub release,
# not from a local build, so the AUR package can only ever point at bytes users
# would download themselves.
#
# ponytail: plain curl plus sha256sum instead of running updpkgsums in an Arch
# container. makepkg would have to be taught about both architectures and would
# pull a container image for four hashes. Revisit if the PKGBUILD ever grows
# sources that cannot be hashed by fetching a URL.
set -euo pipefail

version=${1:?usage: render-aur-pkgbuild.sh <version> [output-path]}
version=${version#v}

repo_root=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)
template="${repo_root}/packaging/aur/PKGBUILD.in"
desktop="${repo_root}/packaging/aur/encounty.desktop"
spdx="${repo_root}/packaging/aur/licenses.spdx"
output=${2:-"${repo_root}/packaging/aur/PKGBUILD"}

if [ ! -s "$spdx" ]; then
  echo "${spdx} is missing or empty, run 'make licenses'" >&2
  exit 1
fi

release="https://github.com/ZSleyer/Encounty/releases/download/v${version}"
icon="https://raw.githubusercontent.com/ZSleyer/Encounty/v${version}/backend/winres/icon.png"

# sha256 of a zero-byte stream. curl writes nothing on a failed transfer, so
# without this check a missing release asset would be published as a valid
# looking checksum that every user then trips over at install time.
_empty_sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

# remote_sha256 URL - stream the asset through sha256sum without keeping it on disk.
remote_sha256() {
  local url=$1 sum
  # curl sits at the head of the pipe, so its status has to be forwarded out of
  # the subshell explicitly; the pipeline's own status is sha256sum's.
  if ! sum=$(curl -fsSL --retry 3 --retry-delay 5 "$url" | sha256sum | cut -d' ' -f1
             exit "${PIPESTATUS[0]}"); then
    echo "failed to fetch ${url}" >&2
    return 1
  fi
  if [ -z "$sum" ] || [ "$sum" = "$_empty_sha256" ]; then
    echo "${url} produced an empty response" >&2
    return 1
  fi
  printf '%s' "$sum"
}

sha_x86_64=$(remote_sha256 "${release}/Encounty-x86_64.AppImage")
sha_aarch64=$(remote_sha256 "${release}/Encounty-arm64.AppImage")
sha_licenses=$(remote_sha256 "${release}/Encounty-licenses.tar.gz")
sha_icon=$(remote_sha256 "$icon")
sha_desktop=$(sha256sum "$desktop" | cut -d' ' -f1)

# One quoted SPDX identifier per line becomes the body of license=().
license_array=$(sed "s/.*/'&'/" "$spdx" | paste -sd' ' -)

sed -e "s|@VERSION@|${version}|g" \
    -e "s|@SHA_X86_64@|${sha_x86_64}|g" \
    -e "s|@SHA_AARCH64@|${sha_aarch64}|g" \
    -e "s|@SHA_LICENSES@|${sha_licenses}|g" \
    -e "s|@SHA_ICON@|${sha_icon}|g" \
    -e "s|@SHA_DESKTOP@|${sha_desktop}|g" \
    -e "s|@LICENSE_ARRAY@|${license_array}|g" \
    "$template" > "$output"

if grep -q '@[A-Z_]*@' "$output"; then
  echo "unsubstituted placeholders left in ${output}:" >&2
  grep -n '@[A-Z_]*@' "$output" >&2
  exit 1
fi

echo "rendered ${output} for v${version}"
