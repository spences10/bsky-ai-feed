# AI Tech Feed for Bluesky

A Bluesky custom feed for people who want the technical AI conversation
without the hype cycle.

![AI Tech Feed icon](./assets/feed-icon.png)

AI Tech Feed watches the Bluesky firehose for posts about AI, ML, LLMs,
agents, tooling, research, infrastructure, and practical engineering.
It filters out the obvious noise first, then uses an AI judge to keep the
feed focused on genuinely useful technology posts.

## Built for signal

This feed is tuned for posts that help engineers, researchers, builders,
and curious technologists track what is actually happening in AI:

- model releases, benchmarks, evals, and research notes
- agent frameworks, developer tools, libraries, and infrastructure
- practical lessons from building with AI systems
- thoughtful analysis of capabilities, limitations, safety, and tradeoffs
- links to demos, papers, repos, and technical write-ups

## Not another AI hype feed

The goal is not to capture every post that mentions AI. The feed avoids
low-signal content such as generic marketing, engagement bait,
non-technical hot takes, duplicated viral posts, and casual mentions
where AI is not the subject.

## How it works

- Jetstream supplies live Bluesky post events.
- A local filter keeps likely candidates and drops replies, duplicates,
  and keyword misses.
- A second-stage judge checks whether each candidate is truly about AI
  as a technology.
- Accepted posts are stored and served through the Bluesky custom feed
  protocol.

## Project status

This repo contains the full feed generator: ingest worker, judge layer,
SQLite-backed store, review tools, and HTTP feed server. It is built to
be small, inspectable, and self-hostable while keeping the public README
focused on what the feed is for.
