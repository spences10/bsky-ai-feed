import type { CandidatePost } from '@bsky-ai-feed/core';
import { describe, expect, it } from 'vitest';
import {
	hydrate_author_handles,
	is_excluded_author,
	runtime_filter_policy,
} from './filter-policy.js';

describe('runtime_filter_policy', () => {
	it('compiles excluded handle patterns and hydrates author handles', async () => {
		const policy = runtime_filter_policy({
			keyword_sets: { default: ['AI'] },
			suppression_patterns: [],
			excluded_dids: [],
			excluded_handle_patterns: ['bot\\.bsky\\.social$'],
		});
		const posts: CandidatePost[] = [
			{
				uri: 'at://did:plc:bot/app.bsky.feed.post/1',
				cid: 'bafybot',
				text: 'OpenAI model notes',
			},
		];

		await hydrate_author_handles(
			posts,
			policy,
			async () =>
				new Response(
					JSON.stringify({
						profiles: [
							{
								did: 'did:plc:bot',
								handle: 'statml-bot.bsky.social',
							},
						],
					}),
				),
		);

		expect(posts[0]?.author_handle).toBe('statml-bot.bsky.social');
		expect(is_excluded_author(posts[0]!, policy)).toBe(true);
	});
});
