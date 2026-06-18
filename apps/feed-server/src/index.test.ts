import { create_memory_feed_store } from '@bsky-ai-feed/store';
import { describe, expect, it } from 'vitest';
import {
	create_feed_skeleton_body,
	create_health_body,
	create_service_status_body,
} from './index.js';

describe('create_service_status_body', () => {
	it('describes browser-friendly local endpoints', () => {
		expect(create_service_status_body('did:web:localhost')).toEqual({
			service: 'bsky-ai-feed',
			status: 'ok',
			did: 'did:web:localhost',
			endpoints: {
				health: '/health',
				did: '/.well-known/did.json',
				describe_feed_generator:
					'/xrpc/app.bsky.feed.describeFeedGenerator',
				feed_skeleton:
					'/xrpc/app.bsky.feed.getFeedSkeleton?feed=test',
				ingest_api: '/api/ingest',
			},
		});
	});
});

describe('create_health_body', () => {
	it('returns a small health payload for platform probes', () => {
		expect(create_health_body()).toEqual({
			status: 'ok',
			service: 'bsky-ai-feed',
		});
	});
});

describe('create_feed_skeleton_body', () => {
	it('serializes stored posts into getFeedSkeleton shape', async () => {
		const store = create_memory_feed_store([
			{
				uri: 'at://did:example/app.bsky.feed.post/1',
				cid: 'bafy1',
				accepted_at: '2026-01-01T00:00:00.000Z',
			},
		]);

		await expect(
			create_feed_skeleton_body(store, undefined, 50),
		).resolves.toEqual({
			feed: [{ post: 'at://did:example/app.bsky.feed.post/1' }],
			cursor: '2026-01-01T00:00:00.000Z::bafy1',
		});
	});
});
