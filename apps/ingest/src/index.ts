#!/usr/bin/env node
import {
	filter_candidate_post,
	type CandidatePost,
	type FeedPost,
} from '@bsky-ai-feed/core';
import {
	ai_technology_prompt,
	create_noop_judge,
	type Judge,
} from '@bsky-ai-feed/judge';
import {
	create_sqlite_feed_store,
	type FeedStore,
} from '@bsky-ai-feed/store';
import { fileURLToPath } from 'node:url';
import { create_jetstream_url, run_jetstream } from './jetstream.js';

export {
	candidate_post_from_jetstream_event,
	create_jetstream_url,
	process_jetstream_message,
	run_jetstream,
} from './jetstream.js';
export type {
	JetstreamMessageResult,
	JetstreamRunMode,
	JetstreamRunOptions,
} from './jetstream.js';

export type IngestPipelineOptions = {
	judge?: Judge;
	store?: FeedStore;
	confidence_threshold?: number;
	seen_text?: Set<string>;
	database_path?: string;
};

export type IngestPipeline = {
	process_posts(posts: CandidatePost[]): Promise<FeedPost[]>;
};

export function create_ingest_pipeline(
	options: IngestPipelineOptions = {},
): IngestPipeline {
	const judge = options.judge ?? create_noop_judge();
	const store =
		options.store ??
		create_sqlite_feed_store({
			path:
				options.database_path ??
				process.env.BSKY_AI_FEED_DB_PATH ??
				default_database_path(),
		});
	const confidence_threshold = options.confidence_threshold ?? 0.7;
	const seen_text = options.seen_text ?? new Set<string>();

	return {
		async process_posts(posts) {
			const candidates = posts.filter(
				(post) => filter_candidate_post(post, { seen_text }).accepted,
			);
			if (candidates.length === 0) return [];

			const decisions = await judge.judge_batch({
				posts: candidates,
				prompt: ai_technology_prompt,
			});
			const accepted_uris = new Set(
				decisions
					.filter(
						(decision) =>
							decision.is_ai_technology &&
							decision.confidence >= confidence_threshold,
					)
					.map((decision) => decision.uri),
			);
			const accepted_posts = candidates
				.filter((post) => accepted_uris.has(post.uri))
				.map((post) => ({
					uri: post.uri,
					cid: post.cid,
					accepted_at: new Date().toISOString(),
					indexed_at: post.indexed_at,
				}));

			await store.put_posts(accepted_posts);
			return accepted_posts;
		},
	};
}

function default_database_path(): string {
	return fileURLToPath(
		new URL('../../../.data/feed.sqlite', import.meta.url),
	);
}

function create_default_store(): FeedStore {
	return create_sqlite_feed_store({
		path: process.env.BSKY_AI_FEED_DB_PATH ?? default_database_path(),
	});
}

function parse_max_events(args: string[]): number | undefined {
	const max_arg = args.find((arg) => arg.startsWith('--max='));
	if (!max_arg) return undefined;
	const max_events = Number(max_arg.slice('--max='.length));
	return Number.isFinite(max_events) ? max_events : undefined;
}

async function run_cli(args: string[]): Promise<void> {
	if (args.includes('--help')) {
		console.log(
			[
				'Usage: pnpm run dev:ingest -- --max=10',
				'',
				'Environment:',
				'  JETSTREAM_HOST defaults to jetstream2.us-east.bsky.network',
				'  BSKY_AI_FEED_DB_PATH overrides .data/feed.sqlite',
				'',
				`Jetstream URL: ${create_jetstream_url(process.env.JETSTREAM_HOST)}`,
			].join('\n'),
		);
		return;
	}

	await run_jetstream({
		mode: 'ingest',
		host: process.env.JETSTREAM_HOST,
		max_events: parse_max_events(args),
		store: create_default_store(),
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await run_cli(process.argv.slice(2));
}
