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
	create_memory_feed_store,
	type FeedStore,
} from '@bsky-ai-feed/store';

export type IngestPipelineOptions = {
	judge?: Judge;
	store?: FeedStore;
	confidence_threshold?: number;
	seen_text?: Set<string>;
};

export type IngestPipeline = {
	process_posts(posts: CandidatePost[]): Promise<FeedPost[]>;
};

export function create_ingest_pipeline(
	options: IngestPipelineOptions = {},
): IngestPipeline {
	const judge = options.judge ?? create_noop_judge();
	const store = options.store ?? create_memory_feed_store();
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

export function create_jetstream_url(
	host = 'jetstream2.us-east.bsky.network',
): string {
	const url = new URL(`wss://${host}/subscribe`);
	url.searchParams.set('wantedCollections', 'app.bsky.feed.post');
	return url.toString();
}

if (import.meta.url === `file://${process.argv[1]}`) {
	console.log(
		`Ingest worker skeleton ready. Jetstream URL: ${create_jetstream_url()}`,
	);
}
