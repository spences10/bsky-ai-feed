import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	create_sqlite_feed_store,
	decode_feed_cursor,
} from './index.js';

const temp_dirs: string[] = [];

afterEach(() => {
	for (const temp_dir of temp_dirs.splice(0)) {
		rmSync(temp_dir, { recursive: true, force: true });
	}
});

describe('create_sqlite_feed_store', () => {
	it('persists posts and paginates with timestamp plus cid cursors', async () => {
		const { database_path } = create_temp_database_path();
		const store = create_sqlite_feed_store({ path: database_path });

		await store.put_posts([
			{
				uri: 'at://did:example/app.bsky.feed.post/old',
				cid: 'bafyold',
				accepted_at: '2026-01-01T00:00:00.000Z',
			},
			{
				uri: 'at://did:example/app.bsky.feed.post/new',
				cid: 'bafynew',
				accepted_at: '2026-01-02T00:00:00.000Z',
				indexed_at: '2026-01-02T00:00:01.000Z',
				score: 0.91,
			},
		]);

		const first_page = await store.get_feed_page({ limit: 1 });
		expect(first_page.posts).toEqual([
			{
				uri: 'at://did:example/app.bsky.feed.post/new',
				cid: 'bafynew',
				accepted_at: '2026-01-02T00:00:00.000Z',
				indexed_at: '2026-01-02T00:00:01.000Z',
				score: 0.91,
			},
		]);
		expect(decode_feed_cursor(first_page.cursor)).toEqual({
			accepted_at: '2026-01-02T00:00:00.000Z',
			cid: 'bafynew',
		});

		const second_page = await store.get_feed_page({
			limit: 1,
			before: first_page.cursor,
		});
		expect(second_page.posts.map((post) => post.uri)).toEqual([
			'at://did:example/app.bsky.feed.post/old',
		]);

		store.close?.();
	});

	it('deletes posts older than a cutoff', async () => {
		const { database_path } = create_temp_database_path();
		const store = create_sqlite_feed_store({ path: database_path });

		await store.put_posts([
			{
				uri: 'old',
				cid: 'oldcid',
				accepted_at: '2026-01-01T00:00:00.000Z',
			},
			{
				uri: 'new',
				cid: 'newcid',
				accepted_at: '2026-01-02T00:00:00.000Z',
			},
		]);

		await expect(
			store.delete_older_than('2026-01-01T12:00:00.000Z'),
		).resolves.toBe(1);
		await expect(
			store.get_feed_page({ limit: 10 }),
		).resolves.toMatchObject({
			posts: [
				{
					uri: 'new',
				},
			],
		});

		store.close?.();
	});
});

function create_temp_database_path(): { database_path: string } {
	const temp_dir = mkdtempSync(join(tmpdir(), 'bsky-ai-feed-'));
	temp_dirs.push(temp_dir);
	return { database_path: join(temp_dir, 'feed.sqlite') };
}
