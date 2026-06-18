import type { FeedPost } from '@bsky-ai-feed/core';

export type DecodedCursor = {
	accepted_at: string;
	cid: string;
};

export function encode_feed_cursor(post: FeedPost): string {
	return `${post.accepted_at}::${post.cid}`;
}

export function decode_feed_cursor(
	cursor: string | undefined,
): DecodedCursor | undefined {
	if (!cursor) return undefined;

	const separator_index = cursor.lastIndexOf('::');
	if (separator_index === -1) return undefined;

	const accepted_at = cursor.slice(0, separator_index);
	const cid = cursor.slice(separator_index + 2);
	if (!accepted_at || !cid) return undefined;

	return { accepted_at, cid };
}

export function is_before_cursor(
	post: FeedPost,
	cursor: DecodedCursor | undefined,
): boolean {
	if (!cursor) return true;
	if (post.accepted_at < cursor.accepted_at) return true;
	return (
		post.accepted_at === cursor.accepted_at && post.cid < cursor.cid
	);
}

export function compare_feed_posts(
	left: FeedPost,
	right: FeedPost,
): number {
	const time_compare = right.accepted_at.localeCompare(
		left.accepted_at,
	);
	if (time_compare !== 0) return time_compare;
	return right.cid.localeCompare(left.cid);
}
