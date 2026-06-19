import type { FeedPost } from '@bsky-ai-feed/core';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { decode_feed_cursor, encode_feed_cursor } from './cursor.js';
import type {
	CandidateDecision,
	FeedStore,
	FilterPolicy,
} from './index.js';

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

type CandidateDecisionRow = {
	uri: string;
	cid: string;
	text: string;
	indexed_at: string | null;
	judged_at: string;
	accepted: number;
	confidence: number;
	score: number | null;
	category: string | null;
	reason: string | null;
	matched_keywords_json: string | null;
};

type FilterKeywordRow = {
	keyword_set: string;
	phrase: string;
};

type SuppressionPatternRow = {
	pattern: string;
};

type ExcludedAccountRow = {
	did: string;
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
			OR COALESCE(score, 0) < ?
			OR (
				COALESCE(score, 0) = ?
				AND (
					accepted_at < ?
					OR (accepted_at = ? AND cid < ?)
				)
			)
		ORDER BY COALESCE(score, 0) DESC, accepted_at DESC, cid DESC
		LIMIT ?
	`);
	const recent_decisions_statement = database.prepare(`
		SELECT
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
		FROM candidate_decisions
		WHERE ? IS NULL OR accepted = ?
		ORDER BY judged_at DESC
		LIMIT ?
	`);
	const delete_statement = database.prepare(`
		DELETE FROM feed_posts
		WHERE accepted_at < ?
	`);
	const filter_keywords_statement = database.prepare(`
		SELECT keyword_set, phrase
		FROM filter_keywords
		JOIN filter_keyword_sets ON filter_keyword_sets.name = filter_keywords.keyword_set
		WHERE filter_keywords.enabled = 1 AND filter_keyword_sets.enabled = 1
		ORDER BY keyword_set ASC, phrase ASC
	`);
	const suppression_patterns_statement = database.prepare(`
		SELECT pattern
		FROM filter_suppression_patterns
		WHERE enabled = 1
		ORDER BY pattern ASC
	`);
	const excluded_accounts_statement = database.prepare(`
		SELECT did
		FROM excluded_accounts
		WHERE enabled = 1
		ORDER BY did ASC
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
		async run_query(query, params) {
			const trimmed = query.trimStart().toUpperCase();
			const statement = database.prepare(query);
			const values = to_sql_values(params);
			if (
				trimmed.startsWith('SELECT') ||
				trimmed.startsWith('PRAGMA') ||
				trimmed.startsWith('EXPLAIN')
			) {
				const rows = statement.all(...values) as Record<
					string,
					unknown
				>[];
				return { type: 'read', rows, count: rows.length };
			}
			const result = statement.run(...values);
			return {
				type: 'write',
				changes: Number(result.changes),
				last_insert_rowid: Number(result.lastInsertRowid),
			};
		},
		async get_filter_policy() {
			const keyword_sets: FilterPolicy['keyword_sets'] = {};
			const keyword_rows =
				filter_keywords_statement.all() as FilterKeywordRow[];
			for (const row of keyword_rows) {
				keyword_sets[row.keyword_set] ??= [];
				keyword_sets[row.keyword_set]?.push(row.phrase);
			}
			const suppression_rows =
				suppression_patterns_statement.all() as SuppressionPatternRow[];
			const excluded_rows =
				excluded_accounts_statement.all() as ExcludedAccountRow[];
			return {
				keyword_sets,
				suppression_patterns: suppression_rows.map(
					(row) => row.pattern,
				),
				excluded_dids: excluded_rows.map((row) => row.did),
			};
		},
		async get_feed_page({ before, limit }) {
			const decoded_cursor = decode_feed_cursor(before);
			const cursor_score = decoded_cursor
				? (decoded_cursor.score ?? 0)
				: null;
			const cursor_accepted_at = decoded_cursor?.accepted_at ?? null;
			const cursor_cid = decoded_cursor?.cid ?? null;
			const rows = page_statement.all(
				cursor_score,
				cursor_score,
				cursor_score,
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
		async get_recent_decisions({ limit, accepted }) {
			const accepted_value =
				accepted === undefined ? null : accepted ? 1 : 0;
			const rows = recent_decisions_statement.all(
				accepted_value,
				accepted_value,
				limit,
			) as CandidateDecisionRow[];
			return rows.map(row_to_candidate_decision);
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
	database.exec(
		[
			'PRAGMA journal_mode = WAL',
			'PRAGMA busy_timeout = 5000',
			'PRAGMA foreign_keys = ON',
			`CREATE TABLE IF NOT EXISTS schema_migrations (
			id TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL
		) STRICT`,
		].join(';'),
	);

	const migration_applied_statement = database.prepare(
		'SELECT 1 FROM schema_migrations WHERE id = ?',
	);
	const record_migration_statement = database.prepare(
		'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
	);

	for (const migration of read_migrations()) {
		database.exec('BEGIN IMMEDIATE');
		try {
			const already_applied = migration_applied_statement.get(
				migration.id,
			);
			if (!already_applied) {
				database.exec(migration.sql);
				record_migration_statement.run(
					migration.id,
					new Date().toISOString(),
				);
			}
			database.exec('COMMIT');
		} catch (error) {
			database.exec('ROLLBACK');
			throw error;
		}
	}

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

type Migration = {
	id: string;
	sql: string;
};

function read_migrations(): Migration[] {
	const migrations_url = new URL('../migrations/', import.meta.url);
	return readdirSync(migrations_url)
		.filter((file_name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(file_name))
		.sort()
		.map((file_name) => ({
			id: file_name.replace(/\.sql$/u, ''),
			sql: readFileSync(new URL(file_name, migrations_url), 'utf8'),
		}));
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

function row_to_candidate_decision(
	row: CandidateDecisionRow,
): CandidateDecision {
	return strip_undefined({
		uri: row.uri,
		cid: row.cid,
		text: row.text,
		indexed_at: row.indexed_at ?? undefined,
		judged_at: row.judged_at,
		accepted: row.accepted === 1,
		confidence: row.confidence,
		score: row.score ?? undefined,
		category: row.category ?? undefined,
		reason: row.reason ?? undefined,
		matched_keywords: parse_keywords(row.matched_keywords_json),
	});
}

function json_or_null(value: string[] | undefined): string | null {
	return value ? JSON.stringify(value) : null;
}

function to_sql_values(
	params: readonly (string | number | boolean | null)[] | undefined,
): SQLInputValue[] {
	return (params ?? []).map((value) => {
		if (typeof value === 'boolean') return value ? 1 : 0;
		return value;
	});
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
