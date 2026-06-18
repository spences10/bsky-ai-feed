#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

export FEEDGEN_DID="${FEEDGEN_DID:-did:web:bsky-ai.devhub.party}"
export BSKY_HANDLE="${BSKY_HANDLE:-scottspence.dev}"
export BSKY_FEED_RKEY="${BSKY_FEED_RKEY:-ai-feed}"
export BSKY_FEED_DISPLAY_NAME="${BSKY_FEED_DISPLAY_NAME:-AI Tech Feed}"
export BSKY_FEED_DESCRIPTION="${BSKY_FEED_DESCRIPTION:-High-signal posts about AI as a technology.}"
export BSKY_PDS_URL="${BSKY_PDS_URL:-https://eurosky.social}"

if [[ "${1:-}" != "--use-env" ]]; then
	unset BSKY_APP_PASSWORD
fi

if [[ -z "${BSKY_APP_PASSWORD:-}" ]]; then
	printf 'Bluesky app password for %s: ' "$BSKY_HANDLE" >&2
	read -rs BSKY_APP_PASSWORD
	printf '\n' >&2
	export BSKY_APP_PASSWORD
fi

printf 'Publishing feed generator:\n' >&2
printf '  handle: %s\n' "$BSKY_HANDLE" >&2
printf '  service DID: %s\n' "$FEEDGEN_DID" >&2
printf '  rkey: %s\n' "$BSKY_FEED_RKEY" >&2
printf '  display name: %s\n' "$BSKY_FEED_DISPLAY_NAME" >&2

pnpm run publish:plan
