import type { Judge } from '@bsky-ai-feed/judge';
import { describe, expect, it } from 'vitest';
import {
	create_ingest_pipeline,
	create_jetstream_url,
} from './index.js';

const accepting_judge: Judge = {
	async judge_batch(batch) {
		return batch.posts.map((post) => ({
			uri: post.uri,
			is_ai_technology: true,
			confidence: 0.95,
		}));
	},
};

describe('create_ingest_pipeline', () => {
	it('stores posts that pass keyword filtering and AI judging', async () => {
		const pipeline = create_ingest_pipeline({
			judge: accepting_judge,
		});

		const accepted_posts = await pipeline.process_posts([
			{
				uri: 'at://did:example/app.bsky.feed.post/1',
				cid: 'bafyexample',
				text: 'Claude is useful for TypeScript refactors',
				lang: 'en',
			},
			{
				uri: 'at://did:example/app.bsky.feed.post/2',
				cid: 'bafyexample2',
				text: 'first aid training notes',
				lang: 'en',
			},
		]);

		expect(accepted_posts.map((post) => post.uri)).toEqual([
			'at://did:example/app.bsky.feed.post/1',
		]);
	});
});

describe('create_jetstream_url', () => {
	it('requests only post records from Jetstream', () => {
		expect(create_jetstream_url()).toBe(
			'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post',
		);
	});
});
