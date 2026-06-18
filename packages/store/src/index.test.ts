import { describe, expect, it } from 'vitest';
import { create_memory_feed_store } from './index.js';

describe('create_memory_feed_store', () => {
	it('returns newest posts first with timestamp cursor pagination', async () => {
		const store = create_memory_feed_store([
			{
				uri: 'old',
				cid: '1',
				accepted_at: '2026-01-01T00:00:00.000Z',
			},
			{
				uri: 'new',
				cid: '2',
				accepted_at: '2026-01-02T00:00:00.000Z',
			},
		]);

		const first_page = await store.get_feed_page({ limit: 1 });
		expect(first_page.posts.map((post) => post.uri)).toEqual(['new']);

		const second_page = await store.get_feed_page({
			limit: 1,
			before: first_page.cursor,
		});
		expect(second_page.posts.map((post) => post.uri)).toEqual([
			'old',
		]);
	});
});
