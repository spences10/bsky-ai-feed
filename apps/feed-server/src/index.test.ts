import { create_memory_feed_store } from '@bsky-ai-feed/store';
import { describe, expect, it } from 'vitest';
import { create_feed_skeleton_body } from './index.js';

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
			cursor: '2026-01-01T00:00:00.000Z',
		});
	});
});
