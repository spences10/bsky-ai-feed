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
- `packages/store` — feed storage interface, in-memory test store, and
  `node:sqlite` store.
- `apps/ingest` — Jetstream ingest worker for keyword-filtered posts.
- `apps/feed-server` — HTTP feed generator.

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
cp .env.example .env
pnpm run check
pnpm run test
pnpm run build
```

Run the local product loop against the shared SQLite database:

```sh
pnpm run dev
```

Then open <http://localhost:3000/>. It returns JSON with ingest
status, the feed DID/endpoints, and the exact feed skeleton rows that
will be served to Bluesky. The raw feed skeleton is still available
at:

```sh
curl 'http://localhost:3000/xrpc/app.bsky.feed.getFeedSkeleton?feed=test'
```

For production-style runs after building:

```sh
pnpm run build
pnpm start
```
