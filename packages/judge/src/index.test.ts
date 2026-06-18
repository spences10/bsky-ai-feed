import { describe, expect, it } from 'vitest';
import { ai_technology_prompt, create_noop_judge } from './index.js';

describe('create_noop_judge', () => {
	it('returns rejecting decisions for every candidate', async () => {
		const judge = create_noop_judge();
		await expect(
			judge.judge_batch({
				prompt: ai_technology_prompt,
				posts: [
					{
						uri: 'at://did:example/app.bsky.feed.post/1',
						cid: 'bafyexample',
						text: 'Claude released a new model',
					},
				],
			}),
		).resolves.toEqual([
			{
				uri: 'at://did:example/app.bsky.feed.post/1',
				is_ai_technology: false,
				confidence: 0,
				reason: 'noop judge is not configured',
			},
		]);
	});
});
