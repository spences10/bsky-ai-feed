import type { FeedPost } from '@bsky-ai-feed/core';
import {
	compare_feed_posts,
	decode_feed_cursor,
	encode_feed_cursor,
	is_before_cursor,
} from './cursor.js';

export {
	compare_feed_posts,
	decode_feed_cursor,
	encode_feed_cursor,
	is_before_cursor,
} from './cursor.js';
export type { DecodedCursor } from './cursor.js';
export { create_sqlite_feed_store } from './sqlite.js';
export type { SqliteFeedStoreOptions } from './sqlite.js';

export type FeedCursor = {
	before?: string;
	limit: number;
};

export type FeedPage = {
	posts: FeedPost[];
	cursor?: string;
};

export type ReviewCursor = {
	limit: number;
	accepted?: boolean;
};

export type CandidateDecision = {
	uri: string;
	cid: string;
	text: string;
	indexed_at?: string;
	judged_at: string;
	accepted: boolean;
	confidence: number;
	score?: number;
	category?: string;
	reason?: string;
	matched_keywords?: string[];
};

export type QueryParam = string | number | boolean | null;

export type QueryResult =
	| {
			type: 'read';
			rows: Record<string, unknown>[];
			count: number;
	  }
	| {
			type: 'write';
			changes: number;
			last_insert_rowid: number;
	  };

export type FilterPolicy = {
	keyword_sets: Record<string, string[]>;
	suppression_patterns: string[];
	excluded_dids: string[];
};

export type FeedStore = {
	put_posts(posts: FeedPost[]): Promise<void>;
	put_decisions?(decisions: CandidateDecision[]): Promise<void>;
	run_query?(
		query: string,
		params?: QueryParam[],
	): Promise<QueryResult>;
	get_filter_policy?(): Promise<FilterPolicy>;
	get_feed_page(cursor: FeedCursor): Promise<FeedPage>;
	get_recent_decisions?(
		cursor: ReviewCursor,
	): Promise<CandidateDecision[]>;
	delete_older_than(cutoff_iso: string): Promise<number>;
	close?: () => void;
};

export function create_memory_feed_store(
	initial_posts: FeedPost[] = [],
): FeedStore {
	const posts_by_uri = new Map(
		initial_posts.map((post) => [post.uri, post]),
	);
	const decisions_by_uri = new Map<string, CandidateDecision>();

	return {
		async put_posts(posts) {
			for (const post of posts) posts_by_uri.set(post.uri, post);
		},
		async put_decisions(decisions) {
			for (const decision of decisions) {
				decisions_by_uri.set(decision.uri, decision);
			}
		},
		async get_feed_page({ before, limit }) {
			const decoded_cursor = decode_feed_cursor(before);
			const ordered_posts = [...posts_by_uri.values()]
				.sort(compare_feed_posts)
				.filter((post) => is_before_cursor(post, decoded_cursor));
			const page_posts = ordered_posts.slice(0, limit);
			const last_post = page_posts.at(-1);
			return {
				posts: page_posts,
				cursor: last_post ? encode_feed_cursor(last_post) : undefined,
			};
		},
		async get_recent_decisions({ limit, accepted }) {
			return [...decisions_by_uri.values()]
				.filter(
					(decision) =>
						accepted === undefined || decision.accepted === accepted,
				)
				.sort((left, right) =>
					right.judged_at.localeCompare(left.judged_at),
				)
				.slice(0, limit);
		},
		async delete_older_than(cutoff_iso) {
			let deleted_count = 0;
			for (const [uri, post] of posts_by_uri) {
				if (post.accepted_at < cutoff_iso) {
					posts_by_uri.delete(uri);
					deleted_count += 1;
				}
			}
			return deleted_count;
		},
	};
}
