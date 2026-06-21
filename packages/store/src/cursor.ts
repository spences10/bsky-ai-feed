import type { FeedPost } from '@bsky-ai-feed/core';

export type DecodedCursor = {
	accepted_at: string;
	cid: string;
	score?: number;
};

export function encode_feed_cursor(post: FeedPost): string {
	const score = normalize_score(post.score);
	return score === undefined
		? `${post.accepted_at}::${post.cid}`
		: `${score.toFixed(6)}::${post.accepted_at}::${post.cid}`;
}

export function decode_feed_cursor(
	cursor: string | undefined,
): DecodedCursor | undefined {
	if (!cursor) return undefined;

	const parts = cursor.split('::');
	if (parts.length === 2) {
		const [accepted_at, cid] = parts;
		if (!accepted_at || !cid) return undefined;
		return { accepted_at, cid };
	}
	if (parts.length === 3) {
		const [score_text, accepted_at, cid] = parts;
		const score = Number(score_text);
		if (!accepted_at || !cid || !Number.isFinite(score)) {
			return undefined;
		}
		return { accepted_at, cid, score };
	}

	return undefined;
}

export function is_before_cursor(
	post: FeedPost,
	cursor: DecodedCursor | undefined,
): boolean {
	if (!cursor) return true;
	if (post.accepted_at < cursor.accepted_at) return true;
	if (post.accepted_at > cursor.accepted_at) return false;
	if (cursor.score !== undefined) {
		const post_score = normalize_score(post.score) ?? 0;
		if (post_score < cursor.score) return true;
		if (post_score > cursor.score) return false;
	}
	return post.cid < cursor.cid;
}

export function compare_feed_posts(
	left: FeedPost,
	right: FeedPost,
): number {
	const time_compare = right.accepted_at.localeCompare(
		left.accepted_at,
	);
	if (time_compare !== 0) return time_compare;
	const score_compare =
		(normalize_score(right.score) ?? 0) -
		(normalize_score(left.score) ?? 0);
	if (score_compare !== 0) return score_compare;
	return right.cid.localeCompare(left.cid);
}

function normalize_score(
	score: number | undefined,
): number | undefined {
	return typeof score === 'number' && Number.isFinite(score)
		? score
		: undefined;
}
