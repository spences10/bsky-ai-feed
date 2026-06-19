import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
			score: 0.91,
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

	it('persists judge metadata and decision audit rows', async () => {
		const { database_path } = create_temp_database_path();
		const store = create_sqlite_feed_store({ path: database_path });

		await store.put_decisions?.([
			{
				uri: 'at://did:example/app.bsky.feed.post/1',
				cid: 'bafy1',
				text: 'OpenAI released a new model',
				indexed_at: '2026-01-02T00:00:01.000Z',
				judged_at: '2026-01-02T00:00:02.000Z',
				accepted: true,
				confidence: 0.94,
				score: 0.82,
				category: 'model-research',
				reason: 'specific model news',
				matched_keywords: ['OpenAI'],
			},
		]);
		await store.put_posts([
			{
				uri: 'at://did:example/app.bsky.feed.post/1',
				cid: 'bafy1',
				accepted_at: '2026-01-02T00:00:02.000Z',
				indexed_at: '2026-01-02T00:00:01.000Z',
				score: 0.82,
				text: 'OpenAI released a new model',
				matched_keywords: ['OpenAI'],
				judge_confidence: 0.94,
				judge_reason: 'specific model news',
				judge_category: 'model-research',
			},
		]);

		await expect(
			store.get_feed_page({ limit: 10 }),
		).resolves.toMatchObject({
			posts: [
				{
					uri: 'at://did:example/app.bsky.feed.post/1',
					score: 0.82,
					text: 'OpenAI released a new model',
					matched_keywords: ['OpenAI'],
					judge_confidence: 0.94,
					judge_reason: 'specific model news',
					judge_category: 'model-research',
				},
			],
		});

		store.close?.();
		const database = new DatabaseSync(database_path);
		expect(
			database
				.prepare(
					'SELECT accepted, category, reason FROM candidate_decisions WHERE uri = ?',
				)
				.get('at://did:example/app.bsky.feed.post/1'),
		).toEqual({
			accepted: 1,
			category: 'model-research',
			reason: 'specific model news',
		});
		database.close();
	});

	it('records applied schema migrations', async () => {
		const { database_path } = create_temp_database_path();
		const store = create_sqlite_feed_store({ path: database_path });
		store.close?.();

		const database = new DatabaseSync(database_path);
		expect(
			database
				.prepare('SELECT id FROM schema_migrations ORDER BY id')
				.all(),
		).toEqual([{ id: '0001_initial' }, { id: '0002_filter_policy' }]);
		database.close();
	});

	it('loads seeded filter policy data', async () => {
		const { database_path } = create_temp_database_path();
		const store = create_sqlite_feed_store({ path: database_path });

		await expect(store.get_filter_policy?.()).resolves.toMatchObject({
			keyword_sets: {
				default: expect.arrayContaining(['AI', 'OpenAI']),
			},
			suppression_patterns: expect.arrayContaining([
				'\\bAI\\s+slop\\b',
			]),
		});

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
