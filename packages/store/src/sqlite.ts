import type { FeedPost } from '@bsky-ai-feed/core';
import { mkdirSync, readFileSync } from 'node:fs';
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
	text: string | null;
	matched_keywords_json: string | null;
	judge_confidence: number | null;
	judge_reason: string | null;
	judge_category: string | null;
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
			score,
			text,
			matched_keywords_json,
			judge_confidence,
			judge_reason,
			judge_category
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(uri) DO UPDATE SET
			cid = excluded.cid,
			accepted_at = excluded.accepted_at,
			indexed_at = excluded.indexed_at,
			score = excluded.score,
			text = excluded.text,
			matched_keywords_json = excluded.matched_keywords_json,
			judge_confidence = excluded.judge_confidence,
			judge_reason = excluded.judge_reason,
			judge_category = excluded.judge_category
	`);
	const decision_statement = database.prepare(`
		INSERT INTO candidate_decisions (
			uri,
			cid,
			text,
			indexed_at,
			judged_at,
			accepted,
			confidence,
			score,
			category,
			reason,
			matched_keywords_json
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(uri) DO UPDATE SET
			cid = excluded.cid,
			text = excluded.text,
			indexed_at = excluded.indexed_at,
			judged_at = excluded.judged_at,
			accepted = excluded.accepted,
			confidence = excluded.confidence,
			score = excluded.score,
			category = excluded.category,
			reason = excluded.reason,
			matched_keywords_json = excluded.matched_keywords_json
	`);
	const page_statement = database.prepare(`
		SELECT
			uri,
			cid,
			accepted_at,
			indexed_at,
			score,
			text,
			matched_keywords_json,
			judge_confidence,
			judge_reason,
			judge_category
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
						post.text ?? null,
						json_or_null(post.matched_keywords),
						post.judge_confidence ?? null,
						post.judge_reason ?? null,
						post.judge_category ?? null,
					);
				}
				database.exec('COMMIT');
			} catch (error) {
				database.exec('ROLLBACK');
				throw error;
			}
		},
		async put_decisions(decisions) {
			database.exec('BEGIN IMMEDIATE');
			try {
				for (const decision of decisions) {
					decision_statement.run(
						decision.uri,
						decision.cid,
						decision.text,
						decision.indexed_at ?? null,
						decision.judged_at,
						decision.accepted ? 1 : 0,
						decision.confidence,
						decision.score ?? null,
						decision.category ?? null,
						decision.reason ?? null,
						json_or_null(decision.matched_keywords),
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
	database.exec(read_schema_sql());
	for (const column of [
		'text TEXT',
		'matched_keywords_json TEXT',
		'judge_confidence REAL',
		'judge_reason TEXT',
		'judge_category TEXT',
	]) {
		add_column_if_missing(database, 'feed_posts', column);
	}
}

function read_schema_sql(): string {
	return readFileSync(
		new URL('../schema.sql', import.meta.url),
		'utf8',
	);
}

function add_column_if_missing(
	database: DatabaseSync,
	table: string,
	column_definition: string,
): void {
	const column_name = column_definition.split(/\s+/u)[0];
	const rows = database
		.prepare(`PRAGMA table_info(${table})`)
		.all() as {
		name: string;
	}[];
	if (rows.some((row) => row.name === column_name)) return;
	database.exec(
		`ALTER TABLE ${table} ADD COLUMN ${column_definition}`,
	);
}

function row_to_feed_post(row: FeedPostRow): FeedPost {
	return strip_undefined({
		uri: row.uri,
		cid: row.cid,
		accepted_at: row.accepted_at,
		indexed_at: row.indexed_at ?? undefined,
		score: row.score ?? undefined,
		text: row.text ?? undefined,
		matched_keywords: parse_keywords(row.matched_keywords_json),
		judge_confidence: row.judge_confidence ?? undefined,
		judge_reason: row.judge_reason ?? undefined,
		judge_category: row.judge_category ?? undefined,
	});
}

function json_or_null(value: string[] | undefined): string | null {
	return value ? JSON.stringify(value) : null;
}

function parse_keywords(value: string | null): string[] | undefined {
	if (!value) return undefined;
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) &&
			parsed.every((item) => typeof item === 'string')
			? parsed
			: undefined;
	} catch {
		return undefined;
	}
}

function strip_undefined<T extends Record<string, unknown>>(
	value: T,
): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as T;
}
