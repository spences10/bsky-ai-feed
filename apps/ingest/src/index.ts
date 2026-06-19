#!/usr/bin/env node
import {
	filter_candidate_post,
	type CandidatePost,
	type FeedPost,
} from '@bsky-ai-feed/core';
import {
	create_ai_technology_prompt,
	create_configured_judge,
	create_noop_judge,
	type Judge,
} from '@bsky-ai-feed/judge';
import {
	create_sqlite_feed_store,
	type CandidateDecision,
	type FeedStore,
} from '@bsky-ai-feed/store';
import { fileURLToPath } from 'node:url';
import { load_dotenv } from './env.js';
import {
	hydrate_author_handles,
	load_runtime_filter_policy,
} from './filter-policy.js';
import { create_jetstream_url, run_jetstream } from './jetstream.js';
import { create_ingest_status_writer } from './status.js';

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
	quality_threshold?: number;
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
	const quality_threshold = options.quality_threshold ?? 0.65;
	const seen_text = options.seen_text ?? new Set<string>();

	return {
		async process_posts(posts) {
			const filter_policy = await load_runtime_filter_policy(store);
			await hydrate_author_handles(posts, filter_policy);
			const filtered_candidates = posts.flatMap((post) => {
				const result = filter_candidate_post(post, {
					...filter_policy,
					seen_text,
				});
				return result.accepted
					? [{ post, matched_keywords: result.matched_keywords }]
					: [];
			});
			if (filtered_candidates.length === 0) return [];

			const candidates = filtered_candidates.map(({ post }) => post);
			const decisions = await judge.judge_batch({
				posts: candidates,
				prompt: create_ai_technology_prompt({
					filter_keywords: filter_policy.keywords,
				}),
			});
			const decisions_by_uri = new Map(
				decisions.map((decision) => [decision.uri, decision]),
			);
			const judged_at = new Date().toISOString();

			await store.put_decisions?.(
				filtered_candidates.map(({ post, matched_keywords }) => {
					const decision = decisions_by_uri.get(post.uri);
					return {
						uri: post.uri,
						cid: post.cid,
						text: post.text,
						indexed_at: post.indexed_at,
						judged_at,
						accepted:
							decision?.is_ai_technology === true &&
							decision.confidence >= confidence_threshold &&
							(decision.score ?? 0) >= quality_threshold,
						confidence: decision?.confidence ?? 0,
						score: decision?.score ?? 0,
						category: decision?.category,
						reason: decision?.reason,
						matched_keywords,
					} satisfies CandidateDecision;
				}),
			);

			const accepted_posts = filtered_candidates.flatMap(
				({ post, matched_keywords }) => {
					const decision = decisions_by_uri.get(post.uri);
					if (
						!decision?.is_ai_technology ||
						decision.confidence < confidence_threshold ||
						(decision.score ?? 0) < quality_threshold
					) {
						return [];
					}
					return [
						{
							uri: post.uri,
							cid: post.cid,
							accepted_at: judged_at,
							indexed_at: post.indexed_at,
							score: decision.score,
							text: post.text,
							matched_keywords,
							judge_confidence: decision.confidence,
							judge_reason: decision.reason,
							judge_category: decision.category,
						},
					];
				},
			);

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

function parse_optional_number(
	value: string | undefined,
): number | undefined {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

async function run_cli(args: string[]): Promise<void> {
	load_dotenv();
	if (args.includes('--help')) {
		console.log(
			[
				'Usage: pnpm run dev:ingest -- --max=10',
				'',
				'Environment:',
				'  JETSTREAM_HOST defaults to jetstream2.us-east.bsky.network',
				'  BSKY_AI_FEED_DB_PATH overrides .data/feed.sqlite',
				'  BSKY_AI_FEED_STATUS_PATH overrides .data/ingest-status.json',
				'  AI_JUDGE_BATCH_SIZE batches paid judge calls (default 25)',
				'  AI_JUDGE_BATCH_DELAY_MS flushes partial judge batches (default 30000)',
				'',
				`Jetstream URL: ${create_jetstream_url(process.env.JETSTREAM_HOST)}`,
			].join('\n'),
		);
		return;
	}

	const status = create_ingest_status_writer();
	const judge =
		process.env.AI_JUDGE_PROVIDER === 'openai'
			? create_configured_judge()
			: undefined;
	const max_events = parse_max_events(args);
	const seen_text = new Set<string>();
	let retry_delay_ms = 1000;

	while (true) {
		try {
			await run_jetstream({
				mode: 'ingest',
				host: process.env.JETSTREAM_HOST,
				max_events,
				store: create_default_store(),
				judge,
				seen_text,
				judge_batch_size: parse_optional_number(
					process.env.AI_JUDGE_BATCH_SIZE,
				),
				judge_batch_delay_ms: parse_optional_number(
					process.env.AI_JUDGE_BATCH_DELAY_MS,
				),
				on_open: () => {
					retry_delay_ms = 1000;
					status.connected();
				},
				on_result: (result) => status.record(result),
				on_close: () => status.closed(),
			});
			if (max_events) return;
			console.warn(
				`Jetstream closed; reconnecting in ${retry_delay_ms}ms`,
			);
		} catch (error) {
			console.error(
				`Jetstream disconnected: ${error_message(error)}; reconnecting in ${retry_delay_ms}ms`,
			);
		}
		await sleep(retry_delay_ms);
		retry_delay_ms = Math.min(retry_delay_ms * 2, 30_000);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function error_message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await run_cli(process.argv.slice(2));
}
