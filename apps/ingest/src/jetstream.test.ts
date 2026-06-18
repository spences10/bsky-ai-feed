import type { Judge } from '@bsky-ai-feed/judge';
import { describe, expect, it } from 'vitest';
import {
	candidate_post_from_jetstream_event,
	process_jetstream_message,
} from './jetstream.js';

const post_event = {
	kind: 'commit',
	did: 'did:plc:example',
	time_us: 1_767_225_600_000_000,
	commit: {
		operation: 'create',
		collection: 'app.bsky.feed.post',
		rkey: 'abc123',
		cid: 'bafyexample',
		record: {
			text: 'OpenAI released a new model today',
			langs: ['en'],
		},
	},
};

const high_signal_judge: Judge = {
	async judge_batch(batch) {
		return batch.posts.map((post) => ({
			uri: post.uri,
			is_ai_technology: true,
			confidence: 0.96,
			score: 0.88,
			category: 'model-research',
			reason: 'concrete model release',
		}));
	},
};

const low_signal_judge: Judge = {
	async judge_batch(batch) {
		return batch.posts.map((post) => ({
			uri: post.uri,
			is_ai_technology: true,
			confidence: 0.95,
			score: 0.2,
			category: 'spam',
			reason: 'keyword bait',
		}));
	},
};

describe('candidate_post_from_jetstream_event', () => {
	it('converts Jetstream post creates into candidate posts', () => {
		expect(candidate_post_from_jetstream_event(post_event)).toEqual({
			uri: 'at://did:plc:example/app.bsky.feed.post/abc123',
			cid: 'bafyexample',
			text: 'OpenAI released a new model today',
			lang: 'en',
			indexed_at: '2026-01-01T00:00:00.000Z',
		});
	});

	it('ignores non-post events', () => {
		expect(
			candidate_post_from_jetstream_event({
				...post_event,
				commit: {
					...post_event.commit,
					collection: 'app.bsky.feed.like',
				},
			}),
		).toBeUndefined();
	});
});

describe('process_jetstream_message', () => {
	it('accepts keyword hits in ingest mode without a configured judge', async () => {
		const written_posts: unknown[] = [];
		await expect(
			process_jetstream_message(JSON.stringify(post_event), {
				mode: 'ingest',
				store: {
					async put_posts(posts) {
						written_posts.push(...posts);
					},
					async get_feed_page() {
						return { posts: [] };
					},
					async delete_older_than() {
						return 0;
					},
				},
			}),
		).resolves.toMatchObject({ kind: 'accepted' });
		expect(written_posts).toHaveLength(1);
	});

	it('stores judge metadata for accepted posts', async () => {
		const written_posts: unknown[] = [];
		const written_decisions: unknown[] = [];
		await expect(
			process_jetstream_message(JSON.stringify(post_event), {
				mode: 'ingest',
				judge: high_signal_judge,
				store: {
					async put_posts(posts) {
						written_posts.push(...posts);
					},
					async put_decisions(decisions) {
						written_decisions.push(...decisions);
					},
					async get_feed_page() {
						return { posts: [] };
					},
					async delete_older_than() {
						return 0;
					},
				},
			}),
		).resolves.toMatchObject({ kind: 'accepted' });
		expect(written_posts).toMatchObject([
			{
				score: 0.88,
				judge_confidence: 0.96,
				judge_category: 'model-research',
				matched_keywords: ['OpenAI'],
			},
		]);
		expect(written_decisions).toMatchObject([
			{ accepted: true, score: 0.88 },
		]);
	});

	it('rejects topical but low-signal judge decisions', async () => {
		const written_posts: unknown[] = [];
		const written_decisions: unknown[] = [];
		await expect(
			process_jetstream_message(JSON.stringify(post_event), {
				mode: 'ingest',
				judge: low_signal_judge,
				store: {
					async put_posts(posts) {
						written_posts.push(...posts);
					},
					async put_decisions(decisions) {
						written_decisions.push(...decisions);
					},
					async get_feed_page() {
						return { posts: [] };
					},
					async delete_older_than() {
						return 0;
					},
				},
			}),
		).resolves.toMatchObject({
			kind: 'rejected',
			reason: 'keyword bait',
		});
		expect(written_posts).toHaveLength(0);
		expect(written_decisions).toMatchObject([
			{ accepted: false, score: 0.2, category: 'spam' },
		]);
	});
});
