# bsky-ai-feed

Self-hosted Bluesky custom feed for high-signal posts about AI as a
technology.

## Product shape

- Consume Jetstream post records only.
- Run a cheap local stage 1 filter first: English posts only, no
  replies, near-duplicate suppression, and word-boundary AI keyword
  matching.
- Batch stage 1 survivors through an AI judge that decides whether
  each post is actually about AI, ML, or LLMs as technology.
- Store accepted post URIs with CIDs and timestamps.
- Serve feed skeletons from stored URIs, newest first, with opaque
  cursor pagination.

## Workspace layout

- `packages/core` — shared post types, keywords, and local filters.
- `packages/judge` — AI judge interface and prompt contract.
- `packages/store` — feed storage interface and in-memory test store.
- `apps/ingest` — Jetstream ingest pipeline skeleton.
- `apps/feed-server` — HTTP feed generator skeleton.

## Research notes

- Bluesky custom feeds return skeleton post URIs; AppView hydrates
  posts for clients.
- Feed skeleton requests accept and return an opaque cursor; Bluesky
  recommends a unique per-feed-item cursor such as timestamp plus CID.
- Generic non-personalized feeds do not need request auth.
- Jetstream provides JSON firehose events and supports query filtering
  to receive only post records.
- Official docs suggest garbage-collecting short-lived feed data
  around 48 hours unless the algorithm is meant to preserve missed
  history.

Sources checked with OmniSearch: Bluesky Custom Feeds docs, Bluesky
Firehose docs, `bluesky-social/feed-generator`, and
`bluesky-social/jetstream`.

## Local validation

```sh
pnpm install
pnpm run check
pnpm run test
pnpm run build
```
