import type { Judge } from '@bsky-ai-feed/judge';
import { create_memory_feed_store } from '@bsky-ai-feed/store';
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
			score: 0.9,
			category: 'developer-tooling',
			reason: 'concrete AI tooling post',
		}));
	},
};

describe('create_ingest_pipeline', () => {
	it('stores posts that pass keyword filtering and AI judging', async () => {
		const pipeline = create_ingest_pipeline({
			judge: accepting_judge,
			store: create_memory_feed_store(),
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

	it('uses store-backed filter policy when available', async () => {
		const store = create_memory_feed_store();
		store.get_filter_policy = async () => ({
			keyword_sets: { default: ['agent framework'] },
			suppression_patterns: ['\\bwebinar\\b'],
			excluded_dids: [],
			excluded_handle_patterns: [],
		});
		const pipeline = create_ingest_pipeline({
			judge: accepting_judge,
			store,
		});

		const accepted_posts = await pipeline.process_posts([
			{
				uri: 'at://did:example/app.bsky.feed.post/3',
				cid: 'bafyexample3',
				text: 'This agent framework has useful AI workflow ideas',
				lang: 'en',
			},
			{
				uri: 'at://did:example/app.bsky.feed.post/4',
				cid: 'bafyexample4',
				text: 'OpenAI webinar about enterprise transformation',
				lang: 'en',
			},
		]);

		expect(accepted_posts.map((post) => post.uri)).toEqual([
			'at://did:example/app.bsky.feed.post/3',
		]);
	});

	it('excludes DIDs from store-backed filter policy', async () => {
		const store = create_memory_feed_store();
		store.get_filter_policy = async () => ({
			keyword_sets: { default: ['OpenAI'] },
			suppression_patterns: [],
			excluded_dids: ['did:plc:blocked'],
			excluded_handle_patterns: [],
		});
		const pipeline = create_ingest_pipeline({
			judge: accepting_judge,
			store,
		});

		const accepted_posts = await pipeline.process_posts([
			{
				uri: 'at://did:plc:blocked/app.bsky.feed.post/1',
				cid: 'bafyblocked',
				text: 'OpenAI released a new language model today',
				lang: 'en',
			},
		]);

		expect(accepted_posts).toEqual([]);
	});
});

describe('create_jetstream_url', () => {
	it('requests only post records from Jetstream', () => {
		expect(create_jetstream_url()).toBe(
			'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post',
		);
	});
});
