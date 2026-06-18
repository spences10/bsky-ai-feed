import type { FeedPost } from '@bsky-ai-feed/core';

export type FeedCursor = {
	before?: string;
	limit: number;
};

export type FeedPage = {
	posts: FeedPost[];
	cursor?: string;
};

export type FeedStore = {
	put_posts(posts: FeedPost[]): Promise<void>;
	get_feed_page(cursor: FeedCursor): Promise<FeedPage>;
	delete_older_than(cutoff_iso: string): Promise<number>;
};

export function create_memory_feed_store(
	initial_posts: FeedPost[] = [],
): FeedStore {
	const posts_by_uri = new Map(
		initial_posts.map((post) => [post.uri, post]),
	);

	return {
		async put_posts(posts) {
			for (const post of posts) posts_by_uri.set(post.uri, post);
		},
		async get_feed_page({ before, limit }) {
			const ordered_posts = [...posts_by_uri.values()]
				.sort((left, right) =>
					right.accepted_at.localeCompare(left.accepted_at),
				)
				.filter((post) => !before || post.accepted_at < before);
			const page_posts = ordered_posts.slice(0, limit);
			return {
				posts: page_posts,
				cursor: page_posts.at(-1)?.accepted_at,
			};
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
