import type { FeedPost } from '@bsky-ai-feed/core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decode_feed_cursor, encode_feed_cursor } from './cursor.js';
import type { FeedStore } from './index.js';

export type SqliteFeedStoreOptions = {
	path?: string;
};

type FeedPostRow = {
	uri: string;
	cid: string;
	accepted_at: string;
	indexed_at: string | null;
	score: number | null;
};

const default_database_path = '.data/feed.sqlite';

export function create_sqlite_feed_store(
	options: SqliteFeedStoreOptions = {},
): FeedStore {
	const database_path = options.path ?? default_database_path;
	if (database_path !== ':memory:') {
		mkdirSync(dirname(database_path), { recursive: true });
	}

	const database = new DatabaseSync(database_path);
	migrate_database(database);

	const put_statement = database.prepare(`
		INSERT INTO feed_posts (
			uri,
			cid,
			accepted_at,
			indexed_at,
			score
		)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(uri) DO UPDATE SET
			cid = excluded.cid,
			accepted_at = excluded.accepted_at,
			indexed_at = excluded.indexed_at,
			score = excluded.score
	`);
	const page_statement = database.prepare(`
		SELECT uri, cid, accepted_at, indexed_at, score
		FROM feed_posts
		WHERE
			? IS NULL
			OR accepted_at < ?
			OR (accepted_at = ? AND cid < ?)
		ORDER BY accepted_at DESC, cid DESC
		LIMIT ?
	`);
	const delete_statement = database.prepare(`
		DELETE FROM feed_posts
		WHERE accepted_at < ?
	`);

	return {
		async put_posts(posts) {
			database.exec('BEGIN IMMEDIATE');
			try {
				for (const post of posts) {
					put_statement.run(
						post.uri,
						post.cid,
						post.accepted_at,
						post.indexed_at ?? null,
						post.score ?? null,
					);
				}
				database.exec('COMMIT');
			} catch (error) {
				database.exec('ROLLBACK');
				throw error;
			}
		},
		async get_feed_page({ before, limit }) {
			const decoded_cursor = decode_feed_cursor(before);
			const cursor_accepted_at = decoded_cursor?.accepted_at ?? null;
			const cursor_cid = decoded_cursor?.cid ?? null;
			const rows = page_statement.all(
				cursor_accepted_at,
				cursor_accepted_at,
				cursor_accepted_at,
				cursor_cid,
				limit,
			) as FeedPostRow[];
			const posts = rows.map(row_to_feed_post);

			const last_post = posts.at(-1);
			return {
				posts,
				cursor: last_post ? encode_feed_cursor(last_post) : undefined,
			};
		},
		async delete_older_than(cutoff_iso) {
			const result = delete_statement.run(cutoff_iso);
			return Number(result.changes);
		},
		close() {
			database.close();
		},
	};
}

function migrate_database(database: DatabaseSync): void {
	database.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA busy_timeout = 5000;
		PRAGMA foreign_keys = ON;

		CREATE TABLE IF NOT EXISTS feed_posts (
			uri TEXT PRIMARY KEY,
			cid TEXT NOT NULL,
			accepted_at TEXT NOT NULL,
			indexed_at TEXT,
			score REAL
		) STRICT;

		CREATE INDEX IF NOT EXISTS feed_posts_order_idx
		ON feed_posts (accepted_at DESC, cid DESC);
	`);
}

function row_to_feed_post(row: FeedPostRow): FeedPost {
	return {
		uri: row.uri,
		cid: row.cid,
		accepted_at: row.accepted_at,
		indexed_at: row.indexed_at ?? undefined,
		score: row.score ?? undefined,
	};
}
