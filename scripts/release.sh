#!/usr/bin/env bash
#
# Cut or verify a release.
#
# The download link in README.md resolves to
#
#   https://github.com/hanoisolo/children-colouring-book/releases/latest/download/colouring-book.html
#
# which serves whatever asset is attached to the newest non-prerelease release.
# Nothing in `npm test` checks that link, so a hotfix pushed to master with a
# rebuilt dist/ leaves it serving the old file until someone re-uploads the
# asset. That gap is silent: the link keeps working, it just serves stale code.
#
#   scripts/release.sh            preflight: clean tree, on master, full gate, hash
#   scripts/release.sh --verify   download the published asset and compare hashes
#
# Run --verify after uploading the asset. It is the only step that proves the
# link and master agree.
#
set -euo pipefail

REPO="hanoisolo/children-colouring-book"
DIST="dist/colouring-book.html"
ASSET="colouring-book.html"
LATEST="https://github.com/${REPO}/releases/latest/download/${ASSET}"

say() { printf 'release: %s\n' "$*"; }
die() { printf 'release: %s\n' "$*" >&2; exit 1; }

hash_of() { sha256sum "$1" | cut -d' ' -f1; }

# Global, not local: the EXIT trap below fires after verify_published has
# returned, so a `local` would already be out of scope and `set -u` would abort
# the script with "tmp: unbound variable" — reporting failure on a run that
# actually succeeded.
TMPFILE=""
trap 'rm -f "$TMPFILE"' EXIT

verify_published() {
  local expected actual
  [ -f "$DIST" ] || die "$DIST is missing; run 'node build.js' first"

  expected="$(hash_of "$DIST")"
  TMPFILE="$(mktemp)"

  say "downloading $LATEST"
  if ! curl -fsSL "$LATEST" -o "$TMPFILE"; then
    die "could not download the latest release asset"
  fi

  actual="$(hash_of "$TMPFILE")"
  if [ "$expected" != "$actual" ]; then
    die "the published asset does not match $DIST
  dist:      $expected
  published: $actual
Re-upload $DIST to the latest release."
  fi

  say "published asset matches $DIST ($expected)"
}

preflight() {
  local branch dirty

  branch="$(git rev-parse --abbrev-ref HEAD)"
  [ "$branch" = "master" ] || die "on branch '$branch', expected master"

  dirty="$(git status --porcelain)"
  [ -z "$dirty" ] || die "working tree is dirty; commit or stash first"
  say "tree clean on master"

  say "running the full gate"
  npm test

  # The gate includes the bundle-freshness test, so a stale dist/ has already
  # failed by now. Rebuilding anyway means the hash below describes the file
  # this script just produced rather than one it assumed.
  say "rebuilding the bundle"
  node build.js

  dirty="$(git status --porcelain -- "$DIST")"
  [ -z "$dirty" ] || die "$DIST changed during the build; commit the rebuilt bundle"

  say "sha256 $(hash_of "$DIST")"
  say "attach $DIST as $ASSET to the release, then run: scripts/release.sh --verify"
}

case "${1:-}" in
  --verify) verify_published ;;
  "") preflight ;;
  *) die "unknown argument: $1" ;;
esac
